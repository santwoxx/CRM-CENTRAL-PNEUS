import { describe, it, expect } from 'vitest';
import {
  normalizePhone,
  phoneVariants,
  formatPhone,
  isValidPhone,
  UserRole,
  Permission,
  can,
  outranks,
} from '@crm/shared';
import crypto from 'node:crypto';
import { evaluateFastTriggers, evaluateLeadWarmth } from '../modules/ai/evaluator.js';
import { encryptJson, decryptJson, verifyMetaSignature, sha256 } from '../lib/crypto.js';

describe('1. Normalização de Telefones Brasileiros (Regra do 9º Dígito)', () => {
  it('deve normalizar número com DDD e 8 dígitos adicionando o 9 canônico para celulares', () => {
    // 31 98888-7777 vs 31 8888-7777
    const result = normalizePhone('3188887777');
    expect(result).toBe('5531988887777');
  });

  it('deve formatar número canônico para exibição amigável', () => {
    const formatted = formatPhone('5531988887777');
    expect(formatted).toBe('+55 (31) 98888-7777');
  });

  it('deve gerar todas as variantes conhecidas para casar no banco de dados', () => {
    const variants = phoneVariants('5531988887777');
    expect(variants).toContain('5531988887777');
    expect(variants).toContain('553188887777'); // sem o 9 (como a Meta envia para números antigos)
  });

  it('deve validar se o telefone é válido', () => {
    expect(isValidPhone('(31) 99999-8888')).toBe(true);
    expect(isValidPhone('123')).toBe(false);
  });
});

describe('2. Matriz de Permissões RBAC', () => {
  it('OWNER deve ter todas as permissões incluindo gerenciar administradores', () => {
    expect(can(UserRole.OWNER, Permission.USER_MANAGE_ADMINS)).toBe(true);
    expect(can(UserRole.ADMIN, Permission.USER_MANAGE_ADMINS)).toBe(false);
  });

  it('ADMIN deve ter permissão de supervisão global e canais', () => {
    expect(can(UserRole.ADMIN, Permission.CHANNEL_MANAGE)).toBe(true);
    expect(can(UserRole.ADMIN, Permission.CONVERSATION_SPECTATE)).toBe(true);
    expect(can(UserRole.AGENT, Permission.CHANNEL_MANAGE)).toBe(false);
  });

  it('Hierarquia outranks deve impedir rebaixamento ou edição de cargos superiores', () => {
    expect(outranks(UserRole.OWNER, UserRole.ADMIN)).toBe(true);
    expect(outranks(UserRole.ADMIN, UserRole.OWNER)).toBe(false);
    expect(outranks(UserRole.SUPERVISOR, UserRole.AGENT)).toBe(true);
  });
});

describe('3. Avaliador de Triagem e Aquecimento de Leads da IA', () => {
  it('deve detectar solicitação explícita de atendente humano', () => {
    const trigger = evaluateFastTriggers('quero falar com um atendente humano por favor', 1, 10);
    expect(trigger).not.toBeNull();
    expect(trigger?.shouldHandoff).toBe(true);
    expect(trigger?.handoffReason).toBe('CUSTOMER_REQUESTED');
  });

  it('deve detectar direcionamento para o Financeiro', () => {
    const trigger = evaluateFastTriggers('preciso da segunda via do meu boleto e nota fiscal', 1, 10);
    expect(trigger).not.toBeNull();
    expect(trigger?.targetDepartmentName).toBe('Financeiro');
  });

  it('deve detectar lead aquecido com medida de pneu e veículo', () => {
    const messages = [
      { direction: 'INBOUND', content: 'Boa tarde, gostaria de cotar 4 pneus na medida 205/55 R16 para um Corolla' },
    ];
    const result = evaluateLeadWarmth(messages);
    expect(result.isWarm).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(60);
    expect(result.summary).toContain('205/55 R16');
  });
});

describe('4. Criptografia de Credenciais de Canais e Assinatura Meta HMAC', () => {
  it('deve cifrar e decifrar credenciais com AES-256-GCM sem corrupção', () => {
    const original = {
      accessToken: 'EAANL...token_secreto_whatsapp',
      phoneNumberId: '1092837491029',
      verifyToken: 'meu_token_secreto',
    };

    const encrypted = encryptJson(original);
    expect(encrypted).not.toContain('token_secreto_whatsapp');

    const decrypted = decryptJson<typeof original>(encrypted);
    expect(decrypted).toEqual(original);
  });

  it('deve validar assinatura HMAC X-Hub-Signature-256 da Meta', () => {
    const rawBody = Buffer.from(JSON.stringify({ entry: [{ id: '123' }] }));
    const secret = 'chave-secreta-do-app-meta';

    // Cria assinatura válida
    const signature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const header = `sha256=${signature}`;

    expect(verifyMetaSignature(rawBody, header, secret)).toBe(true);
    expect(verifyMetaSignature(rawBody, 'sha256=invalida', secret)).toBe(false);
  });
});
