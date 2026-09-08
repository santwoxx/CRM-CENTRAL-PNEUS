import type { FastifyPluginAsync } from 'fastify';
import { checkDatabase } from '../../db/prisma.js';
import { checkRedis } from '../../lib/redis.js';
import { getQueueSnapshots } from '../../queue/queues.js';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  // Verificação simples de liveness (processo vivo)
  app.get('/live', async (_req, reply) => {
    return reply.send({ status: 'ok', uptime: process.uptime() });
  });

  // Verificação completa de readiness (Postgres + Redis + Filas)
  app.get('/ready', async (_req, reply) => {
    const [db, redis, queues] = await Promise.all([
      checkDatabase(),
      checkRedis(),
      getQueueSnapshots().catch(() => []),
    ]);

    const isHealthy = db.ok && redis.ok;

    const components = [
      { name: 'postgresql', status: db.ok ? 'ok' : 'down', detail: db.error ?? null, latencyMs: db.latencyMs },
      { name: 'redis', status: redis.ok ? 'ok' : 'down', detail: redis.error ?? null, latencyMs: redis.latencyMs },
    ];

    const statusCode = isHealthy ? 200 : 503;
    return reply.code(statusCode).send({
      status: isHealthy ? 'ok' : 'degraded',
      checkedAt: new Date().toISOString(),
      components,
      queues,
    });
  });
};
