import { describe, expect, it } from 'vitest';
import {
  clearRefreshCookieOptions,
  corsOriginOption,
  isTrustedRequestOrigin,
  refreshCookieOptions,
} from '../config/http.js';
import { isConcurrentRotation } from '../modules/auth/service.js';

describe('politica HTTP da sessao', () => {
  it('restringe CORS em producao quando nao ha frontend separado', () => {
    expect(corsOriginOption([], true)).toBe(false);
    expect(corsOriginOption([], false)).toBe(true);
    expect(corsOriginOption(['https://painel.example'], true)).toEqual([
      'https://painel.example',
    ]);
  });

  it('usa cookie de raiz e habilita o envio cross-site somente com HTTPS', () => {
    expect(refreshCookieOptions(true, 30_000)).toMatchObject({
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: 30,
    });
    expect(refreshCookieOptions(false, 30_000)).toMatchObject({
      secure: false,
      sameSite: 'lax',
    });
    expect(clearRefreshCookieOptions(true)).not.toHaveProperty('maxAge');
  });

  it('aceita apenas a propria API, origens CORS declaradas ou clientes sem Origin', () => {
    const api = 'https://api.example/path';
    const allowed = ['https://painel.example/'];

    expect(isTrustedRequestOrigin(undefined, api, allowed)).toBe(true);
    expect(isTrustedRequestOrigin('https://api.example', api, allowed)).toBe(true);
    expect(isTrustedRequestOrigin('https://painel.example', api, allowed)).toBe(true);
    expect(isTrustedRequestOrigin('https://evil.example', api, allowed)).toBe(false);
    expect(isTrustedRequestOrigin('null', api, allowed)).toBe(false);
  });
});

describe('janela de corrida da rotacao', () => {
  const fingerprint = { ipAddress: '203.0.113.8', userAgent: 'Browser CRM' };
  const now = new Date('2026-09-11T12:00:00.000Z').getTime();

  it('reconhece duas abas do mesmo cliente dentro da janela curta', () => {
    expect(
      isConcurrentRotation(
        { ...fingerprint, revokedAt: new Date(now - 2_000) },
        fingerprint,
        now,
      ),
    ).toBe(true);
  });

  it('nao encobre replay tardio nem cliente com fingerprint diferente', () => {
    expect(
      isConcurrentRotation(
        { ...fingerprint, revokedAt: new Date(now - 10_001) },
        fingerprint,
        now,
      ),
    ).toBe(false);
    expect(
      isConcurrentRotation(
        { ...fingerprint, revokedAt: new Date(now - 1_000) },
        { ...fingerprint, userAgent: 'Outro navegador' },
        now,
      ),
    ).toBe(false);
  });
});
