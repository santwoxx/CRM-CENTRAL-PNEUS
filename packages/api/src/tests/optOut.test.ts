import { describe, expect, it } from 'vitest';
import { interpretarPedidoDeContato } from '../modules/contacts/optOut.js';

/**
 * Precisao nos dois sentidos.
 *
 * Falso negativo: a Meta pune, o numero cai. Falso positivo: o cliente perde
 * o atendimento sem entender por que - e "pare" aparece em frase legitima o
 * tempo todo numa loja de pneus.
 */
describe('pedido de descadastramento', () => {
  it('reconhece a palavra-chave sozinha', () => {
    for (const t of ['PARE', 'pare', 'Parar', 'SAIR', 'stop', 'cancelar', 'descadastrar']) {
      expect(interpretarPedidoDeContato(t), t).toBe('descadastrar');
    }
  });

  it('aceita pontuacao e emoji nas pontas', () => {
    for (const t of ['PARE!', '  sair  ', 'PARE.', 'pare 🙏']) {
      expect(interpretarPedidoDeContato(t), t).toBe('descadastrar');
    }
  });

  it('reconhece frases inequivocas', () => {
    for (const t of [
      'não quero mais receber mensagens',
      'nao me mande mais nada',
      'me tire da lista',
      'quero cancelar o recebimento',
      'parar de me mandar promoções',
      'me descadastrar por favor',
    ]) {
      expect(interpretarPedidoDeContato(t), t).toBe('descadastrar');
    }
  });

  it('NAO descadastra quem so usou a palavra numa frase comum', () => {
    // O caso perigoso: numa loja de pneus, estas frases sao rotineiras.
    for (const t of [
      'pare de mandar áudio, prefiro texto',
      'o carro não para de puxar pra direita',
      'pode parar no meu nome mesmo',
      'quero sair daqui às 15h, dá tempo?',
      'vou cancelar o horário de amanhã',
      'não quero o Pirelli, prefiro o Michelin',
    ]) {
      expect(interpretarPedidoDeContato(t), t).toBeNull();
    }
  });

  it('reconhece quem quer voltar a receber', () => {
    for (const t of ['quero voltar', 'me cadastrar de novo', 'VOLTAR']) {
      expect(interpretarPedidoDeContato(t), t).toBe('voltar');
    }
  });

  it('ignora mensagem comum', () => {
    for (const t of ['bom dia', 'quanto custa 205/55R16?', '', null, undefined]) {
      expect(interpretarPedidoDeContato(t as string)).toBeNull();
    }
  });
});
