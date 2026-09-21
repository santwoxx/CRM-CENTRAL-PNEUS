import {
  Room,
  type ClientToServerEvents,
  type ServerToClientEvents,
  type SocketData,
} from '@crm/shared';
import type { Socket } from 'socket.io';
import { prisma } from '../db/prisma.js';
import { logger } from '../lib/logger.js';
import {
  canAccessConversation,
  conversationAccessSelect,
  type ConversationAccessRecord,
} from '../modules/conversations/access.js';
import type { RealtimeEnvelope } from './bus.js';
import { baseRealtimeRooms } from './rooms.js';

export type CrmSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

type IdentityLoader = (claimed: SocketData) => Promise<SocketData | null>;
type ConversationLoader = (conversationId: string) => Promise<ConversationAccessRecord | null>;

export interface RealtimeAuthorizationDependencies {
  loadIdentity?: IdentityLoader;
  loadConversation?: ConversationLoader;
}

export interface RealtimeSessionRecord {
  userId: string;
  revokedAt: Date | null;
  expiresAt: Date;
  user: {
    id: string;
    orgId: string;
    role: string;
    isActive: boolean;
    deletedAt: Date | null;
    departments: Array<{ departmentId: string }>;
  };
}

/** Funcao pura que transforma uma sessao atual em identidade autorizada. */
export function validateRealtimeIdentity(
  claimed: SocketData,
  session: RealtimeSessionRecord | null,
  now: Date = new Date(),
): SocketData | null {
  if (
    !session ||
    session.userId !== claimed.userId ||
    session.user.id !== claimed.userId ||
    session.user.orgId !== claimed.orgId ||
    session.revokedAt ||
    session.expiresAt <= now ||
    !session.user.isActive ||
    session.user.deletedAt
  ) {
    return null;
  }

  return {
    userId: session.user.id,
    orgId: session.user.orgId,
    sessionId: claimed.sessionId,
    role: session.user.role,
    departmentIds: session.user.departments.map((item) => item.departmentId),
  };
}

/**
 * Recarrega a identidade a partir da sessao, sem confiar nos dados gravados
 * no handshake. Retornar `null` e deliberadamente fail-closed.
 */
export async function loadCurrentSocketIdentity(claimed: SocketData): Promise<SocketData | null> {
  const session = await prisma.session.findUnique({
    where: { id: claimed.sessionId },
    select: {
      userId: true,
      revokedAt: true,
      expiresAt: true,
      user: {
        select: {
          id: true,
          orgId: true,
          role: true,
          isActive: true,
          deletedAt: true,
          departments: { select: { departmentId: true } },
        },
      },
    },
  });

  return validateRealtimeIdentity(claimed, session);
}

async function loadConversation(conversationId: string): Promise<ConversationAccessRecord | null> {
  return prisma.conversation.findUnique({
    where: { id: conversationId },
    select: conversationAccessSelect,
  });
}

/**
 * Confere se a conexao continua valida e sincroniza salas que dependem de
 * cargo/setor. Revogacao, desativacao e exclusao derrubam o socket antes de
 * qualquer novo evento ser entregue.
 */
export async function refreshSocketAuthorization(
  socket: CrmSocket,
  identityLoader: IdentityLoader = loadCurrentSocketIdentity,
): Promise<SocketData | null> {
  let current: SocketData | null;

  try {
    current = await identityLoader(socket.data);
  } catch (error) {
    logger.error(
      { err: error, socketId: socket.id, userId: socket.data.userId },
      'Falha ao revalidar autorizacao do socket',
    );
    socket.disconnect(true);
    return null;
  }

  if (!current) {
    logger.info(
      { socketId: socket.id, userId: socket.data.userId },
      'Socket desconectado: sessao ou usuario deixou de ser valido',
    );
    socket.disconnect(true);
    return null;
  }

  const previousRooms = baseRealtimeRooms(socket.data);
  const currentRooms = baseRealtimeRooms(current);

  try {
    await Promise.all([
      ...[...previousRooms]
        .filter((room) => !currentRooms.has(room))
        .map((room) => socket.leave(room)),
      ...[...currentRooms]
        .filter((room) => !previousRooms.has(room))
        .map((room) => socket.join(room)),
    ]);
  } catch (error) {
    logger.error(
      { err: error, socketId: socket.id, userId: socket.data.userId },
      'Falha ao atualizar salas autorizadas do socket',
    );
    socket.disconnect(true);
    return null;
  }

  socket.data = current;
  return current;
}

const FULL_CONVERSATION_EVENTS = new Set<keyof ServerToClientEvents>([
  'conversation:created',
  'conversation:updated',
  'conversation:assigned',
]);

/** Retorna a conversa cuja permissao precisa ser conferida antes da entrega. */
export function conversationIdFromEnvelope(envelope: RealtimeEnvelope): string | null {
  const payload = envelope.payload as Record<string, unknown>;

  switch (envelope.event) {
    case 'conversation:created':
    case 'conversation:updated':
      return typeof payload.id === 'string' ? payload.id : null;
    case 'conversation:assigned': {
      const conversation = payload.conversation as Record<string, unknown> | undefined;
      return typeof conversation?.id === 'string' ? conversation.id : null;
    }
    case 'conversation:status':
    case 'conversation:removed':
    case 'message:new':
    case 'message:status':
    case 'typing:start':
    case 'typing:stop':
      return typeof payload.conversationId === 'string' ? payload.conversationId : null;
    default:
      return null;
  }
}

function requiresConversationAuthorization(event: keyof ServerToClientEvents): boolean {
  return (
    event === 'conversation:created' ||
    event === 'conversation:updated' ||
    event === 'conversation:assigned' ||
    event === 'conversation:status' ||
    event === 'message:new' ||
    event === 'message:status' ||
    event === 'typing:start' ||
    event === 'typing:stop'
  );
}

/**
 * Entrega um envelope no maximo uma vez por socket e somente depois de
 * revalidar sua sessao e a conversa. O emissor antigo iterava sala por sala,
 * o que duplicava eventos para usuarios presentes em mais de uma delas.
 */
export async function dispatchRealtimeEnvelope(
  sockets: Iterable<CrmSocket>,
  envelope: RealtimeEnvelope,
  dependencies: RealtimeAuthorizationDependencies = {},
): Promise<void> {
  const identityLoader = dependencies.loadIdentity ?? loadCurrentSocketIdentity;
  const conversationLoader = dependencies.loadConversation ?? loadConversation;
  const candidates = [...sockets].filter(
    (socket) =>
      socket.id !== envelope.originSocketId &&
      envelope.rooms.some((room) => socket.rooms.has(room)),
  );

  if (candidates.length === 0) return;

  const conversationId = conversationIdFromEnvelope(envelope);
  let conversation: ConversationAccessRecord | null = null;

  if (requiresConversationAuthorization(envelope.event)) {
    // Payload de conversa sem ID e invalido; falhamos fechados.
    if (!conversationId) return;
    conversation = await conversationLoader(conversationId);
    // Eventos atrasados de uma conversa ja excluida nao devem reaparecer.
    if (!conversation) return;
  }

  await Promise.all(
    candidates.map(async (socket) => {
      const identity = await refreshSocketAuthorization(socket, identityLoader);
      if (!identity) return;

      // A revalidacao pode ter removido o socket de uma sala antiga.
      if (!envelope.rooms.some((room) => socket.rooms.has(room))) return;

      if (
        conversation &&
        !canAccessConversation(
          {
            id: identity.userId,
            orgId: identity.orgId,
            role: identity.role,
            departmentIds: identity.departmentIds,
          },
          conversation,
          'view',
        )
      ) {
        if (conversationId) await socket.leave(Room.conversation(conversationId));

        // O antigo responsavel precisa retirar a conversa da tela, mas nao
        // recebe o resumo completo depois de perder o acesso.
        if (
          conversationId &&
          FULL_CONVERSATION_EVENTS.has(envelope.event) &&
          envelope.rooms.includes(Room.user(identity.userId))
        ) {
          socket.emit('conversation:removed', {
            conversationId,
            reason: 'acesso-removido',
          });
        }
        return;
      }

      const emit = socket.emit as unknown as (event: string, payload: unknown) => void;
      emit(envelope.event, envelope.payload);
    }),
  );
}
