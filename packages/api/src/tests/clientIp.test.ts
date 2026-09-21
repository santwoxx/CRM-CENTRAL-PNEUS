import { describe, expect, it } from 'vitest';
import { resolverIpCliente } from '../lib/clientIp.js';

/**
 * IP real do cliente atras de proxy.
 *
 * Duas falhas opostas, ambas caras:
 *  - confiar de menos: todo mundo aparece com o IP do proxy, o limite de
 *    tentativas vira um balde unico e atendentes sao deslogados em massa;
 *  - confiar demais: qualquer um forja X-Forwarded-For e escapa do limite de
 *    tentativas de senha trocando de "IP" a cada chute.
 */

const CADDY = '172.30.0.10';

function req(ip: string, headers: Record<string, string> = {}) {
  return { ip, headers };
}

describe('resolverIpCliente', () => {
  it('atras do Caddy configurado, usa o IP do cliente que ele repassou', () => {
    const ip = resolverIpCliente(req(CADDY, { 'x-forwarded-for': '200.150.10.20' }), [CADDY]);

    expect(ip).toBe('200.150.10.20');
  });

  it('cabecalho forjado por conexao direta e ignorado', () => {
    // Atacante fala direto com a API e inventa um IP a cada tentativa.
    const ip = resolverIpCliente(
      req('203.0.113.9', { 'x-forwarded-for': '1.2.3.4' }),
      [CADDY],
    );

    expect(ip).toBe('203.0.113.9');
  });

  it('sem proxy configurado, nem um IP de rede interna ganha confianca', () => {
    // Confiar em toda faixa privada seria perigoso numa rede compartilhada.
    const ip = resolverIpCliente(req('172.30.0.99', { 'x-forwarded-for': '1.2.3.4' }), []);

    expect(ip).toBe('172.30.0.99');
  });

  it('continua aceitando o loopback, que e o Cloudflare Tunnel local', () => {
    const ip = resolverIpCliente(
      req('127.0.0.1', { 'cf-connecting-ip': '200.150.10.20' }),
      [],
    );

    expect(ip).toBe('200.150.10.20');
  });

  it('entende IPv4 escrito como IPv6 na conexao do proxy', () => {
    const ip = resolverIpCliente(
      req(`::ffff:${CADDY}`, { 'x-forwarded-for': '200.150.10.20' }),
      [CADDY],
    );

    expect(ip).toBe('200.150.10.20');
  });

  it('com varios saltos, o primeiro endereco e o do cliente', () => {
    const ip = resolverIpCliente(
      req(CADDY, { 'x-forwarded-for': '200.150.10.20, 10.0.0.5' }),
      [CADDY],
    );

    expect(ip).toBe('200.150.10.20');
  });

  it('proxy confiavel sem cabecalho cai no proprio endereco, sem quebrar', () => {
    expect(resolverIpCliente(req(CADDY), [CADDY])).toBe(CADDY);
  });
});
