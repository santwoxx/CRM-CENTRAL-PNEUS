import {
  ConversationEventType,
  ConversationStatus,
  UserRole,
  type ListConversationsQuery,
} from '@crm/shared';
import { prisma } from '../../db/prisma.js';
import { NotFoundError } from '../../lib/errors.js';
import { conversationInclude, toConversationDetail, toConversationSummary } from './serializer.js';
import { emitConversationUpdated } from '../../realtime/emitter.js';
import { routeConversation, transferConversation } from '../routing/router.js';
import { queueSystemMessage } from '../messages/outbox.js';

export async function listConversations(
  orgId: string,
  user: { id: string; role: UserRole; departmentIds: string[] },
  query: ListConversationsQuery,
) {
  const limit = Math.min(query.limit ?? 30, 100);

  // Restrição de visibilidade por cargo
  let assignedUserFilter: unknown = undefined;
  if (query.assignedUserId === 'me') {
    assignedUserFilter = user.id;
  } else if (query.assignedUserId === 'unassigned') {
    assignedUserFilter = null;
  } else if (query.assignedUserId) {
    assignedUserFilter = query.assignedUserId;
  }

  const where = {
    orgId,
    ...(query.status ? { status: { in: query.status as never } } : {}),
    ...(query.departmentId ? { departmentId: query.departmentId } : {}),
    ...(assignedUserFilter !== undefined ? { assignedUserId: assignedUserFilter } : {}),
    ...(query.channelId ? { channelId: query.channelId } : {}),
    ...(query.tag ? { tags: { has: query.tag } } : {}),
    ...(query.onlyUnread ? { unreadCount: { gt: 0 } } : {}),
    ...(query.search
      ? {
          contact: {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' as const } },
              { pushName: { contains: query.search, mode: 'insensitive' as const } },
              { phone: { contains: query.search } },
            ],
          },
        }
      : {}),
  };

  const orderBy =
    query.sort === 'oldest'
      ? { lastMessageAt: 'asc' as const }
      : query.sort === 'priority'
      ? [{ priority: 'desc' as const }, { lastMessageAt: 'desc' as const }]
      : { lastMessageAt: 'desc' as const };

  const conversations = await prisma.conversation.findMany({
    where,
    include: conversationInclude,
    orderBy,
    take: limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });

  const hasMore = conversations.length > limit;
  const page = hasMore ? conversations.slice(0, limit) : conversations;

  return {
    items: page.map(toConversationSummary),
    nextCursor: hasMore ? page.at(-1)?.id ?? null : null,
  };
}

export async function getConversation(id: string, orgId: string) {
  const conversation = await prisma.conversation.findFirst({
    where: { id, orgId },
    include: conversationInclude,
  });

  if (!conversation) throw new NotFoundError('Conversa');
  return toConversationDetail(conversation);
}

export async function assignConversation(
  conversationId: string,
  targetUserId: string | null,
  actorUserId: string,
) {
  if (targetUserId) {
    return routeConversation(conversationId, {
      reason: 'MANUAL',
      preferredUserId: targetUserId,
      actorUserId,
    });
  } else {
    // Devolve para a fila
    return routeConversation(conversationId, {
      reason: 'MANUAL',
      actorUserId,
    });
  }
}

export async function transfer(
  conversationId: string,
  actorUserId: string,
  input: { departmentId?: string | null; userId?: string | null; note?: string },
) {
  return transferConversation(conversationId, {
    actorUserId,
    departmentId: input.departmentId,
    userId: input.userId,
    note: input.note,
  });
}

export async function resolve(
  conversationId: string,
  orgId: string,
  actorUserId: string,
  sendClosingMessage = true,
) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, orgId },
    include: { department: true },
  });

  if (!conversation) throw new NotFoundError('Conversa');

  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      status: ConversationStatus.RESOLVED,
      resolvedAt: new Date(),
    },
  });

  await prisma.conversationEvent.create({
    data: {
      conversationId,
      type: ConversationEventType.RESOLVED,
      actorUserId,
      data: { sendClosingMessage },
    },
  });

  if (sendClosingMessage) {
    const text =
      conversation.department?.closingMessage ??
      'Seu atendimento foi finalizado. Agradecemos a preferência pela Central Pneus! Se precisar de algo mais, estamos sempre por aqui.';
    await queueSystemMessage(conversationId, text);
  }

  const updated = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: conversationInclude,
  });

  if (updated) {
    await emitConversationUpdated(orgId, toConversationSummary(updated));
  }

  return updated ? toConversationSummary(updated) : null;
}

export async function toggleAiControlled(conversationId: string, orgId: string, aiControlled: boolean) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, orgId },
  });
  if (!conversation) throw new NotFoundError('Conversa');

  const updated = await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      aiControlled,
      ...(aiControlled ? { status: ConversationStatus.BOT } : {}),
    },
    include: conversationInclude,
  });

  const summary = toConversationSummary(updated);
  await emitConversationUpdated(orgId, summary);
  return summary;
}
