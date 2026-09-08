import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Testa a montagem do contexto que vai para a IA.
 *
 * O que realmente importa aqui: garantir que todo preco que a IA pode falar
 * saiu do banco. Por isso o Prisma e substituido por um duble - assim
 * conseguimos forcar os cenarios dificeis (sem estoque, catalogo fora do ar)
 * que dificilmente aconteceriam num teste com banco real.
 */

const findMany = vi.fn();
const serviceFindMany = vi.fn();

vi.mock('../db/prisma.js', () => ({
  prisma: {
    tireProduct: { findMany: (...args: unknown[]) => findMany(...args) },
    serviceItem: { findMany: (...args: unknown[]) => serviceFindMany(...args) },
  },
}));

const { buildShopContext } = await import('../modules/ai/skills/index.js');

const PNEU_P7 = {
  id: 't1',
  brand: 'Pirelli',
  model: 'Cinturato P7',
  sizeKey: '205/55R16',
  category: 'PASSEIO',
  priceCents: 62900,
  promoPriceCents: 57900,
  stockQuantity: 18,
  warrantyMonths: 60,
};

beforeEach(() => {
  findMany.mockReset();
  serviceFindMany.mockReset();
  serviceFindMany.mockResolvedValue([]);
});

describe('contexto da loja entregue a IA', () => {
  it('entrega preco real do banco quando ha estoque na medida', async () => {
    findMany.mockResolvedValue([PNEU_P7]);

    const result = await buildShopContext('org1', 'bom dia, quanto fica 205/55R16?');

    expect(result.intent).toBe('TIRE_QUOTE');
    expect(result.size?.formatted).toBe('205/55 R16');
    // O preco promocional (R$ 579,00) e o que vale, nao o cheio.
    expect(result.contextBlock).toContain('R$ 579,00');
    expect(result.contextBlock).toContain('ESTOQUE REAL');
    expect(result.readyForHandoff).toBe(true);
  });

  it('calcula o total quando o cliente pede um jogo', async () => {
    findMany.mockResolvedValue([PNEU_P7]);

    const result = await buildShopContext('org1', 'quero um jogo de 205/55R16');

    expect(result.quantity).toBe(4);
    // 4 x 579,00 = 2.316,00
    expect(result.contextBlock).toContain('R$ 2.316,00');
  });

  it('oferece alternativa no mesmo aro quando a medida esta sem estoque', async () => {
    findMany
      .mockResolvedValueOnce([]) // medida exata: nada
      .mockResolvedValueOnce([{ ...PNEU_P7, sizeKey: '215/65R16', promoPriceCents: null }]);

    const result = await buildShopContext('org1', 'tem 205/55R16?');

    expect(result.contextBlock).toContain('SEM ESTOQUE');
    expect(result.contextBlock).toContain('Alternativas disponiveis no aro 16');
  });

  it('proibe cotar preco se o catalogo estiver fora do ar', async () => {
    findMany.mockRejectedValue(new Error('conexao recusada'));

    const result = await buildShopContext('org1', 'preco do 205/55R16');

    // A falha nao derruba o atendimento, mas trava a citacao de precos.
    expect(result.contextBlock).toContain('NAO cite precos');
    expect(result.contextBlock).not.toContain('R$');
  });

  it('pede a medida completa quando o cliente so sabe o aro', async () => {
    findMany.mockResolvedValue([]);

    const result = await buildShopContext('org1', 'meu carro e aro 16, tem pneu?');

    expect(result.rim).toBe(16);
    expect(result.contextBlock).toContain('medida completa');
    expect(result.readyForHandoff).toBe(false);
  });

  it('reconhece garantia como assunto de oficina, nao de venda', async () => {
    const result = await buildShopContext('org1', 'meu pneu esta com uma bolha na lateral');

    expect(result.intent).toBe('WARRANTY');
    // Caso de seguranca: vai direto para humano.
    expect(result.readyForHandoff).toBe(true);
  });

  it('traz a tabela de servicos quando o assunto e oficina', async () => {
    serviceFindMany.mockResolvedValue([
      { id: 's1', name: 'Alinhamento 3D', slug: 'a', description: null, priceCents: 9900, durationMinutes: 40 },
    ]);

    const result = await buildShopContext('org1', 'quero fazer alinhamento no meu onix');

    expect(result.intent).toBe('SERVICE');
    expect(result.vehicle).toBe('onix');
    expect(result.contextBlock).toContain('R$ 99,00');
  });
});

/**
 * Regressao encontrada testando contra o banco real: "quero um jogo de
 * 195/65R15" caia em OTHER porque a frase nao contem "pneu" nem "preco".
 * O cliente recebia uma resposta generica embora o codigo ja tivesse o
 * preco em maos.
 */
describe('medida na mensagem implica cotacao', () => {
  it('classifica como cotacao mesmo sem a palavra "pneu"', async () => {
    findMany.mockResolvedValue([PNEU_P7]);

    const result = await buildShopContext('org1', 'quero um jogo de 205/55R16');

    expect(result.intent).toBe('TIRE_QUOTE');
    expect(result.quantity).toBe(4);
    expect(result.readyForHandoff).toBe(true);
  });

  it('uma saudacao seca continua sendo saudacao', async () => {
    findMany.mockResolvedValue([]);
    const result = await buildShopContext('org1', 'bom dia');
    expect(result.intent).toBe('GREETING');
  });
});
