import fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { env } from './env.js';
import { logger } from './lib/logger.js';
import { checkDatabase, disconnectDatabase } from './db/prisma.js';
import { checkRedis, disconnectRedis } from './lib/redis.js';
import { errorsPlugin } from './plugins/errors.js';
import { authPlugin } from './plugins/auth.js';
import { setupSocketServer } from './realtime/server.js';
import { unsubscribeRealtime } from './realtime/bus.js';
import { closeQueues, registerRepeatableJobs } from './queue/queues.js';
import { startWorkers } from './queue/workers/index.js';

// Rotas
import { authRoutes } from './modules/auth/routes.js';
import { userRoutes } from './modules/users/routes.js';
import { departmentRoutes } from './modules/departments/routes.js';
import { contactRoutes } from './modules/contacts/routes.js';
import { conversationRoutes } from './modules/conversations/routes.js';
import { messageRoutes } from './modules/messages/routes.js';
import { channelRoutes } from './modules/channels/routes.js';
import { aiRoutes } from './modules/ai/routes.js';
import { dashboardRoutes } from './modules/dashboard/routes.js';
import { mediaRoutes } from './modules/media/routes.js';
import { webhookRoutes } from './modules/webhooks/routes.js';
import { healthRoutes } from './modules/health/routes.js';
import { simulatorRoutes } from './modules/simulator/routes.js';

async function buildServer() {
  const app = fastify({
    loggerInstance: logger,
    disableRequestLogging: env.LOG_LEVEL !== 'debug' && env.LOG_LEVEL !== 'trace',
  });

  // Plugins essenciais
  await app.register(cors, {
    origin: env.CORS_ORIGINS.length > 0 ? env.CORS_ORIGINS : true,
    credentials: true,
  });

  await app.register(cookie);

  await app.register(multipart, {
    limits: {
      fileSize: 64 * 1024 * 1024, // 64MB para vídeos, documentos e áudios
    },
  });

  await app.register(rateLimit, {
    max: 200,
    timeWindow: '1 minute',
    allowList: ['127.0.0.1'],
  });

  await app.register(errorsPlugin);
  await app.register(authPlugin);

  // Registro de rotas modulares
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(userRoutes, { prefix: '/users' });
  await app.register(departmentRoutes, { prefix: '/departments' });
  await app.register(contactRoutes, { prefix: '/contacts' });
  await app.register(conversationRoutes, { prefix: '/conversations' });
  await app.register(messageRoutes);
  await app.register(channelRoutes, { prefix: '/channels' });
  await app.register(aiRoutes, { prefix: '/ai' });
  await app.register(dashboardRoutes, { prefix: '/dashboard' });
  await app.register(simulatorRoutes, { prefix: '/simulator' });
  await app.register(mediaRoutes);
  await app.register(webhookRoutes, { prefix: '/webhooks' });
  await app.register(healthRoutes, { prefix: '/health' });

  // Gateway Socket.IO acoplado ao servidor HTTP do Fastify
  setupSocketServer(app.server);

  return app;
}

async function main() {
  logger.info({ role: env.ROLE, env: env.NODE_ENV }, 'Inicializando CRM Central Pneus...');

  const [dbStatus, redisStatus] = await Promise.all([checkDatabase(), checkRedis()]);

  if (!dbStatus.ok) {
    logger.warn({ error: dbStatus.error }, 'Banco de dados nao respondeu no boot (continuando...');
  }

  if (!redisStatus.ok) {
    logger.warn({ error: redisStatus.error }, 'Redis nao respondeu no boot (continuando...');
  }

  const app = await buildServer();

  // Se o container rodar com ROLE=all, sobe também workers e cron
  let workerInstance: ReturnType<typeof startWorkers> | null = null;
  if (env.ROLE === 'all' || env.ROLE === 'worker') {
    await registerRepeatableJobs().catch((err) =>
      logger.warn({ err }, 'Nao foi possivel registrar repeatable jobs (Redis pode estar desligado)'),
    );
    workerInstance = startWorkers();
  }

  const port = env.API_PORT;
  const host = env.API_HOST;

  await app.listen({ port, host });
  logger.info({ url: `http://${host}:${port}` }, '🚀 Servidor CRM Central Pneus pronto');

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Encerrando servidor...');
    if (workerInstance) await workerInstance.close();
    await app.close();
    await unsubscribeRealtime();
    await closeQueues();
    await disconnectDatabase();
    await disconnectRedis();
    logger.info('Servidor finalizado');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Falha fatal ao iniciar servidor');
  process.exit(1);
});
