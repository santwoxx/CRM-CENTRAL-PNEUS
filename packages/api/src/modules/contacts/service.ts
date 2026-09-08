import { LifecycleStage } from '@crm/shared';
import { prisma } from '../../db/prisma.js';
import { NotFoundError } from '../../lib/errors.js';

export interface ListContactsQuery {
  orgId: string;
  search?: string;
  tag?: string;
  lifecycleStage?: LifecycleStage;
  limit?: number;
  cursor?: string;
}

export async function listContacts(query: ListContactsQuery) {
  const limit = Math.min(query.limit ?? 30, 100);

  const where = {
    orgId: query.orgId,
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' as const } },
            { pushName: { contains: query.search, mode: 'insensitive' as const } },
            { phone: { contains: query.search } },
          ],
        }
      : {}),
    ...(query.tag ? { tags: { has: query.tag } } : {}),
    ...(query.lifecycleStage ? { lifecycleStage: query.lifecycleStage } : {}),
  };

  const contacts = await prisma.contact.findMany({
    where,
    include: {
      preferredAgent: {
        select: { id: true, name: true, email: true, avatarUrl: true, presence: true, isActive: true },
      },
      lastDepartment: {
        select: { id: true, name: true, color: true },
      },
      _count: { select: { conversations: true } },
    },
    orderBy: { lastContactAt: 'desc' },
    take: limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });

  const hasMore = contacts.length > limit;
  const page = hasMore ? contacts.slice(0, limit) : contacts;

  return {
    items: page.map((c) => ({
      id: c.id,
      name: c.name,
      pushName: c.pushName,
      phone: c.phone,
      email: c.email,
      document: c.document,
      avatarUrl: c.avatarUrl,
      lifecycleStage: c.lifecycleStage as LifecycleStage,
      tags: c.tags,
      notes: c.notes,
      customFields: c.customFields,
      isBlocked: c.isBlocked,
      firstContactAt: c.firstContactAt?.toISOString() ?? null,
      lastContactAt: c.lastContactAt?.toISOString() ?? null,
      preferredAgent: c.preferredAgent,
      lastDepartment: c.lastDepartment,
      totalConversations: c._count.conversations,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    })),
    nextCursor: hasMore ? page.at(-1)?.id ?? null : null,
  };
}

export async function getContact(id: string, orgId: string) {
  const contact = await prisma.contact.findFirst({
    where: { id, orgId },
    include: {
      preferredAgent: {
        select: { id: true, name: true, email: true, avatarUrl: true, presence: true, isActive: true },
      },
      lastDepartment: {
        select: { id: true, name: true, color: true },
      },
      conversations: {
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: {
          channel: { select: { id: true, name: true, type: true } },
          department: { select: { id: true, name: true, color: true } },
          assignedUser: { select: { id: true, name: true } },
        },
      },
      _count: { select: { conversations: true } },
    },
  });

  if (!contact) throw new NotFoundError('Contato');
  return contact;
}

export async function updateContact(
  id: string,
  orgId: string,
  input: {
    name?: string;
    email?: string | null;
    document?: string | null;
    tags?: string[];
    notes?: string | null;
    lifecycleStage?: LifecycleStage;
    customFields?: Record<string, unknown>;
    isBlocked?: boolean;
    preferredAgentId?: string | null;
  },
) {
  const contact = await prisma.contact.findFirst({ where: { id, orgId } });
  if (!contact) throw new NotFoundError('Contato');

  const updated = await prisma.contact.update({
    where: { id },
    data: {
      name: input.name,
      email: input.email,
      document: input.document,
      tags: input.tags,
      notes: input.notes,
      lifecycleStage: input.lifecycleStage,
      customFields: (input.customFields ?? undefined) as never,
      isBlocked: input.isBlocked,
      preferredAgentId: input.preferredAgentId,
    },
  });

  return updated;
}
