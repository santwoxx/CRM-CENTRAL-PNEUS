import {
  ConversationStatus,
  MessageDirection,
  MessageSenderType,
  MessageStatus,
  MessageType,
} from '@crm/shared';
import { prisma, Prisma } from '../../db/prisma.js';
import { logger } from '../../lib/logger.js';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { isWindowOpen } from '../../lib/time.js';
import { enqueueOutbound } from '../../queue/queues.js';
import { messageInclude, toMessageDTO } from '../conversations/serializer.js';
import { emitMessageNew } from '../../realtime/emitter.js';

/**
 * Outbox de mensagens.
 *
 * O padrao aqui e "persistir primeiro, entregar depois". A mensagem SEMPRE
 * nasce no banco com status PENDING antes de qualquer chamada ao provedor.
 * Consequencias:
 *
 *  - Se o processo cair entre gravar e enfileirar, a varredura do outbox
 *    encontra a mensagem parada e reenfileira. Nada se perde.
 *  - O atendente ve a mensagem na tela imediatamente, com o status real
 *    (enviando / enviada / entregue / lida / falhou).
 *  - `clientMessageId` torna o envio idempotente: dois cliques no botao, ou
 *    um retry do navegador, produzem uma unica mensagem.
 */

export interface CreateOutboundInput {
  conversationId: string;
  type?: MessageType;
  content?: string | null;
  payload?: Record<string, unknown> | null;
  mediaId?: string | null;
  replyToMessageId?: string | null;
  senderType: MessageSenderType;
  senderUserId?: string | null;
  isPrivate?: boolean;
  clientMessageId?: string | null;
  /** Pula a checagem da janela de 24h (usado por template aprovado). */
  bypassWindowCheck?: boolean;
  /**
   * Permite enviar para quem se descadastrou. Reservado a UMA coisa: a
   * confirmacao do proprio descadastramento. Qualquer outro uso quebra a
   * exigencia da Meta e expoe o numero a denuncia.
   */
  bypassOptOut?: boolean;
}

export interface CreateOutboundResult {
  messageId: string;
  duplicated: boolean;
}

export async function createOutboundMessage(
  input: CreateOutboundInput,
): Promise<CreateOutboundResult> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: input.conversationId },
    select: {
      id: true,
      orgId: true,
      channelId: true,
      departmentId: true,
      assignedUserId: true,
      status: true,
      windowExpiresAt: true,
      contact: { select: { isBlocked: true, optedOutAt: true } },
    },
  });

  if (!conversation) throw new NotFoundError('Conversa');

  const isPrivate = input.isPrivate ?? false;
  const type = input.type ?? MessageType.TEXT;

  if (!isPrivate && conversation.contact.isBlocked) {
    throw new ConflictError('Este contato esta bloqueado', 'CONTACT_BLOCKED');
  }

  /**
   * Cliente descadastrado nao recebe mais nada.
   *
   * A barreira fica AQUI, e nao em quem chama, de proposito: e o unico ponto
   * por onde toda mensagem passa. Espalhada pelos chamadores, uma rota nova
   * esqueceria a checagem e o descumprimento voltaria sem ninguem perceber.
   *
   * Vale inclusive para mensagem digitada por atendente: se ele responder sem
   * repararna etiqueta na tela, o sistema recusa e explica.
   */
  if (!isPrivate && !input.bypassOptOut && conversation.contact.optedOutAt) {
    throw new ConflictError(
      'Este cliente pediu para nao receber mensagens (descadastrou-se). ' +
        'Ele volta a receber se escrever VOLTAR.',
      'CONTACT_OPTED_OUT',
    );
  }

  // Fora da janela de 24h o WhatsApp so aceita template aprovado. Barrar aqui
  // da um erro claro ao atendente em vez de uma falha silenciosa la na frente.
  if (
    !isPrivate &&
    !input.bypassWindowCheck &&
    type !== MessageType.TEMPLATE &&
    !isWindowOpen(conversation.windowExpiresAt)
  ) {
    throw new ValidationError(
      'A janela de 24 horas do WhatsApp expirou. Use um modelo aprovado para reabrir a conversa.',
      [{ path: 'type', message: 'WINDOW_CLOSED' }],
    );
  }

  try {
    const message = await prisma.message.create({
      data: {
        orgId: conversation.orgId,
        conversationId: conversation.id,
        channelId: conversation.channelId,
        direction: MessageDirection.OUTBOUND,
        senderType: input.senderType,
        senderUserId: input.senderUserId ?? null,
        type,
        content: input.content ?? null,
        payload: (input.payload ?? undefined) as never,
        mediaId: input.mediaId ?? null,
        replyToMessageId: input.replyToMessageId ?? null,
        isPrivate,
        clientMessageId: input.clientMessageId ?? null,
        // Nota interna nunca vai para o provedor: ja nasce entregue.
        status: isPrivate ? MessageStatus.SENT : MessageStatus.PENDING,
        sentAt: isPrivate ? new Date() : null,
      },
      include: messageInclude,
    });

    await afterCreate(conversation, message, isPrivate);

    return { messageId: message.id, duplicated: false };
  } catch (error) {
    // Colisao em (conversationId, clientMessageId): o envio ja aconteceu.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002' &&
      input.clientMessageId
    ) {
      const existing = await prisma.message.findFirst({
        where: {
          conversationId: input.conversationId,
          clientMessageId: input.clientMessageId,
        },
        select: { id: true },
      });

      if (existing) {
        logger.info(
          { conversationId: input.conversationId, clientMessageId: input.clientMessageId },
          'Envio duplicado ignorado (idempotencia)',
        );
        return { messageId: existing.id, duplicated: true };
      }
    }

    throw error;
  }
}

type ConversationContext = {
  id: string;
  orgId: string;
  channelId: string;
  departmentId: string | null;
  assignedUserId: string | null;
  status: string;
};

/**
 * Depois de gravar: atualiza a conversa, mostra na tela e enfileira o envio.
 * O enfileiramento e o ULTIMO passo de proposito - se ele falhar, a mensagem
 * ja esta salva e a varredura do outbox a reenfileira.
 */
async function afterCreate(
  conversation: ConversationContext,
  message: { id: string },
  isPrivate: boolean,
): Promise<void> {
  const now = new Date();

  if (!isPrivate) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt: now,
        lastAgentMessageAt: now,
        // Cliente respondido: a conversa passa a aguardar o retorno dele.
        ...(conversation.status === ConversationStatus.ASSIGNED
          ? { status: ConversationStatus.PENDING }
          : {}),
      },
    });

    // A primeira resposta fecha o SLA. O `where` com `firstResponseAt: null`
    // garante que apenas a PRIMEIRA resposta marca o horario - as seguintes
    // nao sobrescrevem, senao o relatorio de tempo de resposta mentiria.
    await prisma.conversation.updateMany({
      where: { id: conversation.id, firstResponseAt: null },
      data: { firstResponseAt: now, slaBreached: false },
    });
  } else {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: now },
    });
  }

  const full = await prisma.message.findUnique({
    where: { id: message.id },
    include: messageInclude,
  });

  if (full) {
    await emitMessageNew(
      {
        orgId: conversation.orgId,
        conversationId: conversation.id,
        departmentId: conversation.departmentId,
        assignedUserId: conversation.assignedUserId,
      },
      toMessageDTO(full),
    );
  }

  if (!isPrivate) {
    await enqueueOutbound({ messageId: message.id });
  }
}

/**
 * Mensagem automatica do sistema para o cliente (aviso de fila, encerramento).
 * Nunca lanca: um aviso que falha jamais pode quebrar o fluxo que o disparou.
 */
export async function queueSystemMessage(
  conversationId: string,
  content: string,
  options: {
    payload?: Record<string, unknown>;
    type?: MessageType;
    /** Apenas para a confirmacao do proprio descadastramento. */
    bypassOptOut?: boolean;
  } = {},
): Promise<string | null> {
  try {
    const result = await createOutboundMessage({
      conversationId,
      type: options.type ?? MessageType.TEXT,
      content,
      payload: options.payload ?? null,
      senderType: MessageSenderType.SYSTEM,
      bypassOptOut: options.bypassOptOut ?? false,
    });
    return result.messageId;
  } catch (error) {
    logger.warn({ err: error, conversationId }, 'Nao foi possivel enviar mensagem do sistema');
    return null;
  }
}

/** Mensagem gerada pela IA. Mesma trilha de qualquer outra: passa pelo outbox. */
export async function queueAiMessage(
  conversationId: string,
  content: string,
  options: { payload?: Record<string, unknown>; type?: MessageType } = {},
): Promise<string | null> {
  try {
    const result = await createOutboundMessage({
      conversationId,
      type: options.type ?? MessageType.TEXT,
      content,
      payload: options.payload ?? null,
      senderType: MessageSenderType.AI,
    });
    return result.messageId;
  } catch (error) {
    logger.error({ err: error, conversationId }, 'Falha ao enfileirar mensagem da IA');
    return null;
  }
}

/**
 * Rede de seguranca do outbox.
 *
 * Procura mensagens que ficaram para tras - gravadas mas nunca enfileiradas,
 * ou cujo job sumiu do Redis - e as coloca de volta na fila. Roda de tempos
 * em tempos; e o que transforma "quase sempre entrega" em "sempre entrega".
 */
export async function sweepOutbox(olderThanSeconds = 60): Promise<number> {
  const threshold = new Date(Date.now() - olderThanSeconds * 1_000);

  const stuck = await prisma.message.findMany({
    where: {
      direction: MessageDirection.OUTBOUND,
      isPrivate: false,
      status: { in: [MessageStatus.PENDING, MessageStatus.QUEUED] as never },
      createdAt: { lt: threshold },
      // Depois de muitas tentativas paramos: insistir para sempre esconderia
      // um problema real de configuracao do canal.
      attempts: { lt: 15 },
    },
    select: { id: true, attempts: true },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });

  for (const message of stuck) {
    await enqueueOutbound({ messageId: message.id, attempt: message.attempts });
  }

  if (stuck.length > 0) {
    logger.warn({ count: stuck.length }, 'Mensagens presas reenfileiradas pelo outbox');
  }

  return stuck.length;
}
