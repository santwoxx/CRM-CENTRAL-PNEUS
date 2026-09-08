import { logger } from './lib/logger.js';
import { checkDatabase, disconnectDatabase } from './db/prisma.js';
import { checkRedis, disconnectRedis } from './lib/redis.js';
import { registerRepeatableJobs, closeQueues } from './queue/queues.js';
import { startWorkers } from './queue/workers/index.js';

async function main() {
  logger.info('Iniciando processo Worker do CRM Central Pneus...');

  const [dbHealth, redisHealth] = await Promise.all([checkDatabase(), checkRedis()]);

  if (!dbHealth.ok) {
    logger.fatal({ err: dbHealth.error }, 'Banco de dados inacessivel no startup do worker');
    process.exit(1);
  }

  if (!redisHealth.ok) {
    logger.fatal({ err: redisHealth.error }, 'Redis inacessivel no startup do worker');
    process.exit(1);
  }

  logger.info('Infraestrutura conectada (PostgreSQL + Redis)');

  // Registra jobs recorrentes (SLA, rotinas de limpeza, auto-away)
  await registerRepeatableJobs();

  // Inicia workers
  const { close } = startWorkers();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Recebido sinal de parada, encerrando graceful...');
    await close();
    await closeQueues();
    await disconnectDatabase();
    await disconnectRedis();
    logger.info('Processo worker finalizado com seguranca');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Falha fatal no processo Worker');
  process.exit(1);
});
