import { Worker } from 'bullmq';
import { WebhookEventStatus } from '@crm/shared';
import { prisma } from '../../db/prisma.js';
import { logger } from '../../lib/logger.js';
import { createQueueConnection } from '../../lib/redis.js';
import { QueueName, type InboundJobData } from '../jobs.js';
import { reviveEvent } from '../../modules/messages/inbound.js';
import { processInboundMessage, processStatusUpdate } from '../../modules/messages/processor.js';

export function createInboundWorker(): Worker<InboundJobData> {
  const connection = createQueueConnection('worker:inbound');

  const worker = new Worker<InboundJobData>(
    QueueName.INBOUND,
    async (job) => {
      const { webhookEventId, channelId } = job.data;

      const event = await prisma.webhookEvent.findUnique({
        where: { id: webhookEventId },
        include: { channel: true },
      });

      if (!event || event.status === WebhookEventStatus.PROCESSED) {
        return;
      }

      await prisma.webhookEvent.update({
        where: { id: event.id },
        data: { status: WebhookEventStatus.PROCESSING, attempts: { increment: 1 } },
      });

      try {
        const normalized = reviveEvent(event.payload);
        if (!normalized) {
          await prisma.webhookEvent.update({
            where: { id: event.id },
            data: { status: WebhookEventStatus.SKIPPED },
          });
          return;
        }

        if (normalized.kind === 'message') {
          await processInboundMessage(event.channel, normalized.message);
        } else if (normalized.kind === 'status') {
          await processStatusUpdate(event.channel, normalized.status);
        }

        await prisma.webhookEvent.update({
          where: { id: event.id },
          data: { status: WebhookEventStatus.PROCESSED, processedAt: new Date() },
        });
      } catch (error) {
        logger.error({ err: error, webhookEventId }, 'Falha ao processar evento inbound');
        await prisma.webhookEvent.update({
          where: { id: event.id },
          data: {
            status: WebhookEventStatus.FAILED,
            error: error instanceof Error ? error.message : String(error),
          },
        });
        throw error;
      }
    },
    {
      connection,
      concurrency: 5,
    },
  );

  worker.on('error', (err) => logger.error({ err }, 'Erro no inbound worker'));
  return worker;
}
