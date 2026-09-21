import fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../env.js';
import { errorsPlugin } from '../plugins/errors.js';

const authMocks = vi.hoisted(() => ({
  login: vi.fn(),
  loginWithGoogle: vi.fn(),
  logout: vi.fn(),
  refresh: vi.fn(),
  changePassword: vi.fn(),
}));

vi.mock('../modules/auth/service.js', () => authMocks);
vi.mock('../modules/auth/firebase.js', () => ({ isGoogleAuthConfigured: () => false }));

import { authRoutes } from '../modules/auth/routes.js';

const authResult = {
  accessToken: 'access-token',
  refreshToken: 'refresh-secret',
  expiresIn: 900,
  user: { id: 'user-1', name: 'Ana' },
};

let app: FastifyInstance;

beforeEach(async () => {
  vi.clearAllMocks();
  authMocks.login.mockResolvedValue(authResult);
  authMocks.refresh.mockResolvedValue(authResult);
  authMocks.logout.mockResolvedValue(undefined);

  app = fastify();
  await app.register(cookie);
  await app.register(errorsPlugin);
  await app.register(authRoutes, { prefix: '/auth' });
});

afterEach(async () => {
  await app.close();
});

describe('cookies das rotas de autenticacao', () => {
  it('mantem o refresh token fora do JSON do painel e grava cookie valido para refresh e logout', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: {
        origin: new URL(env.PUBLIC_API_URL).origin,
        'x-refresh-token-transport': 'cookie',
      },
      payload: { email: 'ana@example.com', password: 'Senha12345' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).not.toHaveProperty('refreshToken');
    expect(response.headers['set-cookie']).toContain('refresh_token=refresh-secret');
    expect(response.headers['set-cookie']).toContain('Path=/');
    expect(response.headers['set-cookie']).toContain('HttpOnly');
  });

  it('preserva o formato antigo para clientes de API sem negociacao por cookie', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'ana@example.com', password: 'Senha12345' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().refreshToken).toBe('refresh-secret');
  });

  it('revoga pelo cookie no logout e remove o mesmo cookie no caminho raiz', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: {
        origin: new URL(env.PUBLIC_API_URL).origin,
        cookie: 'refresh_token=refresh-secret',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(authMocks.logout).toHaveBeenCalledWith('refresh-secret');
    expect(response.headers['set-cookie']).toContain('refresh_token=;');
    expect(response.headers['set-cookie']).toContain('Path=/');
  });

  it('recusa alteracao de sessao iniciada por origem nao autorizada', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: {
        origin: 'https://evil.invalid',
        cookie: 'refresh_token=refresh-secret',
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('UNTRUSTED_ORIGIN');
    expect(authMocks.refresh).not.toHaveBeenCalled();
  });
});
