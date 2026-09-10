import {
  AgentPresence,
  ACTIVE_CONVERSATION_STATUSES,
  ConversationEventType,
  ConversationStatus,
  HandoffReason,
  RoutingStrategy,
  type ConversationSummary,
} from '@crm/shared';
import { prisma, withAdvisoryLock, type Db } from '../../db/prisma.js';
import { logger } from '../../lib/logger.js';
import { env } from '../../env.js';
import { NotFoundError } from '../../lib/errors.js';
import { isWithinBusinessHours, parseBusinessHours } from '../../lib/time.js';
import {
  conversationInclude,
  toConversationSummary,
} from '../conversations/serializer.js';
import {
  emitConversationAssigned,
  emitConversationUpdated,
  emitQueueUpdated,
  emitSystemAlert,
} from '../../realtime/emitter.js';

/**
 * Motor de roteamento.
 *
 * Decide para QUEM vai cada conversa. As garantias que este arquivo precisa
 * sustentar, porque falha aqui e cliente sem resposta:
 *
 *  1. Nunca dois atendentes na mesma conversa. Toda atribuicao termina num
 *     UPDATE condicional: se o status ja mudou, a operacao aborta.
 *  2. Nunca passar do limite de conversas do atendente. A escolha do
 *     candidato roda dentro de uma trava por setor, entao duas conversas
 *     simultaneas nao enxergam a mesma vaga livre.
 *  3. Nunca perder a conversa. Se ninguem pode atender, ela vai para a fila
 *     com hora marcada - e a varredura periodica tenta de novo.
 */

export interface RouteOptions {
  reason: HandoffReason;
  /** Setor de destino. Sem isso, deduzimos pelo contexto. */
  departmentId?: string | null;
  /** Atendente pedido explicitamente (cliente recorrente ou transferencia). */
  preferredUserId?: string | null;
  /** Quem disparou, quando foi um humano. */
  actorUserId?: string | null;
  /** Ignora a preferencia historica do contato (usado em transferencia). */
  ignoreContactPreference?: boolean;
}

export interface RouteResult {
  status: 'assigned' | 'queued' | 'skipped';
  conversationId: string;
  assignedUserId: string | null;
  departmentId: string | null;
  reason: string;
}

interface AgentCandidate {
  userId: string;
  name: string;
  activeChats: number;
  maxConcurrentChats: number;
  priority: number;
  lastAssignedAt: Date | null;
}

/**
 * Decide o setor de destino, na ordem: pedido explicito, setor atual da
 * conversa, ultimo setor que atendeu este contato, setor padrao.
 */
async function resolveDepartmentId(
  db: Db,
  conversation: { orgId: string; departmentId: string | null; contactId: string },
  explicitDepartmentId?: string | null,
): Promise<string | null> {
  if (explicitDepartmentId) {
    const exists = await db.department.findFirst({
      where: { id: explicitDepartmentId, orgId: conversation.orgId, isActive: true },
      select: { id: true },
    });
    if (exists) return exists.id;
    logger.warn(
      { departmentId: explicitDepartmentId },
      'Setor solicitado nao existe ou esta inativo; usando fallback',
    );
  }

  if (conversation.departmentId) return conversation.departmentId;

  const contact = await db.contact.findUnique({
    where: { id: conversation.contactId },
    select: { lastDepartmentId: true },
  });
  if (contact?.lastDepartmentId) {
    const stillActive = await db.department.findFirst({
      where: { id: contact.lastDepartmentId, isActive: true },
      select: { id: true },
    });
    if (stillActive) return stillActive.id;
  }

  // Setor padrao: o primeiro na ordem definida pelo admin.
  const fallback = await db.department.findFirst({
    where: { orgId: conversation.orgId, isActive: true },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    select: { id: true },
  });

  return fallback?.id ?? null;
}

/**
 * Atendentes que podem receber uma conversa agora.
 * Precisa estar ativo, ONLINE e com vaga - os tres, sempre.
 */
async function findEligibleAgents(
  db: Db,
  departmentId: string | null,
  orgId: string,
): Promise<AgentCandidate[]> {
  const memberships = departmentId
    ? await db.departmentMember.findMany({
        where: {
          departmentId,
          user: {
            isActive: true,
            deletedAt: null,
            presence: AgentPresence.ONLINE,
          },
        },
        select: {
          priority: true,
          user: {
            select: { id: true, name: true, maxConcurrentChats: true, lastAssignedAt: true },
          },
        },
      })
    : // Sem setor definido, qualquer atendente online da empresa serve.
      (
        await db.user.findMany({
          where: {
            orgId,
            isActive: true,
            deletedAt: null,
            presence: AgentPresence.ONLINE,
          },
          select: { id: true, name: true, maxConcurrentChats: true, lastAssignedAt: true },
        })
      ).map((user) => ({ priority: 0, user }));

  if (memberships.length === 0) return [];

  const userIds = memberships.map((membership) => membership.user.id);

  const counts = await db.conversation.groupBy({
    by: ['assignedUserId'],
    where: {
      assignedUserId: { in: userIds },
      status: { in: ACTIVE_CONVERSATION_STATUSES as never },
    },
    _count: { _all: true },
  });

  const activeByUser = new Map<string, number>(userIds.map((id) => [id, 0]));
  for (const row of counts) {
    if (row.assignedUserId) activeByUser.set(row.assignedUserId, row._count._all);
  }

  return memberships
    .map((membership) => ({
      userId: membership.user.id,
      name: membership.user.name,
      activeChats: activeByUser.get(membership.user.id) ?? 0,
      maxConcurrentChats: membership.user.maxConcurrentChats,
      priority: membership.priority,
      lastAssignedAt: membership.user.lastAssignedAt,
    }))
    .filter((candidate) => candidate.activeChats < candidate.maxConcurrentChats);
}

/**
 * Escolhe o atendente entre os elegiveis.
 *
 * Ordem de preferencia, do mais forte para o mais fraco:
 *  1. Quem o cliente pediu (menu "falar com fulano" ou transferencia dirigida).
 *  2. O atendente dono do cliente - cliente recorrente volta para quem ja o
 *     conhece, que e exatamente o que ele espera.
 *  3. A estrategia configurada no setor.
 */
function pickAgent(
  candidates: AgentCandidate[],
  strategy: RoutingStrategy,
  options: { preferredUserId?: string | null; contactAgentId?: string | null },
): AgentCandidate | null {
  if (candidates.length === 0) return null;

  if (options.preferredUserId) {
    const preferred = candidates.find((candidate) => candidate.userId === options.preferredUserId);
    if (preferred) return preferred;
  }

  if (options.contactAgentId) {
    const owner = candidates.find((candidate) => candidate.userId === options.contactAgentId);
    if (owner) return owner;
  }

  if (strategy === RoutingStrategy.MANUAL) return null;

  const sorted = [...candidates].sort((a, b) => {
    // Prioridade definida pelo admin vence qualquer criterio automatico.
    if (a.priority !== b.priority) return b.priority - a.priority;

    if (strategy === RoutingStrategy.LEAST_BUSY && a.activeChats !== b.activeChats) {
      return a.activeChats - b.activeChats;
    }

    // Rodizio: quem esta ha mais tempo sem receber vai primeiro.
    const aTime = a.lastAssignedAt?.getTime() ?? 0;
    const bTime = b.lastAssignedAt?.getTime() ?? 0;
    if (aTime !== bTime) return aTime - bTime;

    return a.activeChats - b.activeChats;
  });

  return sorted[0] ?? null;
}

/**
 * Roteia uma conversa. Ponto de entrada unico - o handoff da IA, a
 * transferencia manual e a varredura da fila passam todos por aqui.
 */
export async function routeConversation(
  conversationId: string,
  options: RouteOptions,
): Promise<RouteResult> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      orgId: true,
      contactId: true,
      departmentId: true,
      status: true,
      assignedUserId: true,
      contact: { select: { preferredAgentId: true } },
    },
  });

  if (!conversation) throw new NotFoundError('Conversa');

  // Ja tem dono e ninguem pediu troca: nao mexe.
  if (
    conversation.assignedUserId &&
    !options.preferredUserId &&
    (conversation.status === ConversationStatus.ASSIGNED ||
      conversation.status === ConversationStatus.PENDING)
  ) {
    return {
      status: 'skipped',
      conversationId,
      assignedUserId: conversation.assignedUserId,
      departmentId: conversation.departmentId,
      reason: 'ja-atribuida',
    };
  }

  const departmentId = await resolveDepartmentId(prisma, conversation, options.departmentId);

  // A trava serializa TODA decisao de roteamento deste setor. E o que impede
  // duas conversas de ocuparem a mesma ultima vaga de um atendente.
  const lockKey = `routing:${departmentId ?? conversation.orgId}`;

  const result = await withAdvisoryLock(lockKey, async (tx) => {
    const department = departmentId
      ? await tx.department.findUnique({
          where: { id: departmentId },
          select: {
            id: true,
            name: true,
            routingStrategy: true,
            businessHours: true,
            offlineMessage: true,
          },
        })
      : null;

    const candidates = await findEligibleAgents(tx, departmentId, conversation.orgId);

    const chosen = pickAgent(
      candidates,
      (department?.routingStrategy as RoutingStrategy) ?? RoutingStrategy.LEAST_BUSY,
      {
        preferredUserId: options.preferredUserId ?? null,
        contactAgentId: options.ignoreContactPreference
          ? null
          : conversation.contact.preferredAgentId,
      },
    );

    if (!chosen) {
      const queued = await moveToQueue(tx, conversation.id, departmentId, options.reason);
      return {
        outcome: 'queued' as const,
        departmentId,
        department,
        changed: queued,
        agent: null,
      };
    }

    // UPDATE condicional: se outro processo ja assumiu a conversa entre a
    // leitura e agora, `count` volta 0 e nao atropelamos ninguem.
    const now = new Date();
    const updated = await tx.conversation.updateMany({
      where: {
        id: conversation.id,
        status: { in: [ConversationStatus.BOT, ConversationStatus.QUEUED] as never },
      },
      data: {
        assignedUserId: chosen.userId,
        departmentId,
        status: ConversationStatus.ASSIGNED,
        assignedAt: now,
        aiControlled: false,
        slaFirstResponseDueAt: new Date(now.getTime() + env.SLA_FIRST_RESPONSE_SECONDS * 1_000),
        slaBreached: false,
      },
    });

    if (updated.count === 0) {
      return { outcome: 'skipped' as const, departmentId, department, changed: false, agent: null };
    }

    await Promise.all([
      tx.user.update({ where: { id: chosen.userId }, data: { lastAssignedAt: now } }),
      tx.contact.update({
        where: { id: conversation.contactId },
        data: {
          // O atendente vira dono do cliente: o proximo contato volta para ele.
          preferredAgentId: chosen.userId,
          ...(departmentId ? { lastDepartmentId: departmentId } : {}),
        },
      }),
      tx.conversationEvent.create({
        data: {
          conversationId: conversation.id,
          type: ConversationEventType.ASSIGNED,
          actorUserId: options.actorUserId ?? null,
          data: {
            reason: options.reason,
            assignedUserId: chosen.userId,
            assignedUserName: chosen.name,
            departmentId,
            automatic: !options.actorUserId,
          },
        },
      }),
    ]);

    return { outcome: 'assigned' as const, departmentId, department, changed: true, agent: chosen };
  });

  return finalizeRouting(conversation.orgId, conversationId, options, result);
}

/** Coloca a conversa na fila do setor, preservando a hora de entrada. */
async function moveToQueue(
  db: Db,
  conversationId: string,
  departmentId: string | null,
  reason: HandoffReason,
): Promise<boolean> {
  const updated = await db.conversation.updateMany({
    where: {
      id: conversationId,
      status: { in: [ConversationStatus.BOT, ConversationStatus.QUEUED] as never },
    },
    data: {
      departmentId,
      status: ConversationStatus.QUEUED,
      assignedUserId: null,
      aiControlled: false,
      // `queuedAt` so e definido na PRIMEIRA vez: a espera do cliente conta
      // desde que ele entrou na fila, nao desde a ultima tentativa nossa.
      queuedAt: new Date(),
    },
  });

  if (updated.count === 0) return false;

  await db.conversationEvent.create({
    data: {
      conversationId,
      type: ConversationEventType.QUEUED,
      data: { reason, departmentId },
    },
  });

  return true;
}

interface RoutingOutcome {
  outcome: 'assigned' | 'queued' | 'skipped';
  departmentId: string | null;
  department: { id: string; name: string; businessHours: unknown; offlineMessage: string | null } | null;
  changed: boolean;
  agent: AgentCandidate | null;
}

/**
 * Efeitos colaterais da decisao: avisar as telas, avisar o cliente e
 * atualizar os contadores da fila. Fora da transacao de proposito - um erro
 * de rede aqui nao pode desfazer uma atribuicao ja gravada.
 */
async function finalizeRouting(
  orgId: string,
  conversationId: string,
  options: RouteOptions,
  result: RoutingOutcome,
): Promise<RouteResult> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: conversationInclude,
  });

  if (!conversation) throw new NotFoundError('Conversa');

  const summary: ConversationSummary = toConversationSummary(conversation);

  if (result.outcome === 'assigned' && result.changed) {
    await emitConversationAssigned(orgId, summary, null, options.actorUserId ?? null);
    logger.info(
      {
        conversationId,
        assignedUserId: result.agent?.userId,
        departmentId: result.departmentId,
        reason: options.reason,
      },
      'Conversa atribuida',
    );
  } else if (result.outcome === 'queued' && result.changed) {
    await emitConversationUpdated(orgId, summary);
    await notifyQueueDepth(orgId, result.departmentId);
    await maybeSendQueueNotice(conversation, result);
    logger.info(
      { conversationId, departmentId: result.departmentId, reason: options.reason },
      'Conversa enviada para a fila: nenhum atendente disponivel',
    );
  }

  return {
    status: result.outcome,
    conversationId,
    assignedUserId: conversation.assignedUserId,
    departmentId: conversation.departmentId,
    reason: options.reason,
  };
}

/**
 * Avisa o cliente que ele esta na fila. Enviado UMA vez por conversa: repetir
 * "aguarde" a cada mensagem irrita mais do que ajuda.
 */
async function maybeSendQueueNotice(
  conversation: { id: string; metadata: unknown; channelId: string; orgId: string },
  result: RoutingOutcome,
): Promise<void> {
  const metadata = (conversation.metadata ?? {}) as Record<string, unknown>;
  if (metadata.queueNoticeSent) return;

  const businessHours = parseBusinessHours(result.department?.businessHours);
  const isOpen = isWithinBusinessHours(businessHours);

  const text = isOpen
    ? 'Só um instante que um consultor já te responde. 😊'
    : (result.department?.offlineMessage ??
      'Recebemos sua mensagem fora do horario de atendimento. Retornaremos assim que abrirmos.');

  const { queueSystemMessage } = await import('../messages/outbox.js');
  await queueSystemMessage(conversation.id, text);

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { metadata: { ...metadata, queueNoticeSent: true } as never },
  });
}

/** Recalcula e publica o tamanho da fila do setor. */
export async function notifyQueueDepth(
  orgId: string,
  departmentId: string | null,
): Promise<void> {
  const waiting = await prisma.conversation.findMany({
    where: {
      orgId,
      status: ConversationStatus.QUEUED,
      ...(departmentId ? { departmentId } : {}),
    },
    select: { queuedAt: true },
    orderBy: { queuedAt: 'asc' },
  });

  const oldest = waiting[0]?.queuedAt;

  await emitQueueUpdated(orgId, {
    departmentId,
    waiting: waiting.length,
    oldestWaitingSeconds: oldest ? Math.round((Date.now() - oldest.getTime()) / 1_000) : 0,
  });
}

/**
 * Tenta rotear tudo que esta parado na fila.
 *
 * Chamado quando um atendente fica disponivel (login, encerrar conversa,
 * voltar de ausente) e tambem periodicamente, como rede de seguranca. Sem
 * isso, uma conversa que nao encontrou ninguem ficaria parada para sempre.
 */
export async function drainQueue(
  orgId: string,
  options: { departmentId?: string | null; limit?: number } = {},
): Promise<{ attempted: number; assigned: number }> {
  const waiting = await prisma.conversation.findMany({
    where: {
      orgId,
      status: ConversationStatus.QUEUED,
      ...(options.departmentId ? { departmentId: options.departmentId } : {}),
    },
    select: { id: true },
    // Urgente primeiro; dentro da mesma prioridade, quem espera ha mais tempo.
    orderBy: [{ priority: 'desc' }, { queuedAt: 'asc' }],
    take: options.limit ?? 50,
  });

  let assigned = 0;

  for (const conversation of waiting) {
    try {
      const result = await routeConversation(conversation.id, {
        reason: HandoffReason.LEAD_QUALIFIED,
      });
      if (result.status === 'assigned') assigned += 1;
      // Fila cheia e ninguem livre: parar cedo evita varrer a fila inteira a toa.
      else if (result.status === 'queued') break;
    } catch (error) {
      logger.error(
        { err: error, conversationId: conversation.id },
        'Falha ao rotear conversa da fila',
      );
    }
  }

  if (assigned > 0) {
    await notifyQueueDepth(orgId, options.departmentId ?? null);
    logger.info({ assigned, attempted: waiting.length }, 'Fila drenada');
  }

  return { attempted: waiting.length, assigned };
}

/** Transferencia manual para outro setor e/ou atendente. */
export async function transferConversation(
  conversationId: string,
  input: {
    departmentId?: string | null;
    userId?: string | null;
    note?: string;
    actorUserId: string;
  },
): Promise<RouteResult> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, orgId: true, assignedUserId: true, departmentId: true, status: true },
  });
  if (!conversation) throw new NotFoundError('Conversa');

  const previousUserId = conversation.assignedUserId;

  await prisma.$transaction(async (tx) => {
    // Solta a conversa antes de rotear: sem isso `routeConversation` a
    // consideraria "ja atribuida" e nao faria nada.
    await tx.conversation.update({
      where: { id: conversationId },
      data: {
        assignedUserId: null,
        status: ConversationStatus.QUEUED,
        queuedAt: new Date(),
        ...(input.departmentId !== undefined ? { departmentId: input.departmentId } : {}),
      },
    });

    await tx.conversationEvent.create({
      data: {
        conversationId,
        type: ConversationEventType.TRANSFERRED,
        actorUserId: input.actorUserId,
        data: {
          fromUserId: previousUserId,
          toUserId: input.userId ?? null,
          fromDepartmentId: conversation.departmentId,
          toDepartmentId: input.departmentId ?? null,
          note: input.note ?? null,
        },
      },
    });

    if (input.note) {
      await tx.message.create({
        data: {
          orgId: conversation.orgId,
          conversationId,
          channelId: (
            await tx.conversation.findUniqueOrThrow({
              where: { id: conversationId },
              select: { channelId: true },
            })
          ).channelId,
          direction: 'OUTBOUND',
          senderType: 'SYSTEM',
          senderUserId: input.actorUserId,
          type: 'TEXT',
          content: input.note,
          // Nota de transferencia e interna: o cliente nao ve.
          isPrivate: true,
          status: 'SENT',
          sentAt: new Date(),
        },
      });
    }
  });

  const result = await routeConversation(conversationId, {
    reason: HandoffReason.MANUAL,
    departmentId: input.departmentId ?? null,
    preferredUserId: input.userId ?? null,
    actorUserId: input.actorUserId,
    // Numa transferencia dirigida, o "dono" antigo do cliente nao manda.
    ignoreContactPreference: Boolean(input.userId),
  });

  // Quem perdeu a conversa tambem precisa ver a tela dele atualizar.
  if (previousUserId) {
    const updated = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: conversationInclude,
    });
    if (updated) {
      await emitConversationUpdated(conversation.orgId, toConversationSummary(updated), previousUserId);
    }
  }

  return result;
}

/** Devolve a conversa para a fila (o atendente "solta" o atendimento). */
export async function releaseConversation(
  conversationId: string,
  actorUserId: string,
): Promise<RouteResult> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, orgId: true, assignedUserId: true, departmentId: true },
  });
  if (!conversation) throw new NotFoundError('Conversa');

  await prisma.$transaction([
    prisma.conversation.update({
      where: { id: conversationId },
      data: {
        assignedUserId: null,
        status: ConversationStatus.QUEUED,
        queuedAt: new Date(),
      },
    }),
    prisma.conversationEvent.create({
      data: {
        conversationId,
        type: ConversationEventType.UNASSIGNED,
        actorUserId,
        data: { previousUserId: conversation.assignedUserId },
      },
    }),
  ]);

  return routeConversation(conversationId, {
    reason: HandoffReason.MANUAL,
    actorUserId,
    ignoreContactPreference: true,
  });
}

/**
 * Avisa os admins sobre conversas encalhadas na fila.
 * Marca no evento para nao alertar a mesma conversa repetidamente.
 */
export async function escalateStaleQueue(orgId: string): Promise<number> {
  const threshold = new Date(Date.now() - env.QUEUE_ESCALATION_SECONDS * 1_000);

  const stale = await prisma.conversation.findMany({
    where: {
      orgId,
      status: ConversationStatus.QUEUED,
      queuedAt: { lt: threshold },
      events: { none: { type: ConversationEventType.ESCALATED } },
    },
    select: {
      id: true,
      queuedAt: true,
      department: { select: { name: true } },
      contact: { select: { name: true, phone: true } },
    },
    take: 20,
  });

  for (const conversation of stale) {
    const waitingMinutes = conversation.queuedAt
      ? Math.round((Date.now() - conversation.queuedAt.getTime()) / 60_000)
      : 0;

    await prisma.conversationEvent.create({
      data: {
        conversationId: conversation.id,
        type: ConversationEventType.ESCALATED,
        data: { waitingMinutes, departmentName: conversation.department?.name ?? null },
      },
    });

    await emitSystemAlert(orgId, {
      level: 'warning',
      code: 'QUEUE_STALE',
      message: `${conversation.contact.name ?? conversation.contact.phone ?? 'Cliente'} espera ha ${waitingMinutes} min na fila${
        conversation.department ? ` de ${conversation.department.name}` : ''
      }.`,
    });
  }

  return stale.length;
}
