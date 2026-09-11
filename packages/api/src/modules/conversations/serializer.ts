import type {
  ChannelType,
  ConversationDetail,
  ConversationPriority,
  ConversationStatus,
  ContactSummary,
  LifecycleStage,
  MessageDTO,
  MessageDirection,
  MessageSenderType,
  MessageStatus,
  MessageType,
  UserRole,
  UserSummary,
  AgentPresence,
  ConversationSummary,
} from '@crm/shared';
import { Prisma } from '../../db/prisma.js';
import { env } from '../../env.js';
import { assinarUrlMidia } from '../media/seguranca.js';

/**
 * Conversao de linha do banco para DTO da API.
 *
 * Uma unica definicao de `include` para toda a aplicacao. Se cada rota
 * montasse o seu, a tela receberia formatos ligeiramente diferentes conforme
 * o endpoint - e o frontend quebraria de formas dificeis de rastrear.
 */

export const conversationInclude = {
  contact: {
    select: {
      id: true,
      name: true,
      pushName: true,
      phone: true,
      avatarUrl: true,
      lifecycleStage: true,
      tags: true,
      isBlocked: true,
      lastContactAt: true,
    },
  },
  channel: { select: { id: true, type: true, name: true } },
  department: { select: { id: true, name: true, color: true } },
  assignedUser: {
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      avatarUrl: true,
      presence: true,
      isActive: true,
    },
  },
  messages: {
    // Apenas a ultima mensagem, para o preview da lista.
    take: 1,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      type: true,
      content: true,
      direction: true,
      senderType: true,
      isPrivate: true,
      createdAt: true,
    },
  },
} as const;

export type ConversationWithRelations = Prisma.ConversationGetPayload<{
  include: typeof conversationInclude;
}>;

export const messageInclude = {
  sender: {
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      avatarUrl: true,
      presence: true,
      isActive: true,
    },
  },
  media: true,
  replyTo: { select: { id: true, content: true, type: true, senderType: true } },
} as const;

export type MessageWithRelations = Prisma.MessageGetPayload<{ include: typeof messageInclude }>;

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  avatarUrl: string | null;
  presence: string;
  isActive: boolean;
};

export function toUserSummary(user: UserRow | null): UserSummary | null {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role as UserRole,
    avatarUrl: user.avatarUrl,
    presence: user.presence as AgentPresence,
    isActive: user.isActive,
  };
}

/** Texto curto para a lista de conversas. Midia vira rotulo, nao URL. */
export function messagePreview(message: {
  type: string;
  content: string | null;
  isPrivate?: boolean;
}): string {
  const labels: Record<string, string> = {
    IMAGE: '[imagem]',
    AUDIO: '[audio]',
    VIDEO: '[video]',
    DOCUMENT: '[documento]',
    STICKER: '[figurinha]',
    LOCATION: '[localizacao]',
    CONTACTS: '[contato]',
    TEMPLATE: '[modelo]',
    INTERACTIVE: '[menu]',
    REACTION: '[reacao]',
    UNSUPPORTED: '[nao suportado]',
  };

  const prefix = message.isPrivate ? '[nota] ' : '';
  const base = message.content?.trim() || labels[message.type] || '';
  const normalized = base.replace(/\s+/g, ' ');

  return prefix + (normalized.length > 140 ? `${normalized.slice(0, 139)}\u2026` : normalized);
}

export function toContactSummary(contact: {
  id: string;
  name: string | null;
  pushName: string | null;
  phone: string | null;
  avatarUrl: string | null;
  lifecycleStage: string;
  tags: string[];
  isBlocked: boolean;
  lastContactAt: Date | null;
}): ContactSummary {
  return {
    id: contact.id,
    name: contact.name,
    pushName: contact.pushName,
    phone: contact.phone,
    avatarUrl: contact.avatarUrl,
    lifecycleStage: contact.lifecycleStage as LifecycleStage,
    tags: contact.tags,
    isBlocked: contact.isBlocked,
    lastContactAt: contact.lastContactAt?.toISOString() ?? null,
  };
}

export function toConversationSummary(
  conversation: ConversationWithRelations,
): ConversationSummary {
  const lastMessage = conversation.messages[0] ?? null;

  return {
    id: conversation.id,
    status: conversation.status as ConversationStatus,
    priority: conversation.priority as ConversationPriority,
    contact: toContactSummary(conversation.contact),
    channel: {
      id: conversation.channel.id,
      type: conversation.channel.type as ChannelType,
      name: conversation.channel.name,
    },
    department: conversation.department
      ? {
          id: conversation.department.id,
          name: conversation.department.name,
          color: conversation.department.color,
        }
      : null,
    assignedUser: toUserSummary(conversation.assignedUser),
    aiControlled: conversation.aiControlled,
    leadScore: conversation.leadScore,
    unreadCount: conversation.unreadCount,
    lastMessage: lastMessage
      ? {
          id: lastMessage.id,
          preview: messagePreview(lastMessage),
          type: lastMessage.type as MessageType,
          direction: lastMessage.direction as MessageDirection,
          senderType: lastMessage.senderType as MessageSenderType,
          createdAt: lastMessage.createdAt.toISOString(),
        }
      : null,
    lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
    queuedAt: conversation.queuedAt?.toISOString() ?? null,
    assignedAt: conversation.assignedAt?.toISOString() ?? null,
    windowExpiresAt: conversation.windowExpiresAt?.toISOString() ?? null,
    slaBreached: conversation.slaBreached,
    tags: conversation.tags,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
  };
}

export function toConversationDetail(
  conversation: ConversationWithRelations,
): ConversationDetail {
  return {
    ...toConversationSummary(conversation),
    subject: conversation.subject,
    leadSummary: conversation.leadSummary,
    intent: conversation.intent,
    firstResponseAt: conversation.firstResponseAt?.toISOString() ?? null,
    resolvedAt: conversation.resolvedAt?.toISOString() ?? null,
    metadata: (conversation.metadata ?? {}) as Record<string, unknown>,
  };
}

export function toMessageDTO(message: MessageWithRelations): MessageDTO {
  return {
    id: message.id,
    conversationId: message.conversationId,
    direction: message.direction as MessageDirection,
    senderType: message.senderType as MessageSenderType,
    senderUser: toUserSummary(message.sender),
    type: message.type as MessageType,
    content: message.content,
    isPrivate: message.isPrivate,
    attachment: message.media
      ? {
          id: message.media.id,
          mimeType: message.media.mimeType,
          fileName: message.media.fileName,
          size: message.media.size,
          // URL assinada e de curta duracao. Tags <img> e <audio> nao enviam
          // cabecalho de autenticacao, entao a prova de acesso viaja na
          // propria URL - e expira sozinha se o link vazar.
          url: mediaUrl(message.media.id, message.orgId),
          thumbnailUrl: message.media.mimeType.startsWith('image/')
            ? mediaUrl(message.media.id, message.orgId)
            : null,
          durationSeconds: message.media.durationSeconds,
          transcription: message.media.transcription,
        }
      : null,
    payload: (message.payload ?? null) as Record<string, unknown> | null,
    replyTo: message.replyTo
      ? {
          id: message.replyTo.id,
          preview: messagePreview(message.replyTo),
          senderType: message.replyTo.senderType as MessageSenderType,
        }
      : null,
    status: message.status as MessageStatus,
    failureReason: message.failureReason,
    externalId: message.externalId,
    createdAt: message.createdAt.toISOString(),
    sentAt: message.sentAt?.toISOString() ?? null,
    deliveredAt: message.deliveredAt?.toISOString() ?? null,
    readAt: message.readAt?.toISOString() ?? null,
  };
}


/** Monta a URL assinada de um arquivo. */
function mediaUrl(mediaId: string, orgId: string): string {
  const assinatura = assinarUrlMidia(mediaId, orgId);
  return `${env.PUBLIC_API_URL}/media/${mediaId}?org=${encodeURIComponent(orgId)}&${assinatura}`;
}
