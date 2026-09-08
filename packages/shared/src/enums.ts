/**
 * Enums do dominio.
 *
 * Estes valores sao espelhados um-a-um no schema do Prisma. Manter os dois lados
 * iguais e obrigatorio: o backend converte livremente entre eles sem cast.
 */

export const UserRole = {
  /** Dono da conta. Faz tudo, inclusive remover outros admins. */
  OWNER: 'OWNER',
  /** Administrador: configura setores, cargos, canais, IA e ve tudo em tempo real. */
  ADMIN: 'ADMIN',
  /** Supervisor: ve e assume conversas dos setores em que e supervisor. */
  SUPERVISOR: 'SUPERVISOR',
  /** Atendente: ve apenas as proprias conversas e a fila dos seus setores. */
  AGENT: 'AGENT',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const AgentPresence = {
  OFFLINE: 'OFFLINE',
  ONLINE: 'ONLINE',
  AWAY: 'AWAY',
  BUSY: 'BUSY',
} as const;
export type AgentPresence = (typeof AgentPresence)[keyof typeof AgentPresence];

export const ChannelType = {
  WHATSAPP_CLOUD: 'WHATSAPP_CLOUD',
  WHATSAPP_EVOLUTION: 'WHATSAPP_EVOLUTION',
  TELEGRAM: 'TELEGRAM',
  WEBCHAT: 'WEBCHAT',
} as const;
export type ChannelType = (typeof ChannelType)[keyof typeof ChannelType];

export const ChannelStatus = {
  PENDING: 'PENDING',
  CONNECTED: 'CONNECTED',
  DISCONNECTED: 'DISCONNECTED',
  ERROR: 'ERROR',
} as const;
export type ChannelStatus = (typeof ChannelStatus)[keyof typeof ChannelStatus];

export const ConversationStatus = {
  /** IA conduzindo o primeiro contato. */
  BOT: 'BOT',
  /** Aguardando um atendente humano assumir. */
  QUEUED: 'QUEUED',
  /** Atribuida a um atendente. */
  ASSIGNED: 'ASSIGNED',
  /** Atendente respondeu e aguarda retorno do cliente. */
  PENDING: 'PENDING',
  /** Encerrada pelo atendente. */
  RESOLVED: 'RESOLVED',
} as const;
export type ConversationStatus = (typeof ConversationStatus)[keyof typeof ConversationStatus];

/** Status em que a conversa ainda ocupa um slot do atendente. */
export const ACTIVE_CONVERSATION_STATUSES: ConversationStatus[] = [
  ConversationStatus.ASSIGNED,
  ConversationStatus.PENDING,
];

/** Status em que a conversa ainda aparece na caixa de entrada. */
export const OPEN_CONVERSATION_STATUSES: ConversationStatus[] = [
  ConversationStatus.BOT,
  ConversationStatus.QUEUED,
  ConversationStatus.ASSIGNED,
  ConversationStatus.PENDING,
];

export const ConversationPriority = {
  LOW: 'LOW',
  NORMAL: 'NORMAL',
  HIGH: 'HIGH',
  URGENT: 'URGENT',
} as const;
export type ConversationPriority = (typeof ConversationPriority)[keyof typeof ConversationPriority];

export const MessageDirection = {
  INBOUND: 'INBOUND',
  OUTBOUND: 'OUTBOUND',
} as const;
export type MessageDirection = (typeof MessageDirection)[keyof typeof MessageDirection];

export const MessageSenderType = {
  CONTACT: 'CONTACT',
  AGENT: 'AGENT',
  AI: 'AI',
  SYSTEM: 'SYSTEM',
} as const;
export type MessageSenderType = (typeof MessageSenderType)[keyof typeof MessageSenderType];

export const MessageType = {
  TEXT: 'TEXT',
  IMAGE: 'IMAGE',
  AUDIO: 'AUDIO',
  VIDEO: 'VIDEO',
  DOCUMENT: 'DOCUMENT',
  STICKER: 'STICKER',
  LOCATION: 'LOCATION',
  CONTACTS: 'CONTACTS',
  INTERACTIVE: 'INTERACTIVE',
  TEMPLATE: 'TEMPLATE',
  REACTION: 'REACTION',
  SYSTEM: 'SYSTEM',
  UNSUPPORTED: 'UNSUPPORTED',
} as const;
export type MessageType = (typeof MessageType)[keyof typeof MessageType];

export const MessageStatus = {
  /** Persistida, ainda nao enfileirada. */
  PENDING: 'PENDING',
  /** Na fila de envio. */
  QUEUED: 'QUEUED',
  /** Aceita pelo provedor. */
  SENT: 'SENT',
  DELIVERED: 'DELIVERED',
  READ: 'READ',
  FAILED: 'FAILED',
} as const;
export type MessageStatus = (typeof MessageStatus)[keyof typeof MessageStatus];

/** Ordem de progressao. Um callback atrasado nunca pode rebaixar o status. */
export const MESSAGE_STATUS_RANK: Record<MessageStatus, number> = {
  PENDING: 0,
  QUEUED: 1,
  SENT: 2,
  DELIVERED: 3,
  READ: 4,
  FAILED: 5,
};

export const RoutingStrategy = {
  /** Distribui em rodizio entre os atendentes disponiveis. */
  ROUND_ROBIN: 'ROUND_ROBIN',
  /** Manda para quem tem menos conversas ativas. */
  LEAST_BUSY: 'LEAST_BUSY',
  /** Fica na fila ate alguem puxar manualmente. */
  MANUAL: 'MANUAL',
} as const;
export type RoutingStrategy = (typeof RoutingStrategy)[keyof typeof RoutingStrategy];

export const LifecycleStage = {
  LEAD: 'LEAD',
  WARM: 'WARM',
  CUSTOMER: 'CUSTOMER',
  CHURNED: 'CHURNED',
} as const;
export type LifecycleStage = (typeof LifecycleStage)[keyof typeof LifecycleStage];

export const ConversationEventType = {
  CREATED: 'CREATED',
  AI_STARTED: 'AI_STARTED',
  AI_HANDOFF: 'AI_HANDOFF',
  AI_DISABLED: 'AI_DISABLED',
  QUEUED: 'QUEUED',
  ASSIGNED: 'ASSIGNED',
  UNASSIGNED: 'UNASSIGNED',
  TRANSFERRED: 'TRANSFERRED',
  DEPARTMENT_CHANGED: 'DEPARTMENT_CHANGED',
  PRIORITY_CHANGED: 'PRIORITY_CHANGED',
  RESOLVED: 'RESOLVED',
  REOPENED: 'REOPENED',
  SLA_BREACHED: 'SLA_BREACHED',
  ESCALATED: 'ESCALATED',
  NOTE_ADDED: 'NOTE_ADDED',
  TAG_ADDED: 'TAG_ADDED',
  TAG_REMOVED: 'TAG_REMOVED',
  AUTO_CLOSED: 'AUTO_CLOSED',
} as const;
export type ConversationEventType =
  (typeof ConversationEventType)[keyof typeof ConversationEventType];

export const WebhookEventStatus = {
  RECEIVED: 'RECEIVED',
  PROCESSING: 'PROCESSING',
  PROCESSED: 'PROCESSED',
  FAILED: 'FAILED',
  /** Ignorado de proposito (evento que nao nos interessa). */
  SKIPPED: 'SKIPPED',
} as const;
export type WebhookEventStatus = (typeof WebhookEventStatus)[keyof typeof WebhookEventStatus];

export const HandoffReason = {
  LEAD_QUALIFIED: 'LEAD_QUALIFIED',
  CUSTOMER_REQUESTED: 'CUSTOMER_REQUESTED',
  AI_UNCERTAIN: 'AI_UNCERTAIN',
  MAX_TURNS: 'MAX_TURNS',
  NEGATIVE_SENTIMENT: 'NEGATIVE_SENTIMENT',
  AI_UNAVAILABLE: 'AI_UNAVAILABLE',
  RETURNING_CUSTOMER: 'RETURNING_CUSTOMER',
  MENU_SELECTION: 'MENU_SELECTION',
  MANUAL: 'MANUAL',
} as const;
export type HandoffReason = (typeof HandoffReason)[keyof typeof HandoffReason];
