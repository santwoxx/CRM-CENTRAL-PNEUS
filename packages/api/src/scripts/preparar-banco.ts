import { prisma } from '../db/prisma.js';
import { disconnectRedis } from '../lib/redis.js';
import { semear } from '../db/seed.js';

/**
 * Prepara o banco de PRODUCAO no primeiro boot.
 *
 *     node packages/api/dist/scripts/preparar-banco.js
 *
 * Roda a cada deploy (o docker-compose de producao chama antes de subir a
 * API), mas so age uma vez: se a organizacao ja existe, nao toca em nada.
 * Rodar a semeadura em todo deploy desfaria configuracao feita pelo painel -
 * persona, setores e acessos editados voltariam ao estado inicial.
 *
 * Cria somente a base, nunca dados de demonstracao: ver src/db/seed.ts.
 */

async function main(): Promise<void> {
  const existente = await prisma.organization.findFirst({ select: { name: true } });
  if (existente) {
    console.log(`Banco ja preparado (${existente.name}). Nada a fazer.`);
    return;
  }

  await semear(prisma, { demonstracao: false });

  const pessoas = await prisma.user.count();
  console.log(`Banco preparado: organizacao, setores, persona da IA e ${pessoas} acesso(s).`);
  console.log('Catalogo vazio: a IA qualifica o cliente e transfere; o vendedor cota.');
}

main()
  .catch((erro) => {
    console.error('Falha ao preparar o banco:', erro);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Sem fechar o Redis o processo termina o trabalho e nao sai - e o
    // docker-compose espera para sempre antes de subir a API.
    await prisma.$disconnect().catch(() => {});
    await disconnectRedis().catch(() => {});
  });
