import { describe, expect, it } from 'vitest';
import {
  extractTireSize,
  extractTireSizes,
  extractRimOnly,
  extractQuantity,
} from '../modules/ai/skills/tireSize.js';

/**
 * A medida do pneu e o dado que nao pode sair errado: ela define o orcamento,
 * o estoque e o que o cliente recebe. Os casos abaixo sao mensagens reais de
 * WhatsApp, com a bagunca de digitacao que vem junto.
 */
describe('extracao de medida de pneu', () => {
  it('le os formatos que o cliente realmente digita', () => {
    const cases: [string, string][] = [
      ['preciso de 205/55R16', '205/55 R16'],
      ['205/55 r16 por favor', '205/55 R16'],
      ['tenho 205 55 16', '205/55 R16'],
      ['medida 205/55/16', '205/55 R16'],
      ['é 2055516', '205/55 R16'],
      ['175-70-13 quanto sai?', '175/70 R13'],
      ['quero 195/65R15 91H', '195/65 R15'],
    ];

    for (const [input, expected] of cases) {
      expect(extractTireSize(input)?.formatted, `entrada: ${input}`).toBe(expected);
    }
  });

  it('captura indice de carga e velocidade quando vem junto', () => {
    const size = extractTireSize('quero 195/65R15 91H');
    expect(size?.loadIndex).toBe(91);
    expect(size?.speedRating).toBe('H');
  });

  it('entende aro fracionado de caminhao', () => {
    expect(extractTireSize('275/80R22.5')?.formatted).toBe('275/80 R22.5');
  });

  it('acha as duas medidas quando o carro usa dianteira e traseira diferentes', () => {
    const sizes = extractTireSizes('na frente 205/55R16 e atras 225/45R17');
    expect(sizes.map((size) => size.formatted)).toEqual(['205/55 R16', '225/45 R17']);
  });

  it('nao confunde telefone nem CPF com medida', () => {
    // O perigo real: 7 digitos soltos dentro de um numero maior.
    expect(extractTireSize('meu whats e 31998887777')).toBeNull();
    expect(extractTireSize('cpf 12345678901')).toBeNull();
  });

  it('recusa medidas fora da faixa de mercado', () => {
    expect(extractTireSize('999/99R99')).toBeNull();
    expect(extractTireSize('205/55R45')).toBeNull();
  });

  it('le o aro sozinho quando o cliente nao sabe a medida completa', () => {
    expect(extractRimOnly('meu carro e aro 16')).toBe(16);
    expect(extractRimOnly('roda 17')).toBe(17);
    expect(extractRimOnly('aro 99')).toBeNull();
  });

  it('entende a quantidade no vocabulario de borracharia', () => {
    expect(extractQuantity('quero um jogo')).toBe(4);
    expect(extractQuantity('preciso de um par')).toBe(2);
    expect(extractQuantity('2 pneus')).toBe(2);
    expect(extractQuantity('quatro pneus')).toBe(4);
    expect(extractQuantity('bom dia')).toBeNull();
  });
});

/**
 * Estes casos existem por causa de um bug real: `/alinhament\b/` NAO casa
 * "alinhamento", porque o "o" seguinte tambem e caractere de palavra. O
 * efeito era silencioso - toda intencao de oficina caía em OTHER e o cliente
 * nao recebia a tabela de servicos.
 */
describe('classificacao de intencao', () => {
  it('reconhece servicos de oficina com a palavra completa', async () => {
    const { detectIntent } = await import('../modules/ai/skills/intent.js');

    for (const text of [
      'quero fazer alinhamento',
      'preciso de balanceamento',
      'trocar os amortecedores',
      'revisão de freios',
      'quanto custa a troca de óleo',
    ]) {
      expect(detectIntent(text), `entrada: ${text}`).toBe('SERVICE');
    }
  });

  it('separa garantia de venda', async () => {
    const { detectIntent } = await import('../modules/ai/skills/intent.js');

    // Cita "pneu", mas nao e cotacao: e caso de seguranca.
    expect(detectIntent('meu pneu está com bolhas')).toBe('WARRANTY');
    expect(detectIntent('o pneu rachou na lateral')).toBe('WARRANTY');
    expect(detectIntent('quero garantia do pneu')).toBe('WARRANTY');
  });

  it('separa financeiro de venda', async () => {
    const { detectIntent } = await import('../modules/ai/skills/intent.js');

    expect(detectIntent('preciso da segunda via do boleto')).toBe('FINANCIAL');
    expect(detectIntent('quero falar com o financeiro')).toBe('FINANCIAL');
  });

  it('reconhece cotacao de pneu', async () => {
    const { detectIntent } = await import('../modules/ai/skills/intent.js');

    expect(detectIntent('qual o preço do pneu?')).toBe('TIRE_QUOTE');
    expect(detectIntent('quero um orçamento')).toBe('TIRE_QUOTE');
    expect(detectIntent('quanto custa 205/55R16')).toBe('TIRE_QUOTE');
  });
});

/**
 * Medida incompleta. Existe porque o modelo completava o numero sozinho:
 * o cliente escrevia "175/70" e a resposta saia com "175/70 R13", um aro
 * que ninguem informou. Cliente confirma, compra e recebe o pneu errado.
 */
describe('medida incompleta (sem aro)', () => {
  it('reconhece largura e perfil sem inventar o aro', async () => {
    const { extractPartialSize } = await import('../modules/ai/skills/tireSize.js');

    const parcial = extractPartialSize('175/70');
    expect(parcial?.formatted).toBe('175/70');
    expect(parcial).not.toHaveProperty('rim');

    expect(extractPartialSize('tenho 205/55 no carro')?.formatted).toBe('205/55');
    expect(extractPartialSize('é 195-65 mesmo')?.formatted).toBe('195/65');
  });

  it('nao dispara quando a medida esta completa', async () => {
    const { extractPartialSize } = await import('../modules/ai/skills/tireSize.js');

    for (const completa of ['175/70R13', '175/70 13', '175/70/13', '2055516']) {
      expect(extractPartialSize(completa), `entrada: ${completa}`).toBeNull();
    }
  });

  it('ignora numeros que nao sao medida', async () => {
    const { extractPartialSize } = await import('../modules/ai/skills/tireSize.js');

    expect(extractPartialSize('meu cpf 123/45')).toBeNull();
    expect(extractPartialSize('bom dia')).toBeNull();
  });
});

/**
 * "175/13" apareceu num teste real e quebrou a conversa: nenhum extrator
 * reconhecia, o sistema ficava cego para a mensagem e a IA respondia algo
 * sem relacao com o que o cliente tinha escrito.
 */
describe('medida mal formada', () => {
  it('entende que 175/13 e largura e aro, faltando o perfil', async () => {
    const { extractSizeAttempt } = await import('../modules/ai/skills/tireSize.js');

    const tentativa = extractSizeAttempt('175/13');
    expect(tentativa?.kind).toBe('missing-profile');
    expect(tentativa?.width).toBe(175);
    expect(tentativa?.rim).toBe(13);
  });

  it('nao dispara quando a medida ja e valida', async () => {
    const { extractSizeAttempt } = await import('../modules/ai/skills/tireSize.js');

    expect(extractSizeAttempt('205/55R16')).toBeNull();
    expect(extractSizeAttempt('175/70')).toBeNull();
  });

  it('ignora numeros que nao sao tentativa de medida', async () => {
    const { extractSizeAttempt } = await import('../modules/ai/skills/tireSize.js');

    expect(extractSizeAttempt('bom dia')).toBeNull();
    expect(extractSizeAttempt('999/99')).toBeNull();
  });
});
