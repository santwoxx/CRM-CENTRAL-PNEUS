import type {
  AgentPresence,
  ConversationStatus,
  MessageStatus,
  ChannelStatus,
} from './enums.js';
import type { ConversationSummary, MessageDTO, AgentPresenceDTO } from './types.js';

/**
 * Contrato do canal de tempo real (Socket.IO).
 *
 * As salas sao a fronteira de autorizacao. Um socket so entra numa sala depois
 * que o servidor confere o cargo do usuario - o cliente nunca escolhe sozinho
 * em qual sala entra.
 */
export const Room = {
  /** Tudo que o usuario precisa receber pessoalmente (atribuicoes, avisos). */
  user: (userId: string) => `user:${userId}`,
  /** Fila e eventos de um setor. */
  department: (departmentId: string) => `dept:${departmentId}`,
  /** Mensagens de uma conversa aberta na tela. */
  conversation: (conversationId: string) => `conv:${conversationId}`,
  /** Painel do admin: recebe o firehose da organizacao. */
  orgAdmin: (orgId: string) => `org:${orgId}:admin`,
  /** Presenca de todos os atendentes. */
  presence: (orgId: string) => `org:${orgId}:presence`,
} as const;

/** Eventos que o SERVIDOR emite para o cliente. */
export interface ServerToClientEvents {
  'conversation:created': (payload: ConversationSummary) => void;
  'conversation:updated': (payload: ConversationSummary) => void;
  'conversation:assigned': (payload: {
    conversation: ConversationSummary;
    assignedUserId: string | null;
    previousUserId: string | null;
    byUserId: string | null;
  }) => void;
  'conversation:status': (payload: {
    conversationId: string;
    status: ConversationStatus;
    at: string;
  }) => void;
  'conversation:removed': (payload: { conversationId: string; reason: string }) => void;

  'message:new': (payload: MessageDTO) => void;
  'message:status': (payload: {
    messageId: string;
    conversationId: string;
    status: MessageStatus;
    failureReason?: string | null;
    at: string;
  }) => void;

  'typing:start': (payload: {
    conversationId: string;
    userId: string;
    userName: string;
  }) => void;
  'typing:stop': (payload: { conversationId: string; userId: string }) => void;

  'presence:changed': (payload: AgentPresenceDTO) => void;
  'presence:snapshot': (payload: AgentPresenceDTO[]) => void;

  'queue:updated': (payload: {
    departmentId: string | null;
    waiting: number;
    oldestWaitingSeconds: number;
  }) => void;

  'channel:status': (payload: {
    channelId: string;
    status: ChannelStatus;
    detail?: string | null;
    qrCode?: string | null;
  }) => void;

  'system:alert': (payload: {
    level: 'info' | 'warning' | 'error';
    code: string;
    message: string;
    at: string;
  }) => void;

  /** O servidor rejeitou algo que o cliente pediu. */
  'error': (payload: { code: string; message: string }) => void;
}

/** Eventos que o CLIENTE emite para o servidor. */
export interface ClientToServerEvents {
  'conversation:subscribe': (
    conversationId: string,
    ack?: (result: { ok: boolean; error?: string }) => void,
  ) => void;
  'conversation:unsubscribe': (conversationId: string) => void;
  'typing:start': (conversationId: string) => void;
  'typing:stop': (conversationId: string) => void;
  'presence:set': (
    presence: AgentPresence,
    ack?: (result: { ok: boolean; error?: string }) => void,
  ) => void;
  /** Mantem o atendente marcado como ativo (evita o auto-away). */
  'presence:heartbeat': () => void;
}

/** Dados que o servidor anexa ao socket depois de autenticar. */
export interface SocketData {
  userId: string;
  orgId: string;
  role: string;
  departmentIds: string[];
}
