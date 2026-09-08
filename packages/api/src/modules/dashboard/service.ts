import {
  AgentPresence,
  ConversationStatus,
  MessageDirection,
  MessageSenderType,
  type DashboardMetrics,
} from '@crm/shared';
import { prisma } from '../../db/prisma.js';
import { getActiveChatCounts } from '../routing/presence.js';
import { conversationInclude, toConversationSummary } from '../conversations/serializer.js';

export async function getDashboardMetrics(orgId: string): Promise<DashboardMetrics> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [
    botCount,
    queueConversations,
    activeCount,
    slaBreachedCount,
    onlineAgents,
    allAgents,
    newTodayCount,
    resolvedTodayCount,
    inboundTodayCount,
    outboundTodayCount,
    aiHandledCount,
    departments,
  ] = await Promise.all([
    // Live counts
    prisma.conversation.count({ where: { orgId, status: ConversationStatus.BOT } }),
    prisma.conversation.findMany({
      where: { orgId, status: ConversationStatus.QUEUED },
      select: { queuedAt: true },
      orderBy: { queuedAt: 'asc' },
    }),
    prisma.conversation.count({
      where: { orgId, status: { in: [ConversationStatus.ASSIGNED, ConversationStatus.PENDING] } },
    }),
    prisma.conversation.count({ where: { orgId, slaBreached: true } }),
    prisma.user.findMany({
      where: { orgId, isActive: true, deletedAt: null, presence: AgentPresence.ONLINE },
      select: { id: true, maxConcurrentChats: true },
    }),
    prisma.user.findMany({
      where: { orgId, isActive: true, deletedAt: null },
      select: { id: true, name: true, presence: true, maxConcurrentChats: true },
    }),
    // Today metrics
    prisma.conversation.count({ where: { orgId, createdAt: { gte: startOfDay } } }),
    prisma.conversation.count({
      where: { orgId, status: ConversationStatus.RESOLVED, resolvedAt: { gte: startOfDay } },
    }),
    prisma.message.count({
      where: { orgId, direction: MessageDirection.INBOUND, createdAt: { gte: startOfDay } },
    }),
    prisma.message.count({
      where: { orgId, direction: MessageDirection.OUTBOUND, createdAt: { gte: startOfDay } },
    }),
    prisma.conversation.count({
      where: { orgId, createdAt: { gte: startOfDay }, aiTurnCount: { gt: 0 } },
    }),
    prisma.department.findMany({
      where: { orgId, isActive: true },
      select: { id: true, name: true, color: true },
    }),
  ]);

  const agentIds = allAgents.map((a) => a.id);
  const activeChatsMap = await getActiveChatCounts(agentIds);

  const oldestWaiting = queueConversations[0]?.queuedAt;
  const oldestWaitingSeconds = oldestWaiting
    ? Math.max(0, Math.round((Date.now() - oldestWaiting.getTime()) / 1000))
    : 0;

  let agentsAvailable = 0;
  for (const agent of onlineAgents) {
    const active = activeChatsMap.get(agent.id) ?? 0;
    if (active < agent.maxConcurrentChats) agentsAvailable += 1;
  }

  // Estatísticas por departamento
  const deptStats = await Promise.all(
    departments.map(async (d) => {
      const [waiting, active, resolved] = await Promise.all([
        prisma.conversation.count({
          where: { orgId, departmentId: d.id, status: ConversationStatus.QUEUED },
        }),
        prisma.conversation.count({
          where: {
            orgId,
            departmentId: d.id,
            status: { in: [ConversationStatus.ASSIGNED, ConversationStatus.PENDING] },
          },
        }),
        prisma.conversation.count({
          where: {
            orgId,
            departmentId: d.id,
            status: ConversationStatus.RESOLVED,
            resolvedAt: { gte: startOfDay },
          },
        }),
      ]);

      return {
        departmentId: d.id,
        name: d.name,
        color: d.color,
        waiting,
        active,
        resolvedToday: resolved,
        avgFirstResponseSeconds: null,
      };
    }),
  );

  // Estatísticas por atendente
  const agentStats = allAgents.map((a) => ({
    userId: a.id,
    name: a.name,
    presence: a.presence as AgentPresence,
    activeChats: activeChatsMap.get(a.id) ?? 0,
    resolvedToday: 0,
    avgFirstResponseSeconds: null,
  }));

  const aiContainmentRate =
    newTodayCount > 0
      ? Math.round(((aiHandledCount - (activeCount + queueConversations.length)) / newTodayCount) * 100)
      : 0;

  return {
    generatedAt: new Date().toISOString(),
    live: {
      botConversations: botCount,
      waitingInQueue: queueConversations.length,
      activeWithAgents: activeCount,
      oldestWaitingSeconds,
      agentsOnline: onlineAgents.length,
      agentsAvailable,
      slaBreached: slaBreachedCount,
    },
    today: {
      newConversations: newTodayCount,
      resolvedConversations: resolvedTodayCount,
      inboundMessages: inboundTodayCount,
      outboundMessages: outboundTodayCount,
      aiHandledCount,
      aiHandoffCount: queueConversations.length + activeCount,
      aiContainmentRate: Math.max(0, aiContainmentRate),
      avgFirstResponseSeconds: null,
      avgResolutionSeconds: null,
    },
    byDepartment: deptStats,
    byAgent: agentStats,
  };
}

/**
 * Retorna todas as conversas ativas no momento para o monitor do Administrador ao vivo.
 */
export async function getLiveConversations(orgId: string) {
  const conversations = await prisma.conversation.findMany({
    where: {
      orgId,
      status: {
        in: [
          ConversationStatus.BOT,
          ConversationStatus.QUEUED,
          ConversationStatus.ASSIGNED,
          ConversationStatus.PENDING,
        ],
      },
    },
    include: conversationInclude,
    orderBy: { lastMessageAt: 'desc' },
    take: 150,
  });

  return conversations.map(toConversationSummary);
}
