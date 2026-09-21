import { describe, expect, it, vi } from 'vitest';
import { Room, UserRole, type SocketData } from '@crm/shared';
import {
  dispatchRealtimeEnvelope,
  validateRealtimeIdentity,
  type CrmSocket,
  type RealtimeSessionRecord,
} from '../realtime/authorization.js';
import type { RealtimeEnvelope } from '../realtime/bus.js';
import { baseRealtimeRooms, conversationRooms } from '../realtime/rooms.js';

function identity(overrides: Partial<SocketData> = {}): SocketData {
  return {
    userId: 'agent-a',
    orgId: 'org-1',
    sessionId: 'session-agent-a',
    role: UserRole.AGENT,
    departmentIds: ['sales'],
    ...overrides,
  };
}

function session(
  claimed: SocketData,
  overrides: Partial<RealtimeSessionRecord> = {},
): RealtimeSessionRecord {
  return {
    userId: claimed.userId,
    revokedAt: null,
    expiresAt: new Date('2030-01-01T00:00:00Z'),
    user: {
      id: claimed.userId,
      orgId: claimed.orgId,
      role: claimed.role,
      isActive: true,
      deletedAt: null,
      departments: claimed.departmentIds.map((departmentId) => ({ departmentId })),
    },
    ...overrides,
  };
}

function fakeSocket(data: SocketData, initialRooms: string[]) {
  const emitted: Array<{ event: string; payload: unknown }> = [];
  const rooms = new Set([`socket:${data.userId}`, ...initialRooms]);
  const disconnect = vi.fn();

  const socket = {
    id: `socket:${data.userId}`,
    data,
    rooms,
    join: vi.fn(async (roomOrRooms: string | string[]) => {
      for (const room of Array.isArray(roomOrRooms) ? roomOrRooms : [roomOrRooms]) rooms.add(room);
    }),
    leave: vi.fn(async (room: string) => {
      rooms.delete(room);
    }),
    disconnect,
    emit: vi.fn((event: string, payload: unknown) => {
      emitted.push({ event, payload });
    }),
  };

  return { socket: socket as unknown as CrmSocket, emitted, disconnect, rooms };
}

function envelope(
  event: RealtimeEnvelope['event'],
  rooms: string[],
  payload: unknown,
): RealtimeEnvelope {
  return {
    event,
    rooms,
    payload,
    emittedAt: Date.now(),
  } as RealtimeEnvelope;
}

describe('salas de conversa', () => {
  it('nao entrega conversa atribuida ao departamento inteiro', () => {
    const rooms = conversationRooms({
      orgId: 'org-1',
      conversationId: 'conv-1',
      departmentId: 'sales',
      assignedUserId: 'agent-a',
    });

    expect(rooms).toEqual([
      Room.orgAdmin('org-1'),
      Room.user('agent-a'),
      Room.departmentSupervisor('sales'),
    ]);
    expect(rooms).not.toContain(Room.department('sales'));
    expect(rooms).not.toContain(Room.conversation('conv-1'));
  });

  it('entrega a fila sem responsavel aos membros do departamento', () => {
    expect(
      conversationRooms({
        orgId: 'org-1',
        conversationId: 'conv-1',
        departmentId: 'sales',
        assignedUserId: null,
      }),
    ).toEqual([Room.orgAdmin('org-1'), Room.department('sales')]);
  });

  it('supervisor entra apenas na supervisao dos seus setores', () => {
    const rooms = baseRealtimeRooms(
      identity({ role: UserRole.SUPERVISOR, departmentIds: ['sales', 'workshop'] }),
    );

    expect(rooms).toContain(Room.departmentSupervisor('sales'));
    expect(rooms).toContain(Room.departmentSupervisor('workshop'));
    expect(rooms).not.toContain(Room.orgAdmin('org-1'));
  });
});

describe('validade da conexao em tempo real', () => {
  it('rejeita sessao revogada, expirada, usuario desativado ou excluido', () => {
    const claimed = identity();
    const now = new Date('2028-01-01T00:00:00Z');

    expect(
      validateRealtimeIdentity(claimed, session(claimed, { revokedAt: new Date() }), now),
    ).toBeNull();
    expect(
      validateRealtimeIdentity(
        claimed,
        session(claimed, { expiresAt: new Date('2027-12-31T23:59:59Z') }),
        now,
      ),
    ).toBeNull();
    expect(
      validateRealtimeIdentity(claimed, {
        ...session(claimed),
        user: { ...session(claimed).user, isActive: false },
      }, now),
    ).toBeNull();
    expect(
      validateRealtimeIdentity(claimed, {
        ...session(claimed),
        user: { ...session(claimed).user, deletedAt: new Date() },
      }, now),
    ).toBeNull();
  });

  it('atualiza cargo e setores a partir do banco', () => {
    const claimed = identity();
    const live = session(claimed);
    live.user.role = UserRole.SUPERVISOR;
    live.user.departments = [{ departmentId: 'workshop' }];

    expect(validateRealtimeIdentity(claimed, live, new Date('2028-01-01T00:00:00Z'))).toEqual({
      ...claimed,
      role: UserRole.SUPERVISOR,
      departmentIds: ['workshop'],
    });
  });
});

describe('despacho autorizado', () => {
  it('aplica canAccessConversation mesmo se uma sala ampla entrar no envelope', async () => {
    const assigned = fakeSocket(identity(), [Room.user('agent-a')]);
    const peer = fakeSocket(
      identity({ userId: 'agent-b', sessionId: 'session-agent-b' }),
      [Room.department('sales'), Room.conversation('conv-1')],
    );
    const supervisor = fakeSocket(
      identity({
        userId: 'supervisor',
        sessionId: 'session-supervisor',
        role: UserRole.SUPERVISOR,
      }),
      [Room.departmentSupervisor('sales')],
    );
    const admin = fakeSocket(
      identity({
        userId: 'admin',
        sessionId: 'session-admin',
        role: UserRole.ADMIN,
        departmentIds: [],
      }),
      [Room.orgAdmin('org-1')],
    );

    await dispatchRealtimeEnvelope(
      [assigned.socket, peer.socket, supervisor.socket, admin.socket],
      envelope(
        'message:new',
        [
          Room.user('agent-a'),
          Room.department('sales'),
          Room.departmentSupervisor('sales'),
          Room.orgAdmin('org-1'),
          Room.conversation('conv-1'),
        ],
        { id: 'message-1', conversationId: 'conv-1' },
      ),
      {
        loadIdentity: async (claimed) => claimed,
        loadConversation: async () => ({
          id: 'conv-1',
          orgId: 'org-1',
          departmentId: 'sales',
          assignedUserId: 'agent-a',
        }),
      },
    );

    expect(assigned.emitted).toHaveLength(1);
    expect(supervisor.emitted).toHaveLength(1);
    expect(admin.emitted).toHaveLength(1);
    expect(peer.emitted).toHaveLength(0);
    expect(peer.rooms).not.toContain(Room.conversation('conv-1'));
  });

  it('desconecta sessao revogada antes de emitir', async () => {
    const revoked = fakeSocket(identity(), [Room.user('agent-a')]);

    await dispatchRealtimeEnvelope(
      [revoked.socket],
      envelope('message:new', [Room.user('agent-a')], {
        id: 'message-1',
        conversationId: 'conv-1',
      }),
      {
        loadIdentity: async () => null,
        loadConversation: async () => ({
          id: 'conv-1',
          orgId: 'org-1',
          departmentId: 'sales',
          assignedUserId: 'agent-a',
        }),
      },
    );

    expect(revoked.disconnect).toHaveBeenCalledWith(true);
    expect(revoked.emitted).toHaveLength(0);
  });

  it('retira o resumo completo do antigo responsavel', async () => {
    const previous = fakeSocket(
      identity({ userId: 'agent-b', sessionId: 'session-agent-b' }),
      [Room.user('agent-b')],
    );

    await dispatchRealtimeEnvelope(
      [previous.socket],
      envelope(
        'conversation:updated',
        [Room.user('agent-a'), Room.user('agent-b')],
        { id: 'conv-1', assignedUser: { id: 'agent-a' } },
      ),
      {
        loadIdentity: async (claimed) => claimed,
        loadConversation: async () => ({
          id: 'conv-1',
          orgId: 'org-1',
          departmentId: 'sales',
          assignedUserId: 'agent-a',
        }),
      },
    );

    expect(previous.emitted).toEqual([
      {
        event: 'conversation:removed',
        payload: { conversationId: 'conv-1', reason: 'acesso-removido' },
      },
    ]);
  });

  it('emite uma vez quando o usuario pertence a varias salas do envelope', async () => {
    const admin = fakeSocket(
      identity({ role: UserRole.ADMIN }),
      [Room.user('agent-a'), Room.department('sales'), Room.orgAdmin('org-1')],
    );

    await dispatchRealtimeEnvelope(
      [admin.socket],
      envelope(
        'presence:changed',
        [Room.department('sales'), Room.orgAdmin('org-1')],
        { userId: 'someone' },
      ),
      { loadIdentity: async (claimed) => claimed },
    );

    expect(admin.emitted).toHaveLength(1);
  });
});
