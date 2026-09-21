import { PrismaClient } from '@prisma/client';
import { semear } from '../src/db/seed.js';

/**
 * Seed de DESENVOLVIMENTO: base + dados de demonstracao.
 *
 *     npm run db:seed
 *
 * Em producao use `node packages/api/dist/scripts/preparar-banco.js`, que
 * cria so a base. A logica mora em src/db/seed.ts para ser compilada junto
 * com a API - a imagem de producao nao tem tsx para rodar este arquivo.
 */

const prisma = new PrismaClient();

semear(prisma, { demonstracao: true })
  .then(() => {
    console.log('Base de demonstracao pronta.');
    console.log('Admin: admin@centralpneus.com.br | Senha: AdminPassword123!');
    console.log('Atendentes: carlos@, mariana@, roberto@ | Senha: Atendente123!');
  })
  .catch((erro) => {
    console.error('Erro ao popular base:', erro);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
