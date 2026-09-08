import { Worker } from 'bullmq';
import { ConversationEventType, ConversationStatus } from '@crm/shared';
import { prisma } from '../../db/prisma.js';
import { logger } from '../../lib/logger.js';
import { createQueueConnection } from '../../lib/redis.js';
import { MaintenanceTask, QueueName, type MaintenanceJobData } from '../jobs.js';
import { applyAutoAway } from '../../modules/routing/presence.js';
import { sweepOutbox } from '../../modules/messages/outbox.js';
import { drainQueue, escalateStaleQueue } from '../../modules/routing/router.js';
import { emitSystemAlert } from '../../realtime/emitter.js';

export function createMaintenanceWorker(): Worker<MaintenanceJobData> {
  const connection = createQueueConnection('worker:maintenance');

  const worker = new Worker<MaintenanceJobData>(
    QueueName.MAINTENANCE,
    async (job) => {
      const task = job.data.task;
      logger.debug({ task }, 'Executando tarefa de manutencao');

      const orgs = await prisma.organization.findMany({ select: { id: true } });

      switch (task) {
        case MaintenanceTask.AGENT_AUTO_AWAY:
          await applyAutoAway();
          break;

        case MaintenanceTask.OUTBOX_SWEEP:
          await sweepOutbox();
          break;

        case MaintenanceTask.QUEUE_DRAIN:
          for (const org of orgs) {
            await drainQueue(org.id);
          }
          break;

        case MaintenanceTask.QUEUE_ESCALATION:
          for (const org of orgs) {
            await escalateStaleQueue(org.id);
          }
          break;

        case MaintenanceTask.SLA_SWEEP: {
          const now = new Date();
          const breached = await prisma.conversation.findMany({
            where: {
              status: ConversationStatus.ASSIGNED,
              slaFirstResponseDueAt: { lt: now },
              slaBreached: false,
              firstResponseAt: null,
            },
            include: {
              assignedUser: true,
              contact: true,
            },
          });

          for (const conv of breached) {
            await prisma.conversation.update({
              where: { id: conv.id },
              data: { slaBreached: true },
            });

            await prisma.conversationEvent.create({
              data: {
                conversationId: conv.id,
                type: ConversationEventType.SLA_BREACHED,
                data: { assignedUserId: conv.assignedUserId },
              },
            });

            await emitSystemAlert(conv.orgId, {
              level: 'warning',
              code: 'SLA_BREACHED',
              message: `SLA de 1ª resposta estourado na conversa com ${conv.contact.name || conv.contact.phone} (Atendente: ${conv.assignedUser?.name || 'Nenhum'})`,
            });
          }
          break;
        }

        case MaintenanceTask.AUTO_CLOSE: {
          const autoCloseThreshold = new Date(Date.now() - 3 * 60 * 60 * 1000); // 3 horas ocioso
          const idleConvs = await prisma.conversation.findMany({
            where: {
              status: { in: [ConversationStatus.ASSIGNED, ConversationStatus.PENDING] },
              lastMessageAt: { lt: autoCloseThreshold },
            },
            select: { id: true, orgId: true },
          });

          for (const conv of idleConvs) {
            await prisma.conversation.update({
              where: { id: conv.id },
              data: {
                status: ConversationStatus.RESOLVED,
                resolvedAt: new Date(),
              },
            });

            await prisma.conversationEvent.create({
              data: {
                conversationId: conv.id,
                type: ConversationEventType.AUTO_CLOSED,
                data: { reason: 'Inatividade prolongada' },
              },
            });
          }
          break;
        }

        case MaintenanceTask.SESSION_CLEANUP:
          await prisma.session.deleteMany({
            where: { expiresAt: { lt: new Date() } },
          });
          break;

        case MaintenanceTask.WEBHOOK_CLEANUP: {
          const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          await prisma.webhookEvent.deleteMany({
            where: { receivedAt: { lt: sevenDaysAgo } },
          });
          break;
        }

        default:
          logger.debug({ task }, 'Tarefa de manutencao desconhecida ou sem acao');
      }
    },
    {
      connection,
      concurrency: 2,
    },
  );

  worker.on('error', (err) => logger.error({ err }, 'Erro no maintenance worker'));
  return worker;
}
