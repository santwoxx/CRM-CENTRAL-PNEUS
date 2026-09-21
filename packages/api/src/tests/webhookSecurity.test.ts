import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { webhookEvolutionAutentico, webhookMetaAutentico } from '../modules/webhooks/routes.js';

function assinatura(body: Buffer, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

describe('autenticacao do webhook da Meta', () => {
  const secret = 'app-secret-de-teste';

  it('valida os bytes exatos recebidos, incluindo espacos do JSON', () => {
    const raw = Buffer.from('{\n  "entry": [{ "id": "123" }]\n}');
    expect(webhookMetaAutentico(raw, assinatura(raw, secret), secret)).toBe(true);

    // O objeto representa o mesmo JSON, mas os bytes nao sao os assinados.
    const reserializado = Buffer.from(JSON.stringify(JSON.parse(raw.toString('utf8'))));
    expect(webhookMetaAutentico(reserializado, assinatura(raw, secret), secret)).toBe(false);
  });

  it('recusa corpo, assinatura ou segredo divergentes', () => {
    const raw = Buffer.from('{"entry":[]}');
    expect(webhookMetaAutentico(undefined, assinatura(raw, secret), secret)).toBe(false);
    expect(webhookMetaAutentico(raw, undefined, secret)).toBe(false);
    expect(webhookMetaAutentico(raw, 'sha256=invalida', secret)).toBe(false);
    expect(webhookMetaAutentico(raw, assinatura(raw, 'outro-segredo'), secret)).toBe(false);
  });
});

describe('autenticacao do webhook da Evolution', () => {
  // A Evolution nao assina o corpo; o token e a unica barreira entre a
  // internet e o atendimento. Sem ele, mensagem forjada vira conversa real e
  // dispara resposta paga da IA.
  const segredo = 'segredo-de-teste-com-tamanho-razoavel';

  it('aceita o token correto', () => {
    expect(webhookEvolutionAutentico(segredo, segredo)).toBe(true);
  });

  it('recusa token ausente, vazio ou diferente', () => {
    expect(webhookEvolutionAutentico(undefined, segredo)).toBe(false);
    expect(webhookEvolutionAutentico('', segredo)).toBe(false);
    expect(webhookEvolutionAutentico('outro-token', segredo)).toBe(false);
    // Prefixo do segredo nao pode passar.
    expect(webhookEvolutionAutentico(segredo.slice(0, 10), segredo)).toBe(false);
  });

  it('sem segredo configurado, nada passa - nem string vazia contra vazia', () => {
    expect(webhookEvolutionAutentico('', '')).toBe(false);
    expect(webhookEvolutionAutentico('qualquer', '')).toBe(false);
  });
});
