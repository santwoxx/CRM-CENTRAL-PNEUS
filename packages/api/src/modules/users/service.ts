import { AgentPresence, UserRole } from '@crm/shared';
import { prisma } from '../../db/prisma.js';
import { hashPassword } from '../../lib/crypto.js';
import { ConflictError, NotFoundError } from '../../lib/errors.js';
import { getActiveChatCounts, setPresence } from '../routing/presence.js';
import { revokeAllSessions } from '../auth/service.js';

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

  return listUsers(orgId).then((all) => all.find((u) => u.id === id));
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
}
