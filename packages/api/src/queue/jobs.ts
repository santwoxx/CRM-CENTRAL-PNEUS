import type { HandoffReason } from '@crm/shared';

/**
 * Contratos das filas.
 *
 * Regra de ouro: um job carrega IDENTIFICADORES, nunca o dado inteiro. O
 * worker sempre releu o estado atual do banco antes de agir. Isso evita agir
 * sobre um retrato velho quando o job fica minutos parado na fila.
 */

export const QueueName = {
  INBOUND: 'inbound',
  OUTBOUND: 'outbound',
  AI: 'ai',
  ROUTING: 'routing',
  MEDIA: 'media',
  MAINTENANCE: 'maintenance',
} as const;
export type QueueName = (typeof QueueName)[keyof typeof QueueName];

/** Processa um evento de webhook ja persistido (e ja deduplicado). */
export interface InboundJobData {
  webhookEventId: string;
  channelId: string;
}

/** Entrega ao provedor uma mensagem que ja existe no banco. */
export interface OutboundJobData {
  messageId: string;
  /** Numero da tentativa, apenas para log. O controle real e do BullMQ. */
  attempt?: number;
}

/** Pede uma resposta da IA para a conversa. */
export interface AiJobData {
  conversationId: string;
  triggerMessageId: string;
}

/** Tenta encontrar um atendente para a conversa. */
export interface RoutingJobData {
  conversationId: string;
  reason: HandoffReason;
  /** Setor de destino. `null` = decidir pelo contexto da conversa. */
  departmentId?: string | null;
  /** Atendente pedido pelo cliente (cliente recorrente). */
  preferredUserId?: string | null;
  /** Quem pediu a transferencia, quando foi humano. */
  actorUserId?: string | null;
}

/** Baixa a midia do provedor e guarda no nosso storage. */
export interface MediaJobData {
  messageId: string;
  channelId: string;
  externalMediaId: string;
  mimeType?: string;
  fileName?: string;
}

export const MaintenanceTask = {
  /** Marca conversas que estouraram o SLA de primeira resposta. */
  SLA_SWEEP: 'sla-sweep',
  /** Escala para o admin conversas paradas na fila. */
  QUEUE_ESCALATION: 'queue-escalation',
  /** Coloca em ausente quem parou de dar sinal de vida. */
  AGENT_AUTO_AWAY: 'agent-auto-away',
  /** Encerra conversas abandonadas. */
  AUTO_CLOSE: 'auto-close',
  /** Reenfileira mensagens presas em PENDING (rede de seguranca do outbox). */
  OUTBOX_SWEEP: 'outbox-sweep',
  /** Confere se cada canal ainda responde. */
  CHANNEL_HEALTH: 'channel-health',
  /** Apaga webhooks antigos ja processados. */
  WEBHOOK_CLEANUP: 'webhook-cleanup',
  /** Tenta rotear de novo tudo que ficou na fila sem dono. */
  QUEUE_DRAIN: 'queue-drain',
  /** Expira sessoes de refresh token vencidas. */
  SESSION_CLEANUP: 'session-cleanup',
} as const;
export type MaintenanceTask = (typeof MaintenanceTask)[keyof typeof MaintenanceTask];

export interface MaintenanceJobData {
  task: MaintenanceTask;
}

export interface JobDataMap {
  [QueueName.INBOUND]: InboundJobData;
  [QueueName.OUTBOUND]: OutboundJobData;
  [QueueName.AI]: AiJobData;
  [QueueName.ROUTING]: RoutingJobData;
  [QueueName.MEDIA]: MediaJobData;
  [QueueName.MAINTENANCE]: MaintenanceJobData;
}
