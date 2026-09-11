import { describe, expect, it } from 'vitest';
import { jobIdEntrada, jobIdSaida, jobIdIa, jobIdMidia } from '../queue/jobIds.js';

/**
 * Chaves das filas.
 *
 * Os dois defeitos cobertos aqui ja existiram no codigo e nenhum dos dois
 * aparece como erro numa leitura casual:
 *
 *  - ":" no jobId: o BullMQ recusa em tempo de execucao. Os quatro auxiliares
 *    usavam "inbound:", "outbound:", "ai:" e "media:". Teria derrubado o
 *    pipeline inteiro de mensagens assim que entrasse em producao.
 *
 *  - identificador vazio: o jobId e a chave de deduplicacao. Um id indefinido
 *    produz "inbound-undefined", uma chave constante - o primeiro evento entra
 *    e todos os seguintes sao descartados como duplicados, em silencio. O
 *    sistema fica de pe, as filas ficam limpas, e nada e entregue.
 */

const construtores = [
  ['entrada', jobIdEntrada],
  ['saida', jobIdSaida],
  ['ia', jobIdIa],
  ['midia', jobIdMidia],
] as const;

describe('jobId das filas', () => {
  it('nenhum construtor usa ":" - o BullMQ recusa', () => {
    for (const [nome, construir] of construtores) {
      expect(construir('abc123'), nome).not.toContain(':');
    }
  });

  it('cada fila usa um prefixo proprio', () => {
    expect(jobIdEntrada('x')).toBe('inbound-x');
    expect(jobIdSaida('x')).toBe('outbound-x');
    expect(jobIdIa('x')).toBe('ai-x');
    expect(jobIdMidia('x')).toBe('media-x');
  });

  it('o mesmo identificador produz sempre a mesma chave', () => {
    // E disso que depende a deduplicacao: reentrega da Meta, duplo clique no
    // botao de enviar e retentativa de download precisam colidir de proposito.
    expect(jobIdEntrada('evento-1')).toBe(jobIdEntrada('evento-1'));
  });

  it('identificadores diferentes nao colidem', () => {
    expect(jobIdEntrada('evento-1')).not.toBe(jobIdEntrada('evento-2'));
  });

  it('recusa identificador vazio em vez de gerar chave constante', () => {
    for (const [nome, construir] of construtores) {
      expect(() => construir(''), nome).toThrow(/vazio/i);
      expect(() => construir('   '), nome).toThrow(/vazio/i);
    }
  });

  it('recusa identificador ausente, que viraria "-undefined"', () => {
    for (const [nome, construir] of construtores) {
      expect(() => construir(undefined as unknown as string), nome).toThrow(/vazio/i);
      expect(() => construir(null as unknown as string), nome).toThrow(/vazio/i);
    }
  });

  it('recusa identificador que contenha ":" em vez de montar chave invalida', () => {
    // Protege contra um id vindo de fora do banco com formato inesperado.
    for (const [nome, construir] of construtores) {
      expect(() => construir('ns:123'), nome).toThrow(/":"/);
    }
  });

  it('a mensagem de erro diz qual fila falhou', () => {
    // O erro sobe de dentro de um worker; sem o nome da fila, a investigacao
    // comeca sem pista nenhuma.
    expect(() => jobIdMidia('')).toThrow(/media/);
    expect(() => jobIdIa('')).toThrow(/ai/);
  });
});
