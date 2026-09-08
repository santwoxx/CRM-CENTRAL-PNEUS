import { prisma } from '../../db/prisma.js';
import { logger } from '../../lib/logger.js';

/**
 * Trilha de auditoria.
 *
 * Responde "quem mudou isso e quando". Registrar auditoria NUNCA pode
 * derrubar a operacao auditada - por isso todo erro aqui e engolido e
 * apenas logado.
 */

export interface AuditInput {
  orgId: string;
  userId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** Campos que jamais entram na auditoria, mesmo dentro de before/after. */
const SENSITIVE_KEYS = new Set([
  'password',
  'passwordHash',
  'credentials',
  'credentialsEncrypted',
  'accessToken',
  'refreshToken',
  'refreshTokenHash',
  'apiKey',
  'api_key',
  'secret',
]);

function sanitize(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (depth > 6) return '[profundo demais]';
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitize(item, depth + 1));

  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'object') return value;

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    result[key] = SENSITIVE_KEYS.has(key) ? '[REDACTED]' : sanitize(item, depth + 1);
  }
  return result;
}

export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        orgId: input.orgId,
        userId: input.userId ?? null,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId ?? null,
        before: input.before === undefined ? undefined : (sanitize(input.before) as never),
        after: input.after === undefined ? undefined : (sanitize(input.after) as never),
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent?.slice(0, 500) ?? null,
      },
    });
  } catch (error) {
    logger.error({ err: error, action: input.action }, 'Falha ao registrar auditoria');
  }
}

export async function listAudit(
  orgId: string,
  filters: { entity?: string; entityId?: string; userId?: string; limit?: number; cursor?: string },
) {
  const limit = Math.min(filters.limit ?? 50, 200);

  const items = await prisma.auditLog.findMany({
    where: {
      orgId,
      ...(filters.entity ? { entity: filters.entity } : {}),
      ...(filters.entityId ? { entityId: filters.entityId } : {}),
      ...(filters.userId ? { userId: filters.userId } : {}),
    },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
  });

  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;

  return {
    items: page.map((entry) => ({
      id: entry.id,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      before: entry.before,
      after: entry.after,
      ipAddress: entry.ipAddress,
      createdAt: entry.createdAt.toISOString(),
      user: entry.user,
    })),
    nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
  };
}
