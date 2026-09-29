import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserRole } from '@crm/shared';

/**
 * O painel de supervisao devolve conversas com nome, telefone e ultima
 * mensagem do cliente. A rota aceita QUALQUER uma das permissoes pedidas,
 * entao o supervisor entra - e antes disto recebia a organizacao inteira,
 * inclusive setores que a tela de atendimento escondia dele.
 *
 * Aqui conferimos o filtro que vai ao banco, que e onde a regra vale.
 */

const findMany = vi.fn();

vi.mock('../db/prisma.js', () => ({
  prisma: { conversation: { findMany: (...args: unknown[]) => findMany(...args) } },
}));
// Isolam o teste do serializador e da presenca, que puxam configuracao e Redis.
vi.mock('../modules/conversations/serializer.js', () => ({
  conversationInclude: {},
  toConversationSummary: (conversa: unknown) => conversa,
}));
vi.mock('../modules/routing/presence.js', () => ({ getActiveChatCounts: vi.fn() }));

const { getLiveConversations } = await import('../modules/dashboard/service.js');

function sujeito(role: UserRole) {
  return { id: 'usuario-1', orgId: 'org-1', role, departmentIds: ['setor-oficina'] };
}

function filtro() {
  return findMany.mock.calls[0]?.[0]?.where as Record<string, unknown>;
}

beforeEach(() => {
  findMany.mockReset();
  findMany.mockResolvedValue([]);
});

describe('conversas ao vivo no painel', () => {
  it('administrador ve a organizacao inteira', async () => {
    await getLiveConversations(sujeito(UserRole.ADMIN));

    const where = filtro();
    expect(where.orgId).toBe('org-1');
    expect(where.departmentId).toBeUndefined();
    expect(where.OR).toBeUndefined();
  });

  it('dono tambem ve tudo', async () => {
    await getLiveConversations(sujeito(UserRole.OWNER));

    expect(filtro().departmentId).toBeUndefined();
  });

  it('supervisor ve apenas os setores dele', async () => {
    await getLiveConversations(sujeito(UserRole.SUPERVISOR));

    expect(filtro().departmentId).toEqual({ in: ['setor-oficina'] });
  });

  it('atendente ve as proprias conversas e a fila sem dono do setor dele', async () => {
    await getLiveConversations(sujeito(UserRole.AGENT));

    expect(filtro().OR).toEqual([
      { assignedUserId: 'usuario-1' },
      { assignedUserId: null, departmentId: { in: ['setor-oficina'] } },
    ]);
  });

  it('a organizacao entra no filtro em todos os cargos', async () => {
    // Isolamento entre empresas nao pode depender do cargo.
    for (const role of [UserRole.OWNER, UserRole.ADMIN, UserRole.SUPERVISOR, UserRole.AGENT]) {
      findMany.mockReset();
      findMany.mockResolvedValue([]);
      await getLiveConversations(sujeito(role));
      expect(filtro().orgId, role).toBe('org-1');
    }
  });
});
