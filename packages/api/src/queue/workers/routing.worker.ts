import { Worker } from 'bullmq';
import { logger } from '../../lib/logger.js';
import { createQueueConnection } from '../../lib/redis.js';
import { QueueName, type RoutingJobData } from '../jobs.js';
import { routeConversation } from '../../modules/routing/router.js';

export function createRoutingWorker(): Worker<RoutingJobData> {
  const connection = createQueueConnection('worker:routing');

  const worker = new Worker<RoutingJobData>(
    QueueName.ROUTING,
    async (job) => {
      const { conversationId, reason, departmentId, preferredUserId, actorUserId } = job.data;
      logger.debug({ conversationId, reason, departmentId }, 'Executando roteamento de conversa');
      await routeConversation(conversationId, {
        reason,
        departmentId,
        preferredUserId,
        actorUserId,
      });
    },
    {
      connection,
      concurrency: 5,
    },
  );

  worker.on('error', (err) => logger.error({ err }, 'Erro no routing worker'));
  return worker;
}
