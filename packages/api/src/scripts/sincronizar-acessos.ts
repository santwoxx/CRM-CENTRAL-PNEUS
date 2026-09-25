import { randomBytes } from 'node:crypto';
import { UserRole } from '@crm/shared';
import { prisma } from '../db/prisma.js';
import { hashPassword } from '../lib/crypto.js';
import { ACESSOS_AUTORIZADOS } from '../config/acessos.js';
import { liberarConversasDoUsuario } from '../modules/users/service.js';
import { disconnectRedis } from '../lib/redis.js';

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

  // Quem sumiu da lista perde o acesso e sai da tela de equipe.
  //
  // `deletedAt` esconde da listagem sem apagar a linha: a autoria das
  // mensagens que a pessoa enviou continua intacta, e o historico do cliente
  // nao fica com buracos. Se ela voltar para a lista, a sincronizacao limpa
  // o campo e o acesso volta.
  const fora = await prisma.user.findMany({
    where: {
      orgId: org.id,
      deletedAt: null,
      email: { notIn: [...autorizados] },
    },
    select: { id: true, email: true },
  });

  if (fora.length > 0) console.log('');

  for (const u of fora) {
    await prisma.user.update({
      where: { id: u.id },
      data: { isActive: false, deletedAt: new Date() },
    });
    await prisma.departmentMember.deleteMany({ where: { userId: u.id } });

    // Os clientes que essa pessoa atendia voltam para a fila. Sem isto, a
    // conversa fica ASSIGNED para alguem que nao entra mais no sistema:
    // ninguem ve, ninguem responde, e nada sinaliza o problema.
    const devolvidas = await liberarConversasDoUsuario(u.id, org.id);

    console.log(
      `  REVOGADO   ${u.email}` +
        (devolvidas > 0 ? `  (${devolvidas} conversa(s) devolvida(s) a fila)` : ''),
    );
  }

  console.log(
    `
Pronto. ${ACESSOS_AUTORIZADOS.length} com acesso, ${fora.length} revogado(s).
`,
  );

  await encerrar();
}

/**
 * Fecha tudo que segura o processo.
 *
 * Reatribuir conversas puxa o roteador, que puxa o barramento de tempo real,
 * que abre uma conexao com o Redis. Sem fechar essa conexao o script termina
 * o trabalho e simplesmente nao sai - fica pendurado para sempre. Num script
 * de terminal isso parece travamento; em CI, vira job que so morre no timeout.
 */
async function encerrar(): Promise<void> {
  await prisma.$disconnect().catch(() => {});
  await disconnectRedis().catch(() => {});
}

main().catch(async (erro) => {
  console.error('Falha ao sincronizar acessos:', erro);
  await encerrar();
  process.exit(1);
});
