import { describe, expect, it, vi } from 'vitest';

/**
 * AI_MONTHLY_BUDGET_USD existia na configuracao e nao era lido por ninguem:
 * quem definia um limite achava estar protegido e nao estava.
 */

vi.mock('../db/prisma.js', () => ({ prisma: { aiUsage: { aggregate: vi.fn() } } }));

const { inicioDoMes, estourouOTeto } = await import('../modules/ai/orcamento.js');

describe('teto mensal de gasto com IA', () => {
  it('teto zero significa sem teto, nao "nao pode gastar"', () => {
    expect(estourouOTeto(999, 0)).toBe(false);
    expect(estourouOTeto(999, -5)).toBe(false);
    expect(estourouOTeto(999, Number.NaN)).toBe(false);
  });

  it('abaixo do teto, segue gastando', () => {
    expect(estourouOTeto(19.99, 20)).toBe(false);
  });

  it('no teto exato ja para: o limite e o ultimo dolar aceito', () => {
    expect(estourouOTeto(20, 20)).toBe(true);
    expect(estourouOTeto(20.01, 20)).toBe(true);
  });

  it('conta a partir do primeiro dia do mes, nao dos ultimos 30 dias', () => {
    // O usuario raciocina por fatura mensal; 30 dias corridos arrastaria o
    // gasto de um mes para dentro do seguinte.
    const inicio = inicioDoMes(new Date(2026, 8, 25, 14, 30, 0));

    expect(inicio.getFullYear()).toBe(2026);
    expect(inicio.getMonth()).toBe(8);
    expect(inicio.getDate()).toBe(1);
    expect(inicio.getHours()).toBe(0);
    expect(inicio.getMinutes()).toBe(0);
  });

  it('vira o ano sem sair do mes corrente', () => {
    const inicio = inicioDoMes(new Date(2027, 0, 3, 9, 0, 0));

    expect(inicio.getFullYear()).toBe(2027);
    expect(inicio.getMonth()).toBe(0);
    expect(inicio.getDate()).toBe(1);
  });
});
