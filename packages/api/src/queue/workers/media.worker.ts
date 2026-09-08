import { Worker } from 'bullmq';
import { logger } from '../../lib/logger.js';
import { createQueueConnection } from '../../lib/redis.js';
import { QueueName, type MediaJobData } from '../jobs.js';
import { downloadAndSaveMedia } from '../../modules/media/service.js';

export function createMediaWorker(): Worker<MediaJobData> {
  const connection = createQueueConnection('worker:media');

  const worker = new Worker<MediaJobData>(
    QueueName.MEDIA,
    async (job) => {
      logger.debug({ messageId: job.data.messageId }, 'Baixando midia assincrona');
      await downloadAndSaveMedia(job.data);
    },
    {
      connection,
      concurrency: 3,
    },
  );

  worker.on('error', (err) => logger.error({ err }, 'Erro no media worker'));
  return worker;
}
