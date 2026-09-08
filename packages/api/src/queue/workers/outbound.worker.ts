import { Worker } from 'bullmq';
import { MessageStatus, MessageType } from '@crm/shared';
import { prisma } from '../../db/prisma.js';
import { logger } from '../../lib/logger.js';
import { createQueueConnection } from '../../lib/redis.js';
import { QueueName, type OutboundJobData } from '../jobs.js';
import { getAdapter } from '../../channels/registry.js';
import { emitMessageStatus } from '../../realtime/emitter.js';
import { storage } from '../../modules/media/storage.js';

export function createOutboundWorker(): Worker<OutboundJobData> {
  const connection = createQueueConnection('worker:outbound');

  const worker = new Worker<OutboundJobData>(
    QueueName.OUTBOUND,
    async (job) => {
      const { messageId } = job.data;

      const message = await prisma.message.findUnique({
        where: { id: messageId },
        include: {
          conversation: {
            include: {
              contact: {
                include: { identities: true },
              },
            },
          },
          media: true,
        },
      });

      if (!message || message.status === MessageStatus.SENT || message.isPrivate) {
        return;
      }

      const conversation = message.conversation;
      const contact = conversation.contact;
      const recipientPhone = contact.phone;

      if (!recipientPhone) {
        throw new Error(`Contato ${contact.id} nao possui telefone valido para envio`);
      }

      await prisma.message.update({
        where: { id: message.id },
        data: { attempts: { increment: 1 } },
      });

      try {
        const adapter = await getAdapter(message.channelId);
        let externalId: string | null = null;

        if (message.type === MessageType.TEXT) {
          const res = await adapter.sendText({
            to: recipientPhone,
            text: message.content || '',
          });
          externalId = res.externalId;
        } else if (message.media) {
          const mediaStream = storage.read(message.media.storageKey);
          const chunks: Buffer[] = [];
          for await (const chunk of mediaStream) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          const buffer = Buffer.concat(chunks);

          const res = await adapter.sendMedia({
            to: recipientPhone,
            buffer,
            caption: message.content ?? undefined,
            fileName: message.media.fileName ?? undefined,
            mimeType: message.media.mimeType,
          });
          externalId = res.externalId;
        }

        const now = new Date();
        await prisma.message.update({
          where: { id: message.id },
          data: {
            status: MessageStatus.SENT,
            sentAt: now,
            externalId: externalId ?? undefined,
            failureReason: null,
          },
        });

        await emitMessageStatus(
          {
            orgId: conversation.orgId,
            conversationId: conversation.id,
            departmentId: conversation.departmentId,
            assignedUserId: conversation.assignedUserId,
          },
          {
            messageId: message.id,
            status: MessageStatus.SENT,
          },
        );

        logger.info({ messageId: message.id, externalId }, 'Mensagem enviada com sucesso');
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        logger.error({ err: error, messageId: message.id }, 'Falha no envio outbound');

        await prisma.message.update({
          where: { id: message.id },
          data: {
            status: MessageStatus.FAILED,
            failedAt: new Date(),
            failureReason: reason,
          },
        });

        await emitMessageStatus(
          {
            orgId: conversation.orgId,
            conversationId: conversation.id,
            departmentId: conversation.departmentId,
            assignedUserId: conversation.assignedUserId,
          },
          {
            messageId: message.id,
            status: MessageStatus.FAILED,
            failureReason: reason,
          },
        );

        throw error;
      }
    },
    {
      connection,
      concurrency: 5,
    },
  );

  worker.on('error', (err) => logger.error({ err }, 'Erro no outbound worker'));
  return worker;
}
