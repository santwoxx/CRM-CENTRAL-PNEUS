import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { changePasswordSchema, loginSchema, refreshSchema } from '@crm/shared';
import { changePassword, login, loginWithGoogle, logout, refresh } from './service.js';
import { isGoogleAuthConfigured } from './firebase.js';
import { env, isProduction } from '../../env.js';
import { ForbiddenError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { ipCliente } from '../../lib/clientIp.js';
import { REFRESH_TTL_MS } from './tokens.js';
import {
  clearRefreshCookieOptions,
  isTrustedRequestOrigin,
  refreshCookieOptions,
} from '../../config/http.js';

const REFRESH_COOKIE = 'refresh_token';
const COOKIE_TRANSPORT_HEADER = 'x-refresh-token-transport';

export const authRoutes: FastifyPluginAsync = async (app) => {
  /**
   * Limite proprio para as rotas de credencial.
   *
   * O limite global protege a API como um todo, mas e generoso demais para
   * senha: com 300 por minuto da para varrer uma lista de e-mails testando
   * uma senha comum em cada (password spraying). O bloqueio por conta que ja
   * existe nao pega esse ataque, porque ele erra pouco em cada conta.
   *
   * 10 por minuto por origem torna a varredura inviavel e nao atrapalha
   * ninguem: pessoa nenhuma erra a senha dez vezes em um minuto.
   */
  const limiteCredencial = {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute',
      },
    },
  };

  // Login com e-mail e senha
  app.post('/login', limiteCredencial, async (req, reply) => {
    assertTrustedOrigin(req);
    const input = loginSchema.parse(req.body);
    const result = await login(input.email, input.password, {
      ipAddress: ipCliente(req),
      userAgent: req.headers['user-agent'],
    });

    return sendAuthResult(req, reply, result);
  });

  // Login com a conta Google (Firebase Authentication)
  app.post('/google', limiteCredencial, async (req, reply) => {
    assertTrustedOrigin(req);
    const body = req.body as { idToken?: unknown } | null;
    const idToken = typeof body?.idToken === 'string' ? body.idToken.trim() : '';

    if (!idToken) {
      return reply
        .code(400)
        .send({ error: { code: 'MISSING_ID_TOKEN', message: 'Token do Google ausente' } });
    }

    const result = await loginWithGoogle(idToken, {
      ipAddress: ipCliente(req),
      userAgent: req.headers['user-agent'],
    });

    return sendAuthResult(req, reply, result);
  });

  // Diz ao frontend se deve exibir o botao do Google.
  app.get('/providers', async () => ({
    password: true,
    google: isGoogleAuthConfigured(),
  }));

  // Renovação de token de acesso
  app.post('/refresh', limiteCredencial, async (req, reply) => {
    assertTrustedOrigin(req);
    const rawToken = readRefreshToken(req);

    if (!rawToken) {
      return reply.code(401).send({ error: { code: 'NO_REFRESH_TOKEN', message: 'Refresh token ausente' } });
    }

    const result = await refresh(rawToken, {
      ipAddress: ipCliente(req),
      userAgent: req.headers['user-agent'],
    });

    return sendAuthResult(req, reply, result);
  });

  // Logout e revogação da sessão
  app.post('/logout', async (req, reply) => {
    assertTrustedOrigin(req);
    const rawToken = readRefreshToken(req);
    if (rawToken) {
      await logout(rawToken);
    }

    reply.clearCookie(REFRESH_COOKIE, clearRefreshCookieOptions(isProduction));
    return reply.send({ ok: true });
  });

  // Perfil autenticado
  app.get('/me', async (req, reply) => {
    return reply.send(req.user);
  });

  // Alteração da própria senha
  app.post('/change-password', async (req, reply) => {
    const input = changePasswordSchema.parse(req.body);
    await changePassword(req.user.id, input.currentPassword, input.newPassword, {
      ipAddress: ipCliente(req),
      userAgent: req.headers['user-agent'],
    });

    return reply.send({ ok: true, message: 'Senha alterada com sucesso' });
  });
};

function readRefreshToken(request: FastifyRequest): string | undefined {
  if (request.body && typeof request.body === 'object' && 'refreshToken' in request.body) {
    const parsed = refreshSchema.safeParse(request.body);
    if (parsed.success) return parsed.data.refreshToken;
  }

  return request.cookies?.[REFRESH_COOKIE];
}

function assertTrustedOrigin(request: FastifyRequest): void {
  if (isTrustedRequestOrigin(request.headers.origin, env.PUBLIC_API_URL, env.CORS_ORIGINS)) {
    return;
  }

  // A resposta para o navegador fica generica de proposito: dizer ao
  // atacante qual origem seria aceita entrega metade do trabalho. Mas sem
  // registrar isto no servidor, o sintoma e um 403 mudo no login e nada em
  // lugar nenhum explica o motivo - foi exatamente assim que um
  // PUBLIC_API_URL desatualizado derrubou o acesso ao painel inteiro.
  logger.warn(
    {
      origemRecebida: request.headers.origin,
      origensAceitas: [env.PUBLIC_API_URL, ...env.CORS_ORIGINS],
      rota: request.url,
    },
    'Origem recusada na rota de sessao: confira PUBLIC_API_URL e CORS_ORIGINS',
  );

  throw new ForbiddenError('Origem nao permitida para alterar a sessao', 'UNTRUSTED_ORIGIN');
}

function sendAuthResult(
  request: FastifyRequest,
  reply: FastifyReply,
  result: Awaited<ReturnType<typeof login>>,
) {
  if (result.refreshToken) {
    reply.setCookie(
      REFRESH_COOKIE,
      result.refreshToken,
      refreshCookieOptions(isProduction, REFRESH_TTL_MS),
    );
  }

  // O painel usa apenas o cookie HttpOnly, portanto o segredo nao precisa
  // ficar visivel ao JavaScript. O formato antigo permanece para clientes de
  // API que nao optaram explicitamente pelo transporte em cookie.
  if (request.headers[COOKIE_TRANSPORT_HEADER] === 'cookie') {
    const { refreshToken: _refreshToken, ...safeResult } = result;
    return reply.send(safeResult);
  }

  return reply.send(result);
}
