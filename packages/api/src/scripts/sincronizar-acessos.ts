import { randomBytes } from 'node:crypto';
import { UserRole } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { hashPassword } from '../lib/crypto.js';
import { ACESSOS_AUTORIZADOS } from '../config/acessos.js';

/**
 * Aplica a lista de acessos autorizados.
 *
 *     npm run acessos
 *
 * Cria quem falta, corrige cargo e setores de quem mudou, e DESATIVA quem
 * saiu da lista. E assim que uma demissao vira bloqueio: o e-mail continua
 * no banco (para o historico de atendimento nao se perder) mas nao entra
 * mais.
 *
 * Nao apagamos o usuario de proposito. Apagar levaria junto a autoria das
 * mensagens que ele enviou, e o historico do cliente ficaria com buracos.
 */

async function main() {
  const org = await prisma.organization.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!org) {
    console.error('Nenhuma organizacao encontrada. Rode "npm run db:seed" antes.');
    process.exit(1);
  }

  const setores = await prisma.department.findMany({
    where: { orgId: org.id },
    select: { id: true, slug: true, name: true },
  });
  const setorPorSlug = new Map(setores.map((s) => [s.slug, s]));

  const autorizados = new Set(ACESSOS_AUTORIZADOS.map((a) => a.email.toLowerCase()));

  // Barreira de seguranca: sem OWNER na lista, ninguem conseguiria mais
  // administrar o sistema depois da sincronizacao.
  if (!ACESSOS_AUTORIZADOS.some((a) => a.cargo === UserRole.OWNER)) {
    console.error('A lista precisa de pelo menos um OWNER. Nada foi alterado.');
    process.exit(1);
  }

  console.log(`\nSincronizando ${ACESSOS_AUTORIZADOS.length} acessos autorizados...\n`);

  for (const acesso of ACESSOS_AUTORIZADOS) {
    const email = acesso.email.toLowerCase();

    const vinculos = (acesso.setores ?? [])
      .map((slug) => {
        const setor = setorPorSlug.get(slug);
        if (!setor) console.warn(`  ! setor "${slug}" nao existe (ignorado para ${email})`);
        return setor;
      })
      .filter((s): s is { id: string; slug: string; name: string } => Boolean(s));

    const existente = await prisma.user.findFirst({
      where: { orgId: org.id, email },
      select: { id: true, role: true, isActive: true },
    });

    if (existente) {
      await prisma.user.update({
        where: { id: existente.id },
        data: {
          name: acesso.nome,
          role: acesso.cargo,
          isActive: true,
          deletedAt: null,
          ...(acesso.maxConversas ? { maxConcurrentChats: acesso.maxConversas } : {}),
        },
      });

      const mudou = existente.role !== acesso.cargo || !existente.isActive;
      console.log(`  ${mudou ? 'atualizado' : 'ok        '} ${acesso.cargo.padEnd(10)} ${email}`);
    } else {
      await prisma.user.create({
        data: {
          orgId: org.id,
          name: acesso.nome,
          email,
          // Quem entra pelo Google nunca usa senha, mas o campo e obrigatorio
          // e nao pode ficar previsivel.
          passwordHash: await hashPassword(randomBytes(24).toString('base64url')),
          role: acesso.cargo,
          maxConcurrentChats: acesso.maxConversas ?? 5,
        },
      });
      console.log(`  criado     ${acesso.cargo.padEnd(10)} ${email}`);
    }

    // Setores: recriamos o vinculo para refletir exatamente a lista.
    const usuario = await prisma.user.findFirstOrThrow({
      where: { orgId: org.id, email },
      select: { id: true },
    });

    await prisma.departmentMember.deleteMany({ where: { userId: usuario.id } });
    for (const setor of vinculos) {
      await prisma.departmentMember.create({
        data: {
          userId: usuario.id,
          departmentId: setor.id,
          isSupervisor: acesso.cargo === UserRole.SUPERVISOR,
        },
      });
    }
  }

  // Quem sumiu da lista perde o acesso.
  const revogados = await prisma.user.updateMany({
    where: {
      orgId: org.id,
      isActive: true,
      email: { notIn: [...autorizados] },
    },
    data: { isActive: false },
  });

  if (revogados.count > 0) {
    const fora = await prisma.user.findMany({
      where: { orgId: org.id, isActive: false, email: { notIn: [...autorizados] } },
      select: { email: true },
    });
    console.log('');
    for (const u of fora) console.log(`  REVOGADO   ${u.email}`);
  }

  console.log(
    `\nPronto. ${ACESSOS_AUTORIZADOS.length} com acesso, ${revogados.count} revogado(s).\n`,
  );

  await prisma.$disconnect();
}

main().catch(async (erro) => {
  console.error('Falha ao sincronizar acessos:', erro);
  await prisma.$disconnect();
  process.exit(1);
});
