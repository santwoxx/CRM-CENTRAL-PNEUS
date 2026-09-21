import { Worker } from 'bullmq';
import {
  MessageStatus,
  MessageType,
  outboundInteractiveSchema,
  outboundTemplateSchema,
} from '@crm/shared';
import { prisma } from '../../db/prisma.js';
import { logger } from '../../lib/logger.js';
import { createQueueConnection } from '../../lib/redis.js';
import { QueueName, type OutboundJobData } from '../jobs.js';
import { getAdapter } from '../../channels/registry.js';
import { emitMessageStatus } from '../../realtime/emitter.js';
import { storage } from '../../modules/media/storage.js';

type RealtimeConversation = {
  id: string;
  orgId: string;
  departmentId: string | null;
  assignedUserId: string | null;
};

async function markOutboundFailed(
  messageId: string,
  conversation: RealtimeConversation,
  reason: string,
): Promise<void> {
  await prisma.message.update({
    where: { id: messageId },
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
      messageId,
      status: MessageStatus.FAILED,
      failureReason: reason,
    },
  );
}

function payloadMember(payload: unknown, member: string): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  return (payload as Record<string, unknown>)[member];
}

/** Processa uma mensagem isolada; exportada para validar o envio sem subir Redis. */
export async function processOutboundMessage(messageId: string): Promise<void> {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    include: {
      conversation: {
        include: {
          contact: true,
        },
      },
      media: true,
      replyTo: { select: { externalId: true } },
    },
  });

  if (
    !message ||
    message.isPrivate ||
    message.status === MessageStatus.SENT ||
    message.status === MessageStatus.DELIVERED ||
    message.status === MessageStatus.READ
  ) {
    return;
  }

  const conversation = message.conversation;
  const contact = conversation.contact;

  // A politica precisa ser relida aqui. Entre o clique em "enviar" e a vez
  // do job, o cliente pode ter bloqueado o contato ou escrito PARE.
  const policyFailure = contact.isBlocked
    ? 'Envio cancelado: o contato foi bloqueado antes da entrega'
    : contact.optedOutAt && !message.allowOptedOutDelivery
      ? 'Envio cancelado: o cliente pediu para nao receber mensagens'
      : null;

  if (policyFailure) {
    await markOutboundFailed(message.id, conversation, policyFailure);
    logger.warn({ messageId: message.id, contactId: contact.id }, policyFailure);
    return;
  }

  await prisma.message.update({
    where: { id: message.id },
    data: { attempts: { increment: 1 } },
  });

  try {
    const recipientPhone = contact.phone;
    if (!recipientPhone) {
      throw new Error(`Contato ${contact.id} nao possui telefone valido para envio`);
    }

    const adapter = await getAdapter(message.channelId);
    const replyToExternalId = message.replyTo?.externalId ?? null;
    let externalId: string;

    switch (message.type) {
      case MessageType.TEXT: {
        if (!message.content?.trim()) throw new Error('Mensagem de texto sem conteudo');
        const result = await adapter.sendText({
          to: recipientPhone,
          text: message.content,
          replyToExternalId,
        });
        externalId = result.externalId;
        break;
      }

      case MessageType.IMAGE:
      case MessageType.AUDIO:
      case MessageType.VIDEO:
      case MessageType.DOCUMENT: {
        if (!message.media) throw new Error(`Mensagem ${message.type} sem arquivo de midia`);

        const mediaStream = storage.read(message.media.storageKey);
        const chunks: Buffer[] = [];
        for await (const chunk of mediaStream) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }

        const result = await adapter.sendMedia({
          to: recipientPhone,
          buffer: Buffer.concat(chunks),
          caption: message.content ?? undefined,
          fileName: message.media.fileName ?? undefined,
          mimeType: message.media.mimeType,
          replyToExternalId,
        });
        externalId = result.externalId;
        break;
      }

      case MessageType.INTERACTIVE: {
        const parsed = outboundInteractiveSchema.safeParse(
          payloadMember(message.payload, 'interactive'),
        );
        if (!parsed.success) throw new Error('Mensagem interativa sem payload valido');

        const result = await adapter.sendInteractive({
          to: recipientPhone,
          ...parsed.data,
          replyToExternalId,
        });
        externalId = result.externalId;
        break;
      }

      case MessageType.TEMPLATE: {
        const parsed = outboundTemplateSchema.safeParse(payloadMember(message.payload, 'template'));
        if (!parsed.success) throw new Error('Mensagem de template sem payload valido');

        const result = await adapter.sendTemplate({
          to: recipientPhone,
          ...parsed.data,
        });
        externalId = result.externalId;
        break;
      }

      default:
        throw new Error(`Tipo de mensagem outbound nao suportado: ${message.type}`);
    }

    if (!externalId) throw new Error('Provedor nao devolveu o id da mensagem');

    const now = new Date();
    await prisma.message.update({
      where: { id: message.id },
      data: {
        status: MessageStatus.SENT,
        sentAt: now,
        externalId,
        failedAt: null,
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

    await markOutboundFailed(message.id, conversation, reason);
    throw error;
  }
}

export function createOutboundWorker(): Worker<OutboundJobData> {
  const connection = createQueueConnection('worker:outbound');

  const worker = new Worker<OutboundJobData>(
    QueueName.OUTBOUND,
    async (job) => {
      await processOutboundMessage(job.data.messageId);
    },
    {
      connection,
      concurrency: 5,
    },
  );

  worker.on('error', (err) => logger.error({ err }, 'Erro no outbound worker'));
  return worker;
}
