import type { FastifyPluginAsync } from 'fastify';
import { changePasswordSchema, loginSchema, refreshSchema } from '@crm/shared';
import { changePassword, login, loginWithGoogle, logout, refresh } from './service.js';
import { isGoogleAuthConfigured } from './firebase.js';
import { isProduction } from '../../env.js';

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
    const input = loginSchema.parse(req.body);
    const result = await login(input.email, input.password, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    reply.setCookie('refresh_token', result.refreshToken, {
      path: '/auth/refresh',
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60, // 30 dias
    });

    return reply.send({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn,
      user: result.user,
    });
  });

  // Login com a conta Google (Firebase Authentication)
  app.post('/google', limiteCredencial, async (req, reply) => {
    const body = req.body as { idToken?: unknown } | null;
    const idToken = typeof body?.idToken === 'string' ? body.idToken.trim() : '';

    if (!idToken) {
      return reply
        .code(400)
        .send({ error: { code: 'MISSING_ID_TOKEN', message: 'Token do Google ausente' } });
    }

    const result = await loginWithGoogle(idToken, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    reply.setCookie('refresh_token', result.refreshToken, {
      path: '/auth/refresh',
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60,
    });

    return reply.send({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn,
      user: result.user,
    });
  });

  // Diz ao frontend se deve exibir o botao do Google.
  app.get('/providers', async () => ({
    password: true,
    google: isGoogleAuthConfigured(),
  }));

  // Renovação de token de acesso
  app.post('/refresh', limiteCredencial, async (req, reply) => {
    let rawToken: string | undefined;

    if (req.body && typeof req.body === 'object' && 'refreshToken' in req.body) {
      const parsed = refreshSchema.safeParse(req.body);
      if (parsed.success) rawToken = parsed.data.refreshToken;
    }

    if (!rawToken && req.cookies?.refresh_token) {
      rawToken = req.cookies.refresh_token;
    }

    if (!rawToken) {
      return reply.code(401).send({ error: { code: 'NO_REFRESH_TOKEN', message: 'Refresh token ausente' } });
    }

    const result = await refresh(rawToken, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    reply.setCookie('refresh_token', result.refreshToken, {
      path: '/auth/refresh',
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60,
    });

    return reply.send({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn,
      user: result.user,
    });
  });

  // Logout e revogação da sessão
  app.post('/logout', async (req, reply) => {
    const rawToken = req.cookies?.refresh_token;
    if (rawToken) {
      await logout(rawToken);
    }

    reply.clearCookie('refresh_token', { path: '/auth/refresh' });
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
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return reply.send({ ok: true, message: 'Senha alterada com sucesso' });
  });
};
