import fp from 'fastify-plugin';
import { isApiPath } from '../lib/routes.js';
import { validarUrlMidia } from '../modules/media/seguranca.js';
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
      // Login social: o proprio token do Google e a credencial.
      url.startsWith('/auth/google') ||
      // Diz a tela de login quais formas de entrar existem. Nao expoe nada
      // sensivel - apenas dois booleanos.
      url.startsWith('/auth/providers') ||
      url.startsWith('/webhooks') ||
      url.startsWith('/health') ||
      // Navegacao do painel: qualquer GET que nao seja rota de API e uma
      // pagina do React (ou um arquivo estatico) e precisa chegar ao
      // navegador sem token - a tela de login e uma delas.
      (request.method === 'GET' && !isApiPath(url)) ||
      // /media aceita URL assinada em vez de sessao, porque <img> e <audio>
      // nao enviam cabecalho. A assinatura e conferida aqui; sem ela, a rota
      // segue exigindo login como qualquer outro dado do cliente.
      midiaAssinadaValida(request)
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


/**
 * Confere a assinatura de uma URL de midia.
 *
 * Guarda a organizacao na requisicao para a rota nao precisar confiar em
 * nenhum parametro vindo do cliente.
 */
function midiaAssinadaValida(request: FastifyRequest): boolean {
  const url = request.raw.url ?? '';
  if (request.method !== 'GET' || !url.startsWith('/media/')) return false;

  const params = request.query as { exp?: string; sig?: string; org?: string };
  const mediaId = url.split('?')[0]?.split('/')[2] ?? '';
  if (!mediaId || !params.org) return false;

  if (!validarUrlMidia(mediaId, params.org, params.exp, params.sig)) return false;

  request.mediaOrgId = params.org;
  return true;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Organizacao provada por URL assinada, quando nao ha sessao. */
    mediaOrgId?: string;
  }
}
