import {
  ACTIVE_CONVERSATION_STATUSES,
  AgentPresence,
  ConversationStatus,
  HandoffReason,
  UserRole,
} from '@crm/shared';
import { prisma } from '../../db/prisma.js';
import { hashPassword } from '../../lib/crypto.js';
import { ConflictError, NotFoundError } from '../../lib/errors.js';
import { getActiveChatCounts, setPresence } from '../routing/presence.js';
import { revokeAllSessions } from '../auth/service.js';
import { routeConversation } from '../routing/router.js';
import { logger } from '../../lib/logger.js';
import { assertDepartmentsBelongToOrg } from '../tenancy/guards.js';

export interface CreateUserInput {
  orgId: string;
  name: string;
  email: string;
  password: string;
  role?: UserRole;
  maxConcurrentChats?: number;
  departmentIds?: string[];
}

export async function createUser(input: CreateUserInput) {
  await assertDepartmentsBelongToOrg(input.departmentIds ?? [], input.orgId);

  const existing = await prisma.user.findFirst({
    where: { orgId: input.orgId, email: input.email.toLowerCase(), deletedAt: null },
  });

  if (existing) {
    throw new ConflictError('Ja existe um usuario com este e-mail');
  }

  const passwordHash = await hashPassword(input.password);

  const user = await prisma.user.create({
    data: {
      orgId: input.orgId,
      name: input.name,
      email: input.email.toLowerCase(),
      passwordHash,
      role: input.role ?? UserRole.AGENT,
      maxConcurrentChats: input.maxConcurrentChats ?? 5,
      presence: AgentPresence.OFFLINE,
      departments: {
        create: (input.departmentIds ?? []).map((deptId) => ({
          departmentId: deptId,
        })),
      },
    },
    include: {
      departments: {
        include: { department: { select: { id: true, name: true, color: true } } },
      },
    },
  });

  return user;
}

export async function listUsers(orgId: string) {
  const users = await prisma.user.findMany({
    where: { orgId, deletedAt: null },
    include: {
      departments: {
        include: { department: { select: { id: true, name: true, color: true } } },
      },
    },
    orderBy: { name: 'asc' },
  });

  const counts = await getActiveChatCounts(users.map((u) => u.id));

  return users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role as UserRole,
    avatarUrl: u.avatarUrl,
    presence: u.presence as AgentPresence,
    isActive: u.isActive,
    maxConcurrentChats: u.maxConcurrentChats,
    activeChats: counts.get(u.id) ?? 0,
    departments: u.departments.map((d) => ({
      id: d.department.id,
      name: d.department.name,
      color: d.department.color,
      isSupervisor: d.isSupervisor,
    })),
    lastSeenAt: u.lastSeenAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
  }));
}

export async function updateUser(
  id: string,
  orgId: string,
  input: {
    name?: string;
    role?: UserRole;
    maxConcurrentChats?: number;
    isActive?: boolean;
    departmentIds?: string[];
  },
) {
  const user = await prisma.user.findFirst({ where: { id, orgId, deletedAt: null } });
  if (!user) throw new NotFoundError('Usuario');

  if (input.departmentIds !== undefined) {
    await assertDepartmentsBelongToOrg(input.departmentIds, orgId);
  }

  await prisma.$transaction(async (tx) => {
    if (input.departmentIds !== undefined) {
      await tx.departmentMember.deleteMany({ where: { userId: id } });
      await tx.departmentMember.createMany({
        data: input.departmentIds.map((deptId) => ({
          userId: id,
          departmentId: deptId,
        })),
      });
    }

    await tx.user.update({
      where: { id },
      data: {
        name: input.name,
        role: input.role,
        maxConcurrentChats: input.maxConcurrentChats,
        isActive: input.isActive,
      },
    });

    if (input.isActive === false) {
      await revokeAllSessions(id);
    }
  });

  // Desativar e o caminho de "a pessoa saiu da loja". Os clientes que ela
  // estava atendendo precisam voltar para a fila, ou ficam sem resposta.
  if (input.isActive === false) {
    await liberarConversasDoUsuario(id, orgId);
  }

  return listUsers(orgId).then((all) => all.find((u) => u.id === id));
}

/**
 * Devolve para a fila as conversas abertas de quem esta saindo.
 *
 * Sem isto, desativar ou remover um atendente deixava os clientes dele
 * pendurados: a conversa continuava ASSIGNED para alguem que nao entra mais
 * no sistema e que o roteador nunca mais considera. Ninguem ve, ninguem
 * responde, e nada sinaliza o problema - o cliente simplesmente e abandonado
 * em silencio. Numa loja, isso acontece toda vez que um vendedor sai.
 *
 * Solta a atribuicao ANTES de rotear, porque o roteador nao mexe em conversa
 * que ja tem dono. E limpa a preferencia do contato: cliente recorrente que
 * apontava para quem saiu ficaria com um ponteiro morto para sempre.
 */
export async function liberarConversasDoUsuario(userId: string, orgId: string): Promise<number> {
  const abertas = await prisma.conversation.findMany({
    where: {
      orgId,
      assignedUserId: userId,
      status: { in: ACTIVE_CONVERSATION_STATUSES as never },
    },
    select: { id: true },
  });

  await prisma.contact.updateMany({
    where: { orgId, preferredAgentId: userId },
    data: { preferredAgentId: null },
  });

  if (abertas.length === 0) return 0;

  await prisma.conversation.updateMany({
    where: { id: { in: abertas.map((c) => c.id) } },
    data: {
      assignedUserId: null,
      status: ConversationStatus.QUEUED,
      queuedAt: new Date(),
    },
  });

  for (const conversa of abertas) {
    // Uma falha de roteamento nao pode impedir a saida do atendente. A
    // conversa ja esta em QUEUED - a varredura periodica pega depois.
    await routeConversation(conversa.id, {
      reason: HandoffReason.MANUAL,
      ignoreContactPreference: true,
    }).catch((error) =>
      logger.error(
        { err: error, conversationId: conversa.id, userId },
        'Falha ao reatribuir conversa de atendente removido',
      ),
    );
  }

  logger.info({ userId, total: abertas.length }, 'Conversas devolvidas a fila');
  return abertas.length;
}

export async function deleteUser(id: string, orgId: string) {
  const user = await prisma.user.findFirst({ where: { id, orgId, deletedAt: null } });
  if (!user) throw new NotFoundError('Usuario');

  await prisma.$transaction([
    prisma.user.update({
      where: { id },
      data: { isActive: false, deletedAt: new Date() },
    }),
    prisma.departmentMember.deleteMany({ where: { userId: id } }),
  ]);

  await revokeAllSessions(id);
  await setPresence(id, AgentPresence.OFFLINE, { automatic: true });
  await liberarConversasDoUsuario(id, orgId);
}
