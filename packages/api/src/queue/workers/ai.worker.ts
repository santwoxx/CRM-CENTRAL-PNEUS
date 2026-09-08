import { Worker } from 'bullmq';
import { logger } from '../../lib/logger.js';
import { createQueueConnection } from '../../lib/redis.js';
import { QueueName, type AiJobData } from '../jobs.js';
import { generateAiReply } from '../../modules/ai/service.js';

export function createAiWorker(): Worker<AiJobData> {
  const connection = createQueueConnection('worker:ai');

  const worker = new Worker<AiJobData>(
    QueueName.AI,
    async (job) => {
      const { conversationId, triggerMessageId } = job.data;
      logger.debug({ conversationId, triggerMessageId }, 'Processando resposta da IA');
      await generateAiReply(conversationId, triggerMessageId);
    },
    {
      connection,
      concurrency: 3,
    },
  );

  worker.on('error', (err) => logger.error({ err }, 'Erro no AI worker'));
  return worker;
}
