import { ChannelType, WebhookEventStatus } from '@crm/shared';
import { prisma, Prisma } from '../../db/prisma.js';
import { sha256 } from '../../lib/crypto.js';
import { logger } from '../../lib/logger.js';
import { enqueueInbound } from '../../queue/queues.js';
import { eventExternalId, parseWebhookPayload } from '../../channels/registry.js';
import type { NormalizedEvent, NormalizedInboundMessage, NormalizedStatusUpdate } from '../../channels/types.js';

/**
 * Recepcao de webhook.
 *
 * O endpoint HTTP faz o minimo possivel: valida a assinatura, GRAVA o evento
 * e responde 200. Todo o trabalho pesado acontece depois, no worker.
 *
 * Por que assim: a Meta desiste do webhook se demorarmos e passa a reentregar
 * tudo em lote - o que vira uma avalanche. Respondendo rapido, ela para de
 * reenviar; e como ja gravamos, nada se perde mesmo que o processamento falhe
 * dez minutos depois.
 *
 * A deduplicacao vive na restricao unica (channelId, externalId, eventType).
 * Reentrega do mesmo evento colide, e a colisao e simplesmente ignorada.
 */

export interface IngestResult {
  received: number;
  duplicated: number;
  ignored: number;
}

export async function ingestWebhook(
  channelId: string,
  channelType: ChannelType,
  body: unknown,
): Promise<IngestResult> {
  const events = parseWebhookPayload(channelType, body);
  const result: IngestResult = { received: 0, duplicated: 0, ignored: 0 };

  for (const event of events) {
    if (event.kind === 'ignored') {
      result.ignored += 1;
      logger.debug({ channelId, reason: event.reason }, 'Evento de webhook ignorado');
      continue;
    }

    const externalId = eventExternalId(event);
    if (!externalId) {
      result.ignored += 1;
      continue;
    }

    // As datas viram string no JSON; o processamento as reconstroi.
    const serialized = JSON.parse(JSON.stringify(event)) as unknown;

    try {
      const stored = await prisma.webhookEvent.create({
        data: {
          channelId,
          externalId,
          eventType: event.kind,
          payload: serialized as never,
          payloadHash: sha256(JSON.stringify(serialized)),
          status: WebhookEventStatus.RECEIVED,
        },
        select: { id: true },
      });

      await enqueueInbound({ webhookEventId: stored.id, channelId });
      result.received += 1;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        result.duplicated += 1;
        logger.debug({ channelId, externalId }, 'Evento duplicado descartado');

        // A primeira entrega pode ter sido gravada no banco e falhado antes
        // de chegar ao Redis. Nesse caso, a reentrega e justamente a chance
        // de recuperar o evento; chama-la apenas de duplicada o perderia.
        const existing = await prisma.webhookEvent.findUnique({
          where: {
            channelId_externalId_eventType: {
              channelId,
              externalId,
              eventType: event.kind,
            },
          },
          select: { id: true, status: true },
        });
        if (
          existing &&
          (existing.status === WebhookEventStatus.RECEIVED ||
            existing.status === WebhookEventStatus.PROCESSING ||
            existing.status === WebhookEventStatus.FAILED)
        ) {
          await enqueueInbound({ webhookEventId: existing.id, channelId });
        }
        continue;
      }
      throw error;
    }
  }

  return result;
}

/** Reenfileira eventos que ficaram salvos durante uma indisponibilidade do Redis. */
export async function sweepInbound(olderThanSeconds = 30): Promise<number> {
  const threshold = new Date(Date.now() - olderThanSeconds * 1_000);
  const stuck = await prisma.webhookEvent.findMany({
    where: {
      status: {
        in: [
          WebhookEventStatus.RECEIVED,
          WebhookEventStatus.PROCESSING,
          WebhookEventStatus.FAILED,
        ],
      },
      receivedAt: { lt: threshold },
      attempts: { lt: 15 },
    },
    select: { id: true, channelId: true },
    orderBy: { receivedAt: 'asc' },
    take: 200,
  });

  for (const event of stuck) {
    await enqueueInbound({ webhookEventId: event.id, channelId: event.channelId });
  }

  if (stuck.length > 0) {
    logger.warn({ count: stuck.length }, 'Webhooks presos reenfileirados');
  }
  return stuck.length;
}

/** Reconstroi as datas que o JSON transformou em string. */
function reviveEvent(payload: unknown): NormalizedEvent | null {
  const event = payload as NormalizedEvent | null;
  if (!event || typeof event !== 'object' || !('kind' in event)) return null;

  if (event.kind === 'message') {
    const message = event.message as NormalizedInboundMessage & { timestamp: string | Date };
    return { kind: 'message', message: { ...message, timestamp: new Date(message.timestamp) } };
  }

  if (event.kind === 'status') {
    const status = event.status as NormalizedStatusUpdate & { timestamp: string | Date };
    return { kind: 'status', status: { ...status, timestamp: new Date(status.timestamp) } };
  }

  return event;
}

export { reviveEvent };
