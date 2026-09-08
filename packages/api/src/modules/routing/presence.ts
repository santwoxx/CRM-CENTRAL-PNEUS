import {
  AgentPresence,
  ACTIVE_CONVERSATION_STATUSES,
  type AgentPresenceDTO,
  type UserRole,
} from '@crm/shared';
import { prisma } from '../../db/prisma.js';
import { redis } from '../../lib/redis.js';
import { logger } from '../../lib/logger.js';
import { env } from '../../env.js';
import { emitPresenceChanged } from '../../realtime/emitter.js';

/**
 * Presenca dos atendentes.
 *
 * Combina tres sinais, porque nenhum sozinho conta a verdade:
 *  1. O status que a pessoa escolheu (ONLINE / AWAY / BUSY) - fica no banco.
 *  2. Se ainda existe socket conectado - fica no Redis, e o unico jeito de
 *     saber que o navegador foi fechado sem avisar.
 *  3. Quantas conversas ela ja tem - decide se ainda cabe mais uma.
 *
 * O admin ve o resultado dos tres; o roteador so entrega conversa para quem
 * passa nos tres.
 */

const socketsKey = (userId: string) => `presence:sockets:${userId}`;
const touchKey = (userId: string) => `presence:touch:${userId}`;

/** TTL de seguranca: se o processo morrer, o registro nao fica preso. */
const SOCKET_SET_TTL_SECONDS = 6 * 60 * 60;

/** Grava lastSeenAt no maximo uma vez por minuto por usuario. */
const TOUCH_THROTTLE_SECONDS = 60;

export async function registerConnection(userId: string, socketId: string): Promise<void> {
  await redis
    .multi()
    .sadd(socketsKey(userId), socketId)
    .expire(socketsKey(userId), SOCKET_SET_TTL_SECONDS)
    .exec();

  const socketCount = await redis.scard(socketsKey(userId));

  // Primeira aba aberta: quem estava offline volta a ficar online sozinho.
  if (socketCount === 1) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { presence: true },
    });
    if (user?.presence === AgentPresence.OFFLINE) {
      await setPresence(userId, AgentPresence.ONLINE, { automatic: true });
      return;
    }
  }

  await touch(userId, { force: true });
  logger.debug({ userId, socketCount }, 'Conexao de atendente registrada');
}

export async function unregisterConnection(userId: string, socketId: string): Promise<void> {
  await redis.srem(socketsKey(userId), socketId);
  const socketCount = await redis.scard(socketsKey(userId));

  // Ultima aba fechada: cai para offline e sai da roleta de distribuicao.
  if (socketCount === 0) {
    await setPresence(userId, AgentPresence.OFFLINE, { automatic: true });
  }
}

export async function countConnections(userId: string): Promise<number> {
  return redis.scard(socketsKey(userId));
}

/**
 * Atualiza o "visto por ultimo".
 * Passa pelo Redis primeiro para nao transformar cada digitacao num UPDATE.
 */
export async function touch(userId: string, options: { force?: boolean } = {}): Promise<void> {
  if (options.force) {
    await redis.set(touchKey(userId), '1', 'EX', TOUCH_THROTTLE_SECONDS);
  } else {
    const isFresh = await redis.set(touchKey(userId), '1', 'EX', TOUCH_THROTTLE_SECONDS, 'NX');
    if (isFresh !== 'OK') return;
  }

  await prisma.user
    .update({ where: { id: userId }, data: { lastSeenAt: new Date() } })
    .catch((error) => logger.warn({ err: error, userId }, 'Falha ao atualizar lastSeenAt'));
}

export async function setPresence(
  userId: string,
  presence: AgentPresence,
  options: { automatic?: boolean } = {},
): Promise<AgentPresenceDTO | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, orgId: true, presence: true },
  });
  if (!user) return null;
  if (user.presence === presence) return buildPresenceDTO(userId);

  const now = new Date();

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: {
        presence,
        presenceChangedAt: now,
        ...(presence !== AgentPresence.OFFLINE ? { lastSeenAt: now } : {}),
      },
    }),
    prisma.agentPresenceLog.create({
      data: { userId, presence, automatic: options.automatic ?? false },
    }),
  ]);

  const dto = await buildPresenceDTO(userId);
  if (dto) await emitPresenceChanged(user.orgId, dto);

  logger.info(
    { userId, presence, automatic: options.automatic ?? false },
    'Presenca do atendente alterada',
  );

  return dto;
}

/** Quantas conversas cada atendente da lista tem ocupando slot agora. */
export async function getActiveChatCounts(userIds: string[]): Promise<Map<string, number>> {
  if (userIds.length === 0) return new Map();

  const rows = await prisma.conversation.groupBy({
    by: ['assignedUserId'],
    where: {
      assignedUserId: { in: userIds },
      status: { in: ACTIVE_CONVERSATION_STATUSES as never },
    },
    _count: { _all: true },
  });

  const counts = new Map<string, number>(userIds.map((id) => [id, 0]));
  for (const row of rows) {
    if (row.assignedUserId) counts.set(row.assignedUserId, row._count._all);
  }
  return counts;
}

const PRESENCE_SELECT = {
  id: true,
  name: true,
  avatarUrl: true,
  role: true,
  presence: true,
  maxConcurrentChats: true,
  presenceChangedAt: true,
  lastSeenAt: true,
  departments: { select: { departmentId: true } },
} as const;

type PresenceRow = {
  id: string;
  name: string;
  avatarUrl: string | null;
  role: string;
  presence: string;
  maxConcurrentChats: number;
  presenceChangedAt: Date | null;
  lastSeenAt: Date | null;
  departments: { departmentId: string }[];
};

function toPresenceDTO(user: PresenceRow, activeChats: number): AgentPresenceDTO {
  const presence = user.presence as AgentPresence;

  return {
    userId: user.id,
    name: user.name,
    avatarUrl: user.avatarUrl,
    role: user.role as UserRole,
    presence,
    activeChats,
    maxConcurrentChats: user.maxConcurrentChats,
    // So recebe conversa nova quem esta ONLINE e ainda tem vaga.
    acceptingChats: presence === AgentPresence.ONLINE && activeChats < user.maxConcurrentChats,
    departmentIds: user.departments.map((membership) => membership.departmentId),
    changedAt: user.presenceChangedAt?.toISOString() ?? null,
    lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
  };
}

export async function buildPresenceDTO(userId: string): Promise<AgentPresenceDTO | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: PRESENCE_SELECT });
  if (!user) return null;

  const counts = await getActiveChatCounts([userId]);
  return toPresenceDTO(user, counts.get(userId) ?? 0);
}

/** Foto de todos os atendentes. Alimenta o painel do admin. */
export async function getPresenceSnapshot(orgId: string): Promise<AgentPresenceDTO[]> {
  const users = await prisma.user.findMany({
    where: { orgId, isActive: true, deletedAt: null },
    select: PRESENCE_SELECT,
    orderBy: { name: 'asc' },
  });

  const counts = await getActiveChatCounts(users.map((user) => user.id));
  return users.map((user) => toPresenceDTO(user, counts.get(user.id) ?? 0));
}

/**
 * Coloca em ausente quem sumiu sem fechar o navegador.
 * Sem isso, conversas seriam entregues para uma tela que ninguem esta olhando.
 */
export async function applyAutoAway(): Promise<number> {
  const threshold = new Date(Date.now() - env.AGENT_AUTO_AWAY_MINUTES * 60_000);

  const candidates = await prisma.user.findMany({
    where: {
      presence: AgentPresence.ONLINE,
      OR: [{ lastSeenAt: { lt: threshold } }, { lastSeenAt: null }],
    },
    select: { id: true },
  });

  let changed = 0;
  for (const candidate of candidates) {
    // Confirma no Redis: pode ter socket vivo e apenas nao ter dado heartbeat.
    if ((await countConnections(candidate.id)) > 0) continue;
    await setPresence(candidate.id, AgentPresence.AWAY, { automatic: true });
    changed += 1;
  }

  if (changed > 0) logger.info({ count: changed }, 'Atendentes marcados como ausentes');
  return changed;
}
