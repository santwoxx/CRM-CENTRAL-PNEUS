import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { logger } from '../lib/logger.js';
import { isApiPath } from '../lib/routes.js';

/**
 * Serve o painel (React) pelo proprio backend.
 *
 * POR QUE ISSO EXISTE
 *
 * Com frontend e backend em dominios separados, cada troca de endereco do
 * backend obrigava a: editar VITE_API_URL, refazer o build e redeployar o
 * frontend - porque essa variavel entra no bundle, nao e lida em execucao.
 * Com tunel gratuito, cujo endereco muda a cada reinicio, isso era um pedagio
 * a cada vez que o sistema subia.
 *
 * Servindo tudo do mesmo lugar, sobra UM endereco: o do tunel. Some o CORS,
 * some o redeploy, e o link que se manda para alguem testar e um so. O deploy
 * separado no Vercel continua funcionando para quem quiser - basta definir
 * VITE_API_URL no build de la.
 */

const moduleDir = dirname(fileURLToPath(import.meta.url));

/**
 * Acha o `dist` do frontend. Os caminhos mudam entre rodar do fonte (tsx) e
 * do compilado (dist), por isso tentamos os candidatos em vez de fixar um.
 */
function findWebDist(): string | null {
  const candidates = [
    process.env.WEB_DIST_PATH,
    resolve(moduleDir, '../../../web/dist'),
    resolve(moduleDir, '../../web/dist'),
    resolve(process.cwd(), 'packages/web/dist'),
    resolve(process.cwd(), '../web/dist'),
  ].filter((path): path is string => Boolean(path));

  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'index.html'))) return candidate;
  }

  return null;
}

export const spaPlugin = fp(async (app: FastifyInstance) => {
  const webDist = findWebDist();

  if (!webDist) {
    logger.warn(
      'Painel nao encontrado (packages/web/dist). Rode "npm run build -w @crm/web" para servi-lo pelo backend.',
    );
    return;
  }

  await app.register(fastifyStatic, {
    root: webDist,
    // Nao usamos wildcard: o fallback abaixo cuida das rotas do React.
    wildcard: false,
    // Os assets tem hash no nome, entao podem ser cacheados para sempre.
    maxAge: '1y',
    index: false,
  });

  /**
   * Fallback de aplicacao de pagina unica.
   *
   * Uma rota do React (ex.: /inbox) nao existe como arquivo; o navegador
   * precisa receber o index.html e deixar o roteador do React resolver.
   * Mas isso so vale para navegacao: chamada de API inexistente tem que
   * continuar devolvendo 404 em JSON, senao o frontend recebe HTML onde
   * esperava dados e quebra de um jeito dificil de entender.
   */
  app.setNotFoundHandler((request, reply) => {
    const url = request.raw.url ?? '/';

    if (request.method !== 'GET' || isApiPath(url)) {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: `Rota nao encontrada: ${request.method} ${url}` },
      });
    }

    return reply.type('text/html').sendFile('index.html');
  });

  logger.info({ webDist }, 'Painel sendo servido pelo backend');
});
