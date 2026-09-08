import type {
  AgentPresence,
  ChannelStatus,
  ChannelType,
  ConversationEventType,
  ConversationPriority,
  ConversationStatus,
  LifecycleStage,
  MessageDirection,
  MessageSenderType,
  MessageStatus,
  MessageType,
  RoutingStrategy,
  UserRole,
} from './enums.js';
import type { Permission } from './permissions.js';

/** Todas as datas trafegam como ISO-8601 em UTC. A formatacao e do frontend. */
export type IsoDate = string;

export interface Paginated<T> {
  items: T[];
  /** Cursor opaco para a proxima pagina; `null` quando acabou. */
  nextCursor: string | null;
  total?: number;
}

export interface UserSummary {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatarUrl: string | null;
  presence: AgentPresence;
  isActive: boolean;
}

export interface UserDetail extends UserSummary {
  maxConcurrentChats: number;
  departments: { id: string; name: string; color: string; isSupervisor: boolean }[];
  presenceChangedAt: IsoDate | null;
  lastSeenAt: IsoDate | null;
  createdAt: IsoDate;
}

export interface AuthenticatedUser extends UserDetail {
  orgId: string;
  orgName: string;
  permissions: Permission[];
}

export interface AgentPresenceDTO {
  userId: string;
  name: string;
  avatarUrl: string | null;
  role: UserRole;
  presence: AgentPresence;
  /** Conversas ocupando slot agora. */
  activeChats: number;
  maxConcurrentChats: number;
  /** false quando esta offline, ausente ou lotado. */
  acceptingChats: boolean;
  departmentIds: string[];
  changedAt: IsoDate | null;
  lastSeenAt: IsoDate | null;
}

export interface DepartmentDTO {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  color: string;
  /** Rotulo mostrado ao cliente no menu do WhatsApp. Ex.: "Falar com o Financeiro". */
  menuLabel: string | null;
  showInMenu: boolean;
  order: number;
  isActive: boolean;
  routingStrategy: RoutingStrategy;
  aiEnabled: boolean;
  offlineMessage: string | null;
  memberCount: number;
  onlineCount: number;
  waitingCount: number;
}

export interface ChannelDTO {
  id: string;
  type: ChannelType;
  name: string;
  identifier: string | null;
  isActive: boolean;
  isDefault: boolean;
  status: ChannelStatus;
  statusDetail: string | null;
  lastHealthCheckAt: IsoDate | null;
  /** Nunca contem segredos: apenas quais campos estao preenchidos. */
  configuredFields: string[];
}

export interface ContactSummary {
  id: string;
  name: string | null;
  pushName: string | null;
  phone: string | null;
  avatarUrl: string | null;
  lifecycleStage: LifecycleStage;
  tags: string[];
  isBlocked: boolean;
  lastContactAt: IsoDate | null;
}

export interface ContactDetail extends ContactSummary {
  email: string | null;
  document: string | null;
  notes: string | null;
  customFields: Record<string, unknown>;
  firstContactAt: IsoDate | null;
  preferredAgent: UserSummary | null;
  lastDepartmentId: string | null;
  totalConversations: number;
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

export interface ConversationSummary {
  id: string;
  status: ConversationStatus;
  priority: ConversationPriority;
  contact: ContactSummary;
  channel: { id: string; type: ChannelType; name: string };
  department: { id: string; name: string; color: string } | null;
  assignedUser: UserSummary | null;
  aiControlled: boolean;
  leadScore: number | null;
  unreadCount: number;
  lastMessage: {
    id: string;
    preview: string;
    type: MessageType;
    direction: MessageDirection;
    senderType: MessageSenderType;
    createdAt: IsoDate;
  } | null;
  lastMessageAt: IsoDate | null;
  queuedAt: IsoDate | null;
  assignedAt: IsoDate | null;
  /** Fim da janela de 24h do WhatsApp; depois disso so template aprovado. */
  windowExpiresAt: IsoDate | null;
  slaBreached: boolean;
  tags: string[];
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

export interface ConversationDetail extends ConversationSummary {
  subject: string | null;
  leadSummary: string | null;
  intent: string | null;
  firstResponseAt: IsoDate | null;
  resolvedAt: IsoDate | null;
  metadata: Record<string, unknown>;
}

export interface MessageAttachment {
  id: string;
  mimeType: string;
  fileName: string | null;
  size: number | null;
  /** URL assinada e temporaria servida pela propria API. */
  url: string;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  transcription: string | null;
}

export interface MessageDTO {
  id: string;
  conversationId: string;
  direction: MessageDirection;
  senderType: MessageSenderType;
  senderUser: UserSummary | null;
  type: MessageType;
  content: string | null;
  /** Nota interna: visivel apenas para a equipe, nunca enviada ao cliente. */
  isPrivate: boolean;
  attachment: MessageAttachment | null;
  payload: Record<string, unknown> | null;
  replyTo: { id: string; preview: string; senderType: MessageSenderType } | null;
  status: MessageStatus;
  failureReason: string | null;
  externalId: string | null;
  createdAt: IsoDate;
  sentAt: IsoDate | null;
  deliveredAt: IsoDate | null;
  readAt: IsoDate | null;
}

export interface ConversationEventDTO {
  id: string;
  type: ConversationEventType;
  actor: UserSummary | null;
  data: Record<string, unknown>;
  createdAt: IsoDate;
}

export interface DashboardMetrics {
  generatedAt: IsoDate;
  live: {
    botConversations: number;
    waitingInQueue: number;
    activeWithAgents: number;
    oldestWaitingSeconds: number;
    agentsOnline: number;
    agentsAvailable: number;
    slaBreached: number;
  };
  today: {
    newConversations: number;
    resolvedConversations: number;
    inboundMessages: number;
    outboundMessages: number;
    aiHandledCount: number;
    aiHandoffCount: number;
    /** Percentual de conversas que a IA resolveu sem humano. */
    aiContainmentRate: number;
    avgFirstResponseSeconds: number | null;
    avgResolutionSeconds: number | null;
  };
  byDepartment: {
    departmentId: string;
    name: string;
    color: string;
    waiting: number;
    active: number;
    resolvedToday: number;
    avgFirstResponseSeconds: number | null;
  }[];
  byAgent: {
    userId: string;
    name: string;
    presence: AgentPresence;
    activeChats: number;
    resolvedToday: number;
    avgFirstResponseSeconds: number | null;
  }[];
}

export interface SystemHealth {
  status: 'ok' | 'degraded' | 'down';
  checkedAt: IsoDate;
  components: {
    name: string;
    status: 'ok' | 'degraded' | 'down';
    detail: string | null;
    latencyMs: number | null;
  }[];
  queues: {
    name: string;
    waiting: number;
    active: number;
    delayed: number;
    failed: number;
    paused: boolean;
  }[];
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    /** Erros de validacao campo-a-campo. */
    details?: { path: string; message: string }[];
    requestId?: string;
  };
}
