import { describe, expect, it } from 'vitest';
import { isApiPath } from '../lib/routes.js';

/**
 * `isApiPath` decide o que e publico e o que exige sessao. Uma comparacao
 * ingenua de string aqui e bypass de autorizacao, entao o caminho precisa ser
 * normalizado antes: percent-encoding, "..", barras repetidas e contrabarra
 * sao todos formas de disfarcar o mesmo destino.
 */
describe('fronteira de rotas da API', () => {
  it('reconhece as rotas normais', () => {
    for (const p of ['/auth/login', '/conversations', '/media/abc', '/uploads', '/socket.io/']) {
      expect(isApiPath(p), p).toBe(true);
    }
  });

  it('trata rotas do painel como nao-API', () => {
    for (const p of ['/', '/login', '/inbox', '/assets/index-abc.js', '/simulador']) {
      expect(isApiPath(p), p).toBe(false);
    }
  });

  it('enxerga a rota real por tras do percent-encoding', () => {
    expect(isApiPath('/assets/..%2fconversations')).toBe(true);
    expect(isApiPath('/assets/%2e%2e/auth/me')).toBe(true);
    // %61 e a letra 'a': "/%61uth/login" E "/auth/login" disfarçado. Sem
    // decodificar, escaparia da classificacao de rota de API.
    expect(isApiPath('/%61uth/login')).toBe(true);
  });

  it('resolve .. para a forma canonica', () => {
    expect(isApiPath('/assets/../conversations')).toBe(true);
    expect(isApiPath('/a/b/../../auth/login')).toBe(true);
  });

  it('nao se perde com barras repetidas nem contrabarra', () => {
    expect(isApiPath('//conversations')).toBe(true);
    expect(isApiPath('/assets\\..\\auth')).toBe(true);
  });

  it('nao quebra com codificacao invalida', () => {
    expect(() => isApiPath('/media/%zz')).not.toThrow();
  });
});
