import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import {
  AgentPresence,
  Room,
  type ClientToServerEvents,
  type ServerToClientEvents,
  type SocketData,
} from '@crm/shared';
import { env, isProduction } from '../env.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../db/prisma.js';
import { verifyAccessToken } from '../modules/auth/tokens.js';
import { isSessionActive } from '../modules/auth/service.js';
import { canAccessConversation } from '../modules/conversations/access.js';
import {
  registerConnection,
  unregisterConnection,
  setPresence,
  touch,
  getPresenceSnapshot,
} from '../modules/routing/presence.js';
import { publishRealtime, subscribeRealtime, type RealtimeEnvelope } from './bus.js';
import {
  dispatchRealtimeEnvelope,
  refreshSocketAuthorization,
} from './authorization.js';
import { baseRealtimeRooms } from './rooms.js';

const SOCKET_AUTH_REVALIDATION_MS = 15_000;

/** Politica de origem usada tambem pelo teste de regressao do gateway. */
export function isSocketOriginAllowed(
  origin: string | undefined,
  host: string | undefined,
  configuredOrigins: string[],
  production: boolean,
): boolean {
  if (!origin) return true;
  if (configuredOrigins.includes(origin)) return true;
  if (!production) return true;
  if (!host) return false;

  try {
    const requestHost = host.split(',')[0]?.trim().toLowerCase();
    return new URL(origin).host.toLowerCase() === requestHost;
  } catch {
    return false;
  }
}

export function setupSocketServer(httpServer: HttpServer): Server {
  const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(
    httpServer,
    {
      cors: {
        origin:
          env.CORS_ORIGINS.length > 0
            ? env.CORS_ORIGINS
            : isProduction
              ? false
              : true,
        credentials: true,
      },
      allowRequest: (request, callback) => {
        const forwardedHost = request.headers['x-forwarded-host'];
        const host =
          (typeof forwardedHost === 'string' ? forwardedHost : forwardedHost?.[0]) ??
          request.headers.host;
        callback(
          null,
          isSocketOriginAllowed(
            request.headers.origin,
            host,
            env.CORS_ORIGINS,
            isProduction,
          ),
        );
      },
      pingInterval: 25_000,
      pingTimeout: 20_000,
    },
  );

  // Middleware de autenticação no handshake do Socket
  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, '');

      if (!token) {
        return next(new Error('Autenticacao necessaria: token ausente'));
      }

      const claims = await verifyAccessToken(token);
      const sessionValid = await isSessionActive(claims.sid);
      if (!sessionValid) {
        return next(new Error('Sessao expirada ou revogada'));
      }

      const user = await prisma.user.findUnique({
        where: { id: claims.sub, deletedAt: null },
        include: {
          departments: { select: { departmentId: true } },
        },
      });

      if (!user || !user.isActive) {
        return next(new Error('Usuario inexistente ou desativado'));
      }

      socket.data = {
        userId: user.id,
        orgId: user.orgId,
        sessionId: claims.sid,
        role: user.role,
        departmentIds: user.departments.map((d) => d.departmentId),
      };

      next();
    } catch (error) {
      logger.warn({ err: error }, 'Falha na autenticacao de handshake do socket');
      next(new Error('Token invalido'));
    }
  });

  io.on('connection', async (socket) => {
    const { userId, orgId } = socket.data;
    logger.debug({ userId, socketId: socket.id }, 'Novo socket conectado');

    // 1. Aloca salas base
    await socket.join([...baseRealtimeRooms(socket.data)]);

    // 2. Registra presença
    await registerConnection(userId, socket.id);

    // Envia snapshot de presença dos atendentes na conexão
    const snapshot = await getPresenceSnapshot(orgId);
    socket.emit('presence:snapshot', snapshot);

    // IDs autorizados neste socket. Isso impede que um cliente envie eventos
    // de digitacao para uma sala que ele nunca teve permissao de abrir.
    const subscribedConversationIds = new Set<string>();

    async function authorizeConversation(conversationId: string): Promise<SocketData | null> {
      const identity = await refreshSocketAuthorization(socket);
      if (!identity) return null;

      const conversation = await prisma.conversation.findFirst({
        where: { id: conversationId, orgId: identity.orgId },
        select: { id: true, orgId: true, departmentId: true, assignedUserId: true },
      });

      if (
        !conversation ||
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
        await socket.leave(Room.conversation(conversationId));
        subscribedConversationIds.delete(conversationId);
        return null;
      }

      return identity;
    }

    // 3. Eventos do cliente
    socket.on('conversation:subscribe', async (conversationId, ack) => {
      if (!(await authorizeConversation(conversationId))) {
        ack?.({ ok: false, error: 'Sem acesso a esta conversa' });
        return;
      }

      await socket.join(Room.conversation(conversationId));
      subscribedConversationIds.add(conversationId);
      ack?.({ ok: true });
    });

    socket.on('conversation:unsubscribe', async (conversationId) => {
      await socket.leave(Room.conversation(conversationId));
      subscribedConversationIds.delete(conversationId);
    });

    socket.on('typing:start', async (conversationId) => {
      if (!subscribedConversationIds.has(conversationId)) return;
      const identity = await authorizeConversation(conversationId);
      if (!identity) return;

      await publishRealtime(
        Room.conversation(conversationId),
        'typing:start',
        {
          conversationId,
          userId: identity.userId,
          userName: 'Atendente',
        },
        { originSocketId: socket.id },
      );
    });

    socket.on('typing:stop', async (conversationId) => {
      if (!subscribedConversationIds.has(conversationId)) return;
      const identity = await authorizeConversation(conversationId);
      if (!identity) return;

      await publishRealtime(
        Room.conversation(conversationId),
        'typing:stop',
        {
          conversationId,
          userId: identity.userId,
        },
        { originSocketId: socket.id },
      );
    });

    socket.on('presence:set', async (presence: AgentPresence, ack) => {
      const identity = await refreshSocketAuthorization(socket);
      if (!identity) return;
      await setPresence(identity.userId, presence);
      ack?.({ ok: true });
    });

    socket.on('presence:heartbeat', async () => {
      const identity = await refreshSocketAuthorization(socket);
      if (!identity) return;
      await touch(identity.userId);
    });

    socket.on('disconnect', async () => {
      logger.debug({ userId, socketId: socket.id }, 'Socket desconectado');
      await unregisterConnection(userId, socket.id);
    });
  });

  // Mesmo sem trafego, uma sessao revogada ou usuario desativado nao fica
  // conectado indefinidamente. Toda entrega tambem faz esta checagem, portanto
  // o intervalo nao cria uma janela em que dados possam escapar.
  const authorizationTimer = setInterval(() => {
    void Promise.all(
      [...io.sockets.sockets.values()].map((socket) => refreshSocketAuthorization(socket)),
    );
  }, SOCKET_AUTH_REVALIDATION_MS);
  authorizationTimer.unref();
  httpServer.once('close', () => clearInterval(authorizationTimer));

  // Assina barramento Redis para despachar eventos emitidos por workers para os sockets locais
  let dispatchChain = Promise.resolve();
  subscribeRealtime((envelope: RealtimeEnvelope) => {
    // Serializar preserva a ordem do Redis mesmo com as consultas de
    // autorizacao assincronas feitas antes de cada envio.
    dispatchChain = dispatchChain
      .then(() => dispatchRealtimeEnvelope(io.sockets.sockets.values(), envelope))
      .catch((error) => {
        logger.error({ err: error, event: envelope.event }, 'Falha ao despachar evento em tempo real');
      });
  }).catch((error) => {
    logger.error({ err: error }, 'Erro ao iniciar assinante do barramento de tempo real');
  });

  return io;
}
