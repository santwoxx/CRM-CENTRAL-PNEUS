import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import {
  AgentPresence,
  Room,
  UserRole,
  type ClientToServerEvents,
  type ServerToClientEvents,
  type SocketData,
} from '@crm/shared';
import { env } from '../env.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../db/prisma.js';
import { verifyAccessToken } from '../modules/auth/tokens.js';
import { isSessionActive } from '../modules/auth/service.js';
import {
  registerConnection,
  unregisterConnection,
  setPresence,
  touch,
  getPresenceSnapshot,
} from '../modules/routing/presence.js';
import { subscribeRealtime, type RealtimeEnvelope } from './bus.js';

export function setupSocketServer(httpServer: HttpServer): Server {
  const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(
    httpServer,
    {
      cors: {
        origin: env.CORS_ORIGINS.length > 0 ? env.CORS_ORIGINS : '*',
        credentials: true,
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
    const { userId, orgId, role, departmentIds } = socket.data;
    logger.debug({ userId, socketId: socket.id }, 'Novo socket conectado');

    // 1. Aloca salas base
    await socket.join(Room.user(userId));
    await socket.join(Room.presence(orgId));

    for (const deptId of departmentIds) {
      await socket.join(Room.department(deptId));
    }

    // Administradores e Supervisores recebem a sala global da organização
    if (role === UserRole.ADMIN || role === UserRole.OWNER || role === UserRole.SUPERVISOR) {
      await socket.join(Room.orgAdmin(orgId));
    }

    // 2. Registra presença
    await registerConnection(userId, socket.id);

    // Envia snapshot de presença dos atendentes na conexão
    const snapshot = await getPresenceSnapshot(orgId);
    socket.emit('presence:snapshot', snapshot);

    // 3. Eventos do cliente
    socket.on('conversation:subscribe', async (conversationId, ack) => {
      await socket.join(Room.conversation(conversationId));
      ack?.({ ok: true });
    });

    socket.on('conversation:unsubscribe', async (conversationId) => {
      await socket.leave(Room.conversation(conversationId));
    });

    socket.on('typing:start', (conversationId) => {
      socket.to(Room.conversation(conversationId)).emit('typing:start', {
        conversationId,
        userId,
        userName: 'Atendente',
      });
    });

    socket.on('typing:stop', (conversationId) => {
      socket.to(Room.conversation(conversationId)).emit('typing:stop', {
        conversationId,
        userId,
      });
    });

    socket.on('presence:set', async (presence: AgentPresence, ack) => {
      await setPresence(userId, presence);
      ack?.({ ok: true });
    });

    socket.on('presence:heartbeat', async () => {
      await touch(userId);
    });

    socket.on('disconnect', async () => {
      logger.debug({ userId, socketId: socket.id }, 'Socket desconectado');
      await unregisterConnection(userId, socket.id);
    });
  });

  // Assina barramento Redis para despachar eventos emitidos por workers para os sockets locais
  subscribeRealtime((envelope: RealtimeEnvelope) => {
    for (const room of envelope.rooms) {
      const emitter = io.to(room);
      (emitter.emit as unknown as (event: string, payload: unknown) => void)(
        envelope.event,
        envelope.payload,
      );
    }
  }).catch((error) => {
    logger.error({ err: error }, 'Erro ao iniciar assinante do barramento de tempo real');
  });

  return io;
}
