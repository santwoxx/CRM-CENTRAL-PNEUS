import {
  AgentPresence,
  ConversationStatus,
  MessageDirection,
  type DashboardMetrics,
} from '@crm/shared';
import { prisma } from '../../db/prisma.js';
import { getActiveChatCounts } from '../routing/presence.js';
import { conversationInclude, toConversationSummary } from '../conversations/serializer.js';
import {
  conversationVisibilityWhere,
  type ConversationAccessSubject,
} from '../conversations/access.js';

export async function getDashboardMetrics(orgId: string): Promise<DashboardMetrics> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [
    botCount,
    queueWaitingCount,
    oldestQueued,
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
    ativasPorSetor,
    resolvidasHojePorSetor,
  ] = await Promise.all([
    // Live counts
    prisma.conversation.count({ where: { orgId, status: ConversationStatus.BOT } }),
    // Quantas esperam, e ha quanto tempo espera a primeira. Antes isto
    // carregava a fila INTEIRA para usar duas informacoes: num dia de
    // campanha, com a fila grande, o painel puxava tudo a cada 5 segundos.
    prisma.conversation.count({ where: { orgId, status: ConversationStatus.QUEUED } }),
    prisma.conversation.findFirst({
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
    // Numeros por setor em duas consultas agrupadas. Antes eram tres
    // consultas POR SETOR - nove a cada atualizacao, so para preencher tres
    // colunas de uma tabela.
    prisma.conversation.groupBy({
      by: ['departmentId', 'status'],
      where: {
        orgId,
        status: {
          in: [
            ConversationStatus.QUEUED,
            ConversationStatus.ASSIGNED,
            ConversationStatus.PENDING,
          ],
        },
      },
      _count: { _all: true },
      orderBy: { departmentId: 'asc' },
    }),
    prisma.conversation.groupBy({
      by: ['departmentId'],
      where: { orgId, status: ConversationStatus.RESOLVED, resolvedAt: { gte: startOfDay } },
      _count: { _all: true },
      orderBy: { departmentId: 'asc' },
    }),
  ]);

  const agentIds = allAgents.map((a) => a.id);
  const activeChatsMap = await getActiveChatCounts(agentIds);

  const oldestWaiting = oldestQueued?.queuedAt;
  const oldestWaitingSeconds = oldestWaiting
    ? Math.max(0, Math.round((Date.now() - oldestWaiting.getTime()) / 1000))
    : 0;

  // Os agrupamentos ja vieram do banco; aqui e so leitura de mapa.
  const esperandoPorSetor = new Map<string, number>();
  const emAtendimentoPorSetor = new Map<string, number>();
  for (const linha of ativasPorSetor) {
    if (!linha.departmentId) continue;
    const alvo =
      linha.status === ConversationStatus.QUEUED ? esperandoPorSetor : emAtendimentoPorSetor;
    alvo.set(linha.departmentId, (alvo.get(linha.departmentId) ?? 0) + linha._count._all);
  }

  const resolvidasPorSetor = new Map<string, number>();
  for (const linha of resolvidasHojePorSetor) {
    if (linha.departmentId) resolvidasPorSetor.set(linha.departmentId, linha._count._all);
  }

  let agentsAvailable = 0;
  for (const agent of onlineAgents) {
    const active = activeChatsMap.get(agent.id) ?? 0;
    if (active < agent.maxConcurrentChats) agentsAvailable += 1;
  }

  // Estatísticas por departamento
  const deptStats = departments.map((d) => ({
    departmentId: d.id,
    name: d.name,
    color: d.color,
    waiting: esperandoPorSetor.get(d.id) ?? 0,
    active: emAtendimentoPorSetor.get(d.id) ?? 0,
    resolvedToday: resolvidasPorSetor.get(d.id) ?? 0,
    avgFirstResponseSeconds: null,
  }));

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
      ? Math.round(((aiHandledCount - (activeCount + queueWaitingCount)) / newTodayCount) * 100)
      : 0;

  return {
    generatedAt: new Date().toISOString(),
    live: {
      botConversations: botCount,
      waitingInQueue: queueWaitingCount,
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
      aiHandoffCount: queueWaitingCount + activeCount,
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
/**
 * Conversas em andamento para o painel de supervisao.
 *
 * O filtro de visibilidade e o MESMO da lista de conversas. Sem ele, esta
 * rota devolvia a organizacao inteira para qualquer um que passasse na
 * permissao - e `authorize` aceita QUALQUER uma das permissoes pedidas, entao
 * um supervisor de Oficina recebia aqui as conversas de Vendas e Financeiro,
 * com nome, telefone e ultima mensagem do cliente, enquanto a tela de
 * atendimento as escondia dele. Regra de acesso que vale numa rota e nao
 * vale em outra nao e regra.
 *
 * Para ADMIN e OWNER o filtro e vazio: o painel continua mostrando tudo.
 */
export async function getLiveConversations(subject: ConversationAccessSubject) {
  const conversations = await prisma.conversation.findMany({
    where: {
      orgId: subject.orgId,
      ...conversationVisibilityWhere(subject),
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
