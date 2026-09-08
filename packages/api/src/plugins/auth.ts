import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import '@fastify/cookie';
import { Permission, can, canAny, type AuthenticatedUser, type UserRole } from '@crm/shared';
import { prisma } from '../db/prisma.js';
import { UnauthorizedError, ForbiddenError } from '../lib/errors.js';
import { verifyAccessToken } from '../modules/auth/tokens.js';
import { toAuthenticatedUser, isSessionActive } from '../modules/auth/service.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthenticatedUser;
    authorize: (...permissions: Permission[]) => void;
    can: (permission: Permission) => boolean;
  }
}

export const authPlugin: FastifyPluginAsync = fp(async (fastify) => {
  fastify.decorateRequest('user', null as unknown as AuthenticatedUser);

  fastify.decorateRequest('authorize', function (this: FastifyRequest, ...permissions: Permission[]) {
    if (!this.user) {
      throw new UnauthorizedError('Nao autenticado');
    }
    if (permissions.length === 0) return;
    const allowed = canAny(this.user.role as UserRole, permissions);
    if (!allowed) {
      throw new ForbiddenError('Permissao insuficiente para realizar esta acao');
    }
  });

  fastify.decorateRequest('can', function (this: FastifyRequest, permission: Permission): boolean {
    if (!this.user) return false;
    return can(this.user.role as UserRole, permission);
  });

  fastify.addHook('preHandler', async (request, reply) => {
    // Rotas públicas que não exigem autenticação
    const url = request.url;
    if (
      url.startsWith('/auth/login') ||
      url.startsWith('/auth/refresh') ||
      url.startsWith('/webhooks') ||
      url.startsWith('/health') ||
      (url.startsWith('/media') && request.method === 'GET')
    ) {
      return;
    }

    const authHeader = request.headers.authorization;
    let token: string | undefined;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7).trim();
    } else if (request.cookies?.access_token) {
      token = request.cookies.access_token;
    }

    if (!token) {
      throw new UnauthorizedError('Token de acesso nao informado');
    }

    const claims = await verifyAccessToken(token);

    // Confere se a sessão não foi revogada
    const sessionValid = await isSessionActive(claims.sid);
    if (!sessionValid) {
      throw new UnauthorizedError('Sessao encerrada ou revogada', 'SESSION_REVOKED');
    }

    const user = await prisma.user.findUnique({
      where: { id: claims.sub, deletedAt: null },
      include: {
        organization: { select: { id: true, name: true } },
        departments: {
          include: { department: { select: { id: true, name: true, color: true } } },
        },
      },
    });

    if (!user || !user.isActive) {
      throw new ForbiddenError('Usuario inativo ou inexistente');
    }

    request.user = toAuthenticatedUser(user);
  });
});
