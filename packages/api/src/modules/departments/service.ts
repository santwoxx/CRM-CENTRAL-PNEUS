import { AgentPresence, ConversationStatus, RoutingStrategy } from '@crm/shared';
import { prisma } from '../../db/prisma.js';
import { ConflictError, NotFoundError } from '../../lib/errors.js';

export interface CreateDepartmentInput {
  orgId: string;
  name: string;
  slug?: string;
  description?: string | null;
  color?: string;
  menuLabel?: string | null;
  showInMenu?: boolean;
  order?: number;
  routingStrategy?: RoutingStrategy;
  aiEnabled?: boolean;
  offlineMessage?: string | null;
  closingMessage?: string | null;
  businessHours?: unknown;
  memberIds?: string[];
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function listDepartments(orgId: string) {
  const departments = await prisma.department.findMany({
    where: { orgId },
    include: {
      members: {
        include: {
          user: { select: { id: true, name: true, presence: true, isActive: true } },
        },
      },
    },
    orderBy: { order: 'asc' },
  });

  const queueCounts = await prisma.conversation.groupBy({
    by: ['departmentId'],
    where: { orgId, status: ConversationStatus.QUEUED },
    _count: { _all: true },
  });

  const waitingMap = new Map<string, number>();
  for (const q of queueCounts) {
    if (q.departmentId) waitingMap.set(q.departmentId, q._count._all);
  }

  return departments.map((d) => ({
    id: d.id,
    name: d.name,
    slug: d.slug,
    description: d.description,
    color: d.color,
    menuLabel: d.menuLabel,
    showInMenu: d.showInMenu,
    order: d.order,
    isActive: d.isActive,
    routingStrategy: d.routingStrategy as RoutingStrategy,
    aiEnabled: d.aiEnabled,
    offlineMessage: d.offlineMessage,
    closingMessage: d.closingMessage,
    businessHours: d.businessHours,
    memberCount: d.members.length,
    onlineCount: d.members.filter((m) => m.user.isActive && m.user.presence === AgentPresence.ONLINE).length,
    waitingCount: waitingMap.get(d.id) ?? 0,
    members: d.members.map((m) => ({
      userId: m.user.id,
      name: m.user.name,
      presence: m.user.presence,
      isSupervisor: m.isSupervisor,
    })),
  }));
}

export async function createDepartment(input: CreateDepartmentInput) {
  const slug = input.slug || slugify(input.name);

  const existing = await prisma.department.findFirst({
    where: { orgId: input.orgId, slug },
  });

  if (existing) {
    throw new ConflictError('Ja existe um setor com este nome ou identificador');
  }

  return prisma.department.create({
    data: {
      orgId: input.orgId,
      name: input.name,
      slug,
      description: input.description ?? null,
      color: input.color ?? '#2563eb',
      menuLabel: input.menuLabel ?? input.name.slice(0, 24),
      showInMenu: input.showInMenu ?? true,
      order: input.order ?? 0,
      routingStrategy: input.routingStrategy ?? RoutingStrategy.LEAST_BUSY,
      aiEnabled: input.aiEnabled ?? true,
      offlineMessage: input.offlineMessage ?? null,
      closingMessage: input.closingMessage ?? null,
      businessHours: (input.businessHours ?? undefined) as never,
      members: {
        create: (input.memberIds ?? []).map((userId) => ({ userId })),
      },
    },
  });
}

export async function updateDepartment(
  id: string,
  orgId: string,
  input: Partial<CreateDepartmentInput> & { isActive?: boolean },
) {
  const department = await prisma.department.findFirst({ where: { id, orgId } });
  if (!department) throw new NotFoundError('Setor');

  await prisma.$transaction(async (tx) => {
    if (input.memberIds !== undefined) {
      await tx.departmentMember.deleteMany({ where: { departmentId: id } });
      await tx.departmentMember.createMany({
        data: input.memberIds.map((userId) => ({ departmentId: id, userId })),
      });
    }

    await tx.department.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description,
        color: input.color,
        menuLabel: input.menuLabel,
        showInMenu: input.showInMenu,
        order: input.order,
        isActive: input.isActive,
        routingStrategy: input.routingStrategy,
        aiEnabled: input.aiEnabled,
        offlineMessage: input.offlineMessage,
        closingMessage: input.closingMessage,
        businessHours: (input.businessHours ?? undefined) as never,
      },
    });
  });

  return listDepartments(orgId).then((all) => all.find((d) => d.id === id));
}

export async function deleteDepartment(id: string, orgId: string) {
  const department = await prisma.department.findFirst({ where: { id, orgId } });
  if (!department) throw new NotFoundError('Setor');

  // Ao invés de deletar e quebrar relacionamentos, desativa
  await prisma.department.update({
    where: { id },
    data: { isActive: false, showInMenu: false },
  });
}
