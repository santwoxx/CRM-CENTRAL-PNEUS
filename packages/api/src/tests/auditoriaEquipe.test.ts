import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserRole } from '@crm/shared';
import { isApiPath } from '../lib/routes.js';

/**
 * Trilha das mudancas na equipe.
 *
 * Promover alguem a administrador e tirar o acesso de alguem sao as acoes
 * mais sensiveis do sistema, e nao eram registradas em lugar nenhum. Depois
 * de uma briga societaria ou de uma demissao, "quem fez isso e quando" nao
 * tinha resposta.
 */

const registrarAuditoria = vi.fn();
const usuarioAtual = {
  id: 'alvo',
  name: 'Carlos',
  email: 'carlos@centralpneus.com.br',
  role: UserRole.AGENT,
  isActive: true,
  maxConcurrentChats: 5,
};

vi.mock('../db/prisma.js', () => ({
  prisma: {
    user: {
      findFirst: vi.fn(async () => usuarioAtual),
      findMany: vi.fn(async () => []),
      update: vi.fn(),
    },
    departmentMember: {
      findMany: vi.fn(async () => [{ departmentId: 'setor-vendas' }]),
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    conversation: { findMany: vi.fn(async () => []), updateMany: vi.fn() },
    contact: { updateMany: vi.fn() },
    $transaction: vi.fn(async (arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (tx: unknown) => Promise<unknown>)({
            user: { update: vi.fn() },
            departmentMember: { deleteMany: vi.fn(), createMany: vi.fn() },
          })
        : undefined,
    ),
  },
}));
vi.mock('../modules/audit/service.js', () => ({
  recordAudit: (...args: unknown[]) => registrarAuditoria(...args),
}));
vi.mock('../modules/auth/service.js', () => ({ revokeAllSessions: vi.fn() }));
vi.mock('../modules/routing/presence.js', () => ({
  setPresence: vi.fn(),
  getActiveChatCounts: vi.fn(async () => new Map()),
}));
vi.mock('../modules/routing/router.js', () => ({ routeConversation: vi.fn() }));
vi.mock('../modules/tenancy/guards.js', () => ({
  assertDepartmentsBelongToOrg: vi.fn(),
  assertUsersBelongToOrg: vi.fn(),
}));
vi.mock('../lib/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { updateUser } = await import('../modules/users/service.js');

const ATOR = { userId: 'admin-1', ipAddress: '200.150.10.20', userAgent: 'Chrome' };

beforeEach(() => registrarAuditoria.mockReset());

function registro() {
  return registrarAuditoria.mock.calls[0]?.[0] as Record<string, never>;
}

describe('auditoria das mudancas de equipe', () => {
  it('promocao a administrador vira um registro proprio', async () => {
    await updateUser('alvo', 'org-1', { role: UserRole.ADMIN }, ATOR);

    const r = registro() as unknown as { action: string; before: never; after: never };
    // Acao propria porque e a primeira coisa que se procura numa investigacao.
    expect(r.action).toBe('user.role_changed');
    expect((r.before as unknown as { role: string }).role).toBe(UserRole.AGENT);
    expect((r.after as unknown as { role: string }).role).toBe(UserRole.ADMIN);
  });

  it('guarda quem fez, de onde e com que navegador', async () => {
    await updateUser('alvo', 'org-1', { role: UserRole.ADMIN }, ATOR);

    const r = registro() as unknown as { userId: string; ipAddress: string; entityId: string };
    expect(r.userId).toBe('admin-1');
    expect(r.ipAddress).toBe('200.150.10.20');
    expect(r.entityId).toBe('alvo');
  });

  it('tirar o acesso tem acao propria', async () => {
    await updateUser('alvo', 'org-1', { isActive: false }, ATOR);

    expect((registro() as unknown as { action: string }).action).toBe('user.deactivated');
  });

  it('mudanca de setor guarda o antes e o depois', async () => {
    await updateUser('alvo', 'org-1', { departmentIds: ['setor-oficina'] }, ATOR);

    const r = registro() as unknown as { before: never; after: never };
    expect((r.before as unknown as { departmentIds: string[] }).departmentIds).toEqual([
      'setor-vendas',
    ]);
    expect((r.after as unknown as { departmentIds: string[] }).departmentIds).toEqual([
      'setor-oficina',
    ]);
  });

  it('a senha nunca entra na trilha', async () => {
    await updateUser('alvo', 'org-1', { name: 'Carlos Mendes' }, ATOR);

    expect(JSON.stringify(registro())).not.toContain('passwordHash');
  });
});

describe('fronteira da rota de auditoria', () => {
  it('/audit e rota de API, nao tela do painel', () => {
    // Fora desta lista, "/api/audit" nao e reescrito e devolve 404, enquanto
    // "/audit" devolve o HTML do painel. Ja aconteceu com /uploads.
    expect(isApiPath('/audit')).toBe(true);
    expect(isApiPath('/api/audit')).toBe(true);
  });
});
