import { describe, expect, it } from 'vitest';
import { assertUrlExterna } from '../lib/http.js';

/**
 * Parte das URLs que o sistema baixa vem do payload de um webhook - ou seja,
 * de fora. Sem estas barreiras, bastava mandar uma mensagem apontando para um
 * servico interno e o servidor faria a requisicao pelo atacante.
 */
describe('protecao contra SSRF', () => {
  it('aceita endereco publico em HTTPS', () => {
    expect(() => assertUrlExterna('https://lookaside.fbsbx.com/x.jpg')).not.toThrow();
  });

  it('recusa loopback e rede interna', () => {
    for (const url of [
      'https://127.0.0.1/admin',
      'https://localhost/admin',
      'https://10.0.0.5/interno',
      'https://192.168.1.1/roteador',
      'https://172.16.0.1/x',
      'https://[::1]/x',
    ]) {
      expect(() => assertUrlExterna(url), `deveria bloquear: ${url}`).toThrow();
    }
  });

  it('recusa os metadados da nuvem', () => {
    // O alvo classico de SSRF: devolve credenciais da instancia.
    expect(() => assertUrlExterna('https://169.254.169.254/latest/meta-data/')).toThrow();
  });

  it('recusa IPv4 mapeado em IPv6, que contorna a checagem ingenua', () => {
    expect(() => assertUrlExterna('https://[::ffff:127.0.0.1]/x')).toThrow();
  });

  it('recusa esquemas que nao sao HTTP', () => {
    expect(() => assertUrlExterna('file:///etc/passwd')).toThrow();
    expect(() => assertUrlExterna('gopher://evil/x')).toThrow();
  });

  it('so aceita HTTP simples quando explicitamente liberado', () => {
    expect(() => assertUrlExterna('http://exemplo.com/x')).toThrow();
    expect(() => assertUrlExterna('http://exemplo.com/x', { allowHttp: true })).not.toThrow();
  });
});
