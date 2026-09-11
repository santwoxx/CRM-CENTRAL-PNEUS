import {
  ConversationEventType,
  ConversationStatus,
  MESSAGE_STATUS_RANK,
  MessageDirection,
  MessageSenderType,
  MessageStatus,
  MessageType,
  OPEN_CONVERSATION_STATUSES,
  type MessageStatus as MessageStatusType,
} from '@crm/shared';
import { prisma, Prisma } from '../../db/prisma.js';
import { logger } from '../../lib/logger.js';
import { env } from '../../env.js';
import { whatsappWindowExpiry } from '../../lib/time.js';
import { enqueueAi, enqueueMedia, enqueueRouting } from '../../queue/queues.js';
import { HandoffReason } from '@crm/shared';
import { resolveContact } from '../contacts/resolver.js';
import {
  interpretarPedidoDeContato,
  registrarDescadastramento,
  registrarRetorno,
} from '../contacts/optOut.js';
import { queueSystemMessage } from './outbox.js';
import {
  conversationInclude,
  messageInclude,
  toConversationSummary,
  toMessageDTO,
} from '../conversations/serializer.js';
import {
  emitConversationCreated,
  emitConversationUpdated,
  emitMessageNew,
  emitMessageStatus,
} from '../../realtime/emitter.js';
import type { NormalizedInboundMessage, NormalizedStatusUpdate } from '../../channels/types.js';

/**
 * Processamento de uma mensagem recebida.
 *
 * Ordem deliberada, do mais importante para o menos:
 *   1. GRAVAR a mensagem. Se so isso der certo, ninguem perdeu nada - o
 *      atendente ve a mensagem e responde na mao.
 *   2. Atualizar a conversa (contadores, janela de 24h, status).
 *   3. Avisar as telas.
 *   4. Disparar IA / roteamento.
 *
 * Cada etapa depende da anterior ter dado certo, e nenhuma etapa posterior
 * pode desfazer uma anterior.
 */

export interface ProcessedMessage {
  messageId: string;
  conversationId: string;
  duplicated: boolean;
}

export async function processInboundMessage(
  channel: { id: string; orgId: string; type: string },
  incoming: NormalizedInboundMessage,
): Promise<ProcessedMessage | null> {
  const contact = await resolveContact({
    orgId: channel.orgId,
    channelId: channel.id,
    externalId: incoming.from,
    phone: incoming.phone,
    pushName: incoming.pushName,
  });

  const conversation = await resolveConversation({
    orgId: channel.orgId,
    channelId: channel.id,
    contactId: contact.id,
    isReturning: contact.isReturning,
    preferredAgentId: contact.preferredAgentId,
    lastDepartmentId: contact.lastDepartmentId,
  });

  const message = await persistInboundMessage(channel, conversation.id, incoming);
  if (!message) {
    return { messageId: '', conversationId: conversation.id, duplicated: true };
  }

  await updateConversationAfterInbound(conversation.id, incoming, channel.orgId);

  // Contato bloqueado: a mensagem fica registrada no historico, mas nada
  // e disparado - nem IA, nem fila, nem notificacao.
  if (contact.isBlocked) {
    logger.info({ contactId: contact.id, conversationId: conversation.id }, 'Contato bloqueado');
    return { messageId: message.id, conversationId: conversation.id, duplicated: false };
  }

  if (incoming.media?.externalId) {
    await enqueueMedia({
      messageId: message.id,
      channelId: channel.id,
      externalMediaId: incoming.media.externalId,
      mimeType: incoming.media.mimeType,
      fileName: incoming.media.fileName ?? undefined,
    });
  }

  await decideNextAction(conversation.id, message.id, incoming);

  return { messageId: message.id, conversationId: conversation.id, duplicated: false };
}

interface ResolveConversationInput {
  orgId: string;
  channelId: string;
  contactId: string;
  isReturning: boolean;
  preferredAgentId: string | null;
  lastDepartmentId: string | null;
}

/**
 * Encontra a conversa aberta ou abre uma nova.
 *
 * Uma conversa RESOLVIDA nunca e reaberta automaticamente: a mensagem nova
 * comeca um atendimento novo, com fila e SLA proprios. Reaproveitar a antiga
 * mascararia o tempo de espera real do cliente nos relatorios.
 */
async function resolveConversation(input: ResolveConversationInput): Promise<{ id: string; created: boolean }> {
  const open = await prisma.conversation.findFirst({
    where: {
      contactId: input.contactId,
      channelId: input.channelId,
      status: { in: OPEN_CONVERSATION_STATUSES as never },
    },
    orderBy: { lastMessageAt: 'desc' },
    select: { id: true },
  });

  if (open) return { id: open.id, created: false };

  const aiActive =
    env.AI_ENABLED &&
    env.AI_PROVIDER !== 'disabled' &&
    (await prisma.aiPersona.count({ where: { orgId: input.orgId, isActive: true } })) > 0;

  const conversation = await prisma.conversation.create({
    data: {
      orgId: input.orgId,
      contactId: input.contactId,
      channelId: input.channelId,
      departmentId: input.lastDepartmentId,
      status: aiActive ? ConversationStatus.BOT : ConversationStatus.QUEUED,
      aiControlled: aiActive,
      queuedAt: aiActive ? null : new Date(),
      metadata: { isReturning: input.isReturning } as never,
      events: {
        create: [
          {
            type: ConversationEventType.CREATED,
            data: { isReturning: input.isReturning, aiActive },
          },
        ],
      },
    },
    select: { id: true },
  });

  const full = await prisma.conversation.findUnique({
    where: { id: conversation.id },
    include: conversationInclude,
  });
  if (full) await emitConversationCreated(input.orgId, toConversationSummary(full));

  logger.info(
    { conversationId: conversation.id, contactId: input.contactId, aiActive, isReturning: input.isReturning },
    'Conversa criada',
  );

  return { id: conversation.id, created: true };
}

/**
 * Grava a mensagem recebida.
 * Retorna `null` quando ja existia - a restricao unica (channelId, externalId)
 * e a ultima linha de defesa contra reentrega do provedor.
 */
async function persistInboundMessage(
  channel: { id: string; orgId: string },
  conversationId: string,
  incoming: NormalizedInboundMessage,
): Promise<{ id: string } | null> {
  // Mensagem citada: ligamos a nossa copia, se a tivermos.
  const replyTo = incoming.replyToExternalId
    ? await prisma.message.findFirst({
        where: { channelId: channel.id, externalId: incoming.replyToExternalId },
        select: { id: true },
      })
    : null;

  try {
    const message = await prisma.message.create({
      data: {
        orgId: channel.orgId,
        conversationId,
        channelId: channel.id,
        direction: MessageDirection.INBOUND,
        senderType: MessageSenderType.CONTACT,
        type: incoming.type,
        content: incoming.content,
        payload: (incoming.payload ?? undefined) as never,
        externalId: incoming.externalId,
        replyToMessageId: replyTo?.id ?? null,
        // Mensagem recebida ja nasce entregue: o cliente conseguiu enviar.
        status: MessageStatus.DELIVERED,
        createdAt: incoming.timestamp,
        deliveredAt: incoming.timestamp,
      },
      include: messageInclude,
    });

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { orgId: true, departmentId: true, assignedUserId: true },
    });

    if (conversation) {
      await emitMessageNew(
        {
          orgId: conversation.orgId,
          conversationId,
          departmentId: conversation.departmentId,
          assignedUserId: conversation.assignedUserId,
        },
        toMessageDTO(message),
      );
    }

    return { id: message.id };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      logger.debug({ externalId: incoming.externalId }, 'Mensagem recebida ja existia');
      return null;
    }
    throw error;
  }
}

/**
 * Atualiza a conversa depois de uma mensagem do cliente.
 *
 * A janela de 24h e recalculada aqui: cada mensagem do cliente reabre o
 * periodo em que podemos responder livremente, sem template aprovado.
 */
async function updateConversationAfterInbound(
  conversationId: string,
  incoming: NormalizedInboundMessage,
  orgId: string,
): Promise<void> {
  const current = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { status: true },
  });

  const updated = await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      lastMessageAt: incoming.timestamp,
      lastCustomerMessageAt: incoming.timestamp,
      windowExpiresAt: whatsappWindowExpiry(incoming.timestamp),
      unreadCount: { increment: 1 },
      // O cliente respondeu: a conversa volta a exigir acao do atendente.
      ...(current?.status === ConversationStatus.PENDING
        ? { status: ConversationStatus.ASSIGNED }
        : {}),
    },
    include: conversationInclude,
  });

  await emitConversationUpdated(orgId, toConversationSummary(updated));
}

/**
 * Decide o que acontece depois da mensagem do cliente.
 *
 * Tres caminhos possiveis, nesta ordem de precedencia:
 *   1. O cliente escolheu uma opcao do menu -> roteia direto, sem passar pela IA.
 *   2. A conversa esta com a IA -> a IA responde.
 *   3. A conversa esta na fila -> tenta rotear de novo (pode ter vagado alguem).
 * Se ja tem atendente, nada e disparado: a mensagem apareceu na tela dele.
 */
async function decideNextAction(
  conversationId: string,
  messageId: string,
  incoming: NormalizedInboundMessage,
): Promise<void> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, orgId: true, status: true, aiControlled: true, metadata: true },
  });
  if (!conversation) return;

  /**
   * Descadastramento vem PRIMEIRO, antes de menu, IA e roteamento.
   *
   * Quem pediu para nao ser mais contatado nao pode receber resposta
   * automatica, nem cair na fila de um atendente. Deixar isso para depois de
   * qualquer outro tratamento arrisca uma resposta sair no caminho - e uma
   * so ja e descumprimento.
   */
  const pedido = interpretarPedidoDeContato(incoming.content);
  if (pedido === 'descadastrar') {
    const contato = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { contactId: true },
    });
    if (contato) {
      await registrarDescadastramento(contato.contactId, conversationId, incoming.content ?? '');
    }
    return;
  }
  if (pedido === 'voltar') {
    const contato = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { contactId: true, contact: { select: { optedOutAt: true } } },
    });
    // So responde se ele estava mesmo fora: senao "voltar" numa conversa
    // normal geraria uma resposta sem sentido.
    if (contato?.contact.optedOutAt) {
      await registrarRetorno(contato.contactId, conversationId);
      return;
    }
  }

  const selection = resolveMenuSelection(incoming, conversation.metadata);
  if (selection) {
    await applyMenuSelection(conversation.id, selection);
    return;
  }

  /**
   * Qualquer coisa que nao seja texto vai direto para um humano.
   *
   * O modelo que roda aqui le TEXTO. Ele nao ouve audio nem enxerga imagem.
   * Sem este desvio, o cliente manda um audio e a IA responde no vazio, como
   * se nada tivesse chegado - o pior tipo de falha, porque parece que
   * funcionou.
   *
   * Nao transcrevemos de proposito: transcricao de audio de WhatsApp erra
   * justamente em numero, e numero aqui e medida de pneu. Um "205" virando
   * "215" custa a venda e a viagem do cliente. Um atendente ouve em cinco
   * segundos e resolve.
   *
   * Vale tambem para foto: a IA pede a imagem da lateral do pneu, e quem le
   * a medida nela e a pessoa.
   */
  if (conversation.status === ConversationStatus.BOT && conversation.aiControlled) {
    if (incoming.type !== MessageType.TEXT) {
      await handoffForMedia(conversation, incoming.type);
      return;
    }

    await enqueueAi({ conversationId, triggerMessageId: messageId });
    return;
  }

  if (conversation.status === ConversationStatus.QUEUED) {
    await enqueueRouting({ conversationId, reason: HandoffReason.LEAD_QUALIFIED });
  }
}

interface MenuSelection {
  kind: 'department' | 'agent' | 'bot';
  id: string | null;
}

/**
 * Interpreta a escolha do cliente.
 *
 * No canal oficial vem o id do botao/linha tocado. No canal de contingencia
 * o menu e texto numerado, entao aceitamos tambem a resposta "1", "2"... e a
 * traduzimos pela tabela guardada em `metadata.menuOptions`.
 */
function resolveMenuSelection(
  incoming: NormalizedInboundMessage,
  metadata: unknown,
): MenuSelection | null {
  let replyId = incoming.interactiveReplyId ?? null;

  if (!replyId && incoming.type === MessageType.TEXT) {
    const options = (metadata as { menuOptions?: { index: number; id: string }[] } | null)
      ?.menuOptions;
    const typed = incoming.content?.trim();

    if (options?.length && typed && /^\d{1,2}$/.test(typed)) {
      replyId = options.find((option) => option.index === Number(typed))?.id ?? null;
    }
  }

  if (!replyId) return null;

  const [prefix, value] = replyId.split(':');
  if (prefix === 'dept' && value) return { kind: 'department', id: value };
  if (prefix === 'agent' && value) return { kind: 'agent', id: value };
  if (prefix === 'bot') return { kind: 'bot', id: null };

  return null;
}

async function applyMenuSelection(conversationId: string, selection: MenuSelection): Promise<void> {
  // O menu ja cumpriu seu papel: limpamos para um "1" digitado depois nao ser
  // reinterpretado como escolha de menu.
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { metadata: { menuOptions: [] } as never },
  });

  await prisma.conversationEvent.create({
    data: {
      conversationId,
      type: ConversationEventType.AI_HANDOFF,
      data: { via: 'menu', selection: selection.kind, targetId: selection.id },
    },
  });

  if (selection.kind === 'bot') {
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { status: ConversationStatus.BOT, aiControlled: true },
    });
    return;
  }

  await enqueueRouting({
    conversationId,
    reason:
      selection.kind === 'agent'
        ? HandoffReason.RETURNING_CUSTOMER
        : HandoffReason.MENU_SELECTION,
    departmentId: selection.kind === 'department' ? selection.id : null,
    preferredUserId: selection.kind === 'agent' ? selection.id : null,
  });
}

/**
 * Aplica um callback de status (enviada / entregue / lida / falhou).
 *
 * Os callbacks chegam FORA DE ORDEM com frequencia: "lida" pode bater antes
 * de "entregue". A comparacao por posto (`MESSAGE_STATUS_RANK`) garante que um
 * callback atrasado nunca rebaixe o status ja alcancado - senao a tela do
 * atendente mostraria a mensagem voltando de "lida" para "enviada".
 */
export async function processStatusUpdate(
  channel: { id: string; orgId: string },
  update: NormalizedStatusUpdate,
): Promise<boolean> {
  const message = await prisma.message.findFirst({
    where: { channelId: channel.id, externalId: update.externalId },
    select: {
      id: true,
      status: true,
      conversationId: true,
      conversation: {
        select: { orgId: true, departmentId: true, assignedUserId: true },
      },
    },
  });

  if (!message) {
    // Pode ser uma mensagem enviada antes deste CRM existir, ou um callback
    // que chegou antes do nosso INSERT terminar. Nao e erro.
    logger.debug({ externalId: update.externalId }, 'Callback de status sem mensagem correspondente');
    return false;
  }

  const currentRank = MESSAGE_STATUS_RANK[message.status as MessageStatusType] ?? 0;
  const incomingRank = MESSAGE_STATUS_RANK[update.status] ?? 0;

  // FAILED sempre vale, mesmo chegando depois: e informacao nova e critica.
  if (incomingRank <= currentRank && update.status !== MessageStatus.FAILED) {
    return false;
  }

  const failureReason = update.error
    ? [update.error.code, update.error.title, update.error.details].filter(Boolean).join(' - ')
    : null;

  await prisma.message.update({
    where: { id: message.id },
    data: {
      status: update.status,
      ...(update.status === MessageStatus.SENT ? { sentAt: update.timestamp } : {}),
      ...(update.status === MessageStatus.DELIVERED ? { deliveredAt: update.timestamp } : {}),
      ...(update.status === MessageStatus.READ ? { readAt: update.timestamp } : {}),
      ...(update.status === MessageStatus.FAILED
        ? { failedAt: update.timestamp, failureReason }
        : {}),
    },
  });

  await emitMessageStatus(
    {
      orgId: message.conversation.orgId,
      conversationId: message.conversationId,
      departmentId: message.conversation.departmentId,
      assignedUserId: message.conversation.assignedUserId,
    },
    { messageId: message.id, status: update.status, failureReason },
  );

  if (update.status === MessageStatus.FAILED) {
    logger.error(
      { messageId: message.id, conversationId: message.conversationId, failureReason },
      'Provedor reportou falha no envio da mensagem',
    );
  }

  return true;
}


/** Rotulo do que o cliente enviou, para o aviso sair natural. */
const ROTULO_MIDIA: Partial<Record<MessageType, string>> = {
  [MessageType.AUDIO]: 'seu áudio',
  [MessageType.IMAGE]: 'sua foto',
  [MessageType.VIDEO]: 'seu vídeo',
  [MessageType.DOCUMENT]: 'seu arquivo',
  [MessageType.LOCATION]: 'sua localização',
  [MessageType.CONTACTS]: 'o contato',
  [MessageType.STICKER]: 'sua figurinha',
};

/**
 * Tira a IA da conversa e chama um humano porque chegou algo que ela nao le.
 * O aviso ao cliente e curto e nao pede desculpa: ele fez tudo certo.
 */
async function handoffForMedia(
  conversation: { id: string; orgId: string },
  type: MessageType,
): Promise<void> {
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { aiControlled: false },
  });

  await prisma.conversationEvent.create({
    data: {
      conversationId: conversation.id,
      type: ConversationEventType.AI_HANDOFF,
      data: { motivo: 'midia-recebida', tipo: type },
    },
  });

  const rotulo = ROTULO_MIDIA[type] ?? 'sua mensagem';
  await queueSystemMessage(conversation.id, `Recebi ${rotulo}! Já vou chamar um consultor. 👍`);

  await enqueueRouting({ conversationId: conversation.id, reason: HandoffReason.AI_UNCERTAIN });

  logger.info(
    { conversationId: conversation.id, tipo: type },
    'Midia recebida: conversa entregue a um humano sem passar pela IA',
  );
}
