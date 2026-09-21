import {
  Room,
  type AgentPresenceDTO,
  type ChannelStatus,
  type ConversationStatus,
  type ConversationSummary,
  type MessageDTO,
  type MessageStatus,
} from '@crm/shared';
import { publishRealtime } from './bus.js';
import { conversationRooms, type ConversationScope } from './rooms.js';

/**
 * Emissores de dominio.
 *
 * Centralizam QUAIS salas recebem cada evento. Se essa decisao ficasse
 * espalhada pelos servicos, mais cedo ou mais tarde alguem esqueceria de
 * avisar o painel do admin - e o admin deixaria de ver algo em tempo real.
 */

function scopeOf(conversation: ConversationSummary, orgId: string, previousUserId?: string | null): ConversationScope {
  return {
    orgId,
    conversationId: conversation.id,
    departmentId: conversation.department?.id ?? null,
    assignedUserId: conversation.assignedUser?.id ?? null,
    previousUserId: previousUserId ?? null,
  };
}

export async function emitConversationCreated(
  orgId: string,
  conversation: ConversationSummary,
): Promise<void> {
  await publishRealtime(
    conversationRooms(scopeOf(conversation, orgId)),
    'conversation:created',
    conversation,
  );
}

export async function emitConversationUpdated(
  orgId: string,
  conversation: ConversationSummary,
  previousUserId?: string | null,
): Promise<void> {
  await publishRealtime(
    conversationRooms(scopeOf(conversation, orgId, previousUserId)),
    'conversation:updated',
    conversation,
  );
}

export async function emitConversationAssigned(
  orgId: string,
  conversation: ConversationSummary,
  previousUserId: string | null,
  byUserId: string | null,
): Promise<void> {
  await publishRealtime(
    conversationRooms(scopeOf(conversation, orgId, previousUserId)),
    'conversation:assigned',
    {
      conversation,
      assignedUserId: conversation.assignedUser?.id ?? null,
      previousUserId,
      byUserId,
    },
  );
}

export async function emitConversationStatus(
  scope: ConversationScope,
  status: ConversationStatus,
): Promise<void> {
  await publishRealtime(conversationRooms(scope), 'conversation:status', {
    conversationId: scope.conversationId,
    status,
    at: new Date().toISOString(),
  });
}

export async function emitMessageNew(scope: ConversationScope, message: MessageDTO): Promise<void> {
  await publishRealtime(conversationRooms(scope), 'message:new', message);
}

export async function emitMessageStatus(
  scope: ConversationScope,
  payload: {
    messageId: string;
    status: MessageStatus;
    failureReason?: string | null;
  },
): Promise<void> {
  await publishRealtime(conversationRooms(scope), 'message:status', {
    messageId: payload.messageId,
    conversationId: scope.conversationId,
    status: payload.status,
    failureReason: payload.failureReason ?? null,
    at: new Date().toISOString(),
  });
}

export async function emitPresenceChanged(
  orgId: string,
  presence: AgentPresenceDTO,
): Promise<void> {
  await publishRealtime(
    [Room.presence(orgId), Room.orgAdmin(orgId)],
    'presence:changed',
    presence,
  );
}

export async function emitQueueUpdated(
  orgId: string,
  payload: { departmentId: string | null; waiting: number; oldestWaitingSeconds: number },
): Promise<void> {
  const rooms = [Room.orgAdmin(orgId)];
  if (payload.departmentId) rooms.push(Room.department(payload.departmentId));
  await publishRealtime(rooms, 'queue:updated', payload);
}

export async function emitChannelStatus(
  orgId: string,
  payload: {
    channelId: string;
    status: ChannelStatus;
    detail?: string | null;
    qrCode?: string | null;
  },
): Promise<void> {
  await publishRealtime(Room.orgAdmin(orgId), 'channel:status', payload);
}

export async function emitSystemAlert(
  orgId: string,
  payload: { level: 'info' | 'warning' | 'error'; code: string; message: string },
): Promise<void> {
  await publishRealtime(Room.orgAdmin(orgId), 'system:alert', {
    ...payload,
    at: new Date().toISOString(),
  });
}

export { conversationRooms } from './rooms.js';
export type { ConversationScope };
