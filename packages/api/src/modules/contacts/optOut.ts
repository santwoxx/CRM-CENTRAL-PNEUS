import { ConversationEventType, ConversationStatus } from '@crm/shared';
import { prisma } from '../../db/prisma.js';
import { logger } from '../../lib/logger.js';
import { queueSystemMessage } from '../messages/outbox.js';

/**
 * Descadastramento ("PARE" / "SAIR").
 *
 * A Meta exige que o pedido seja respeitado. Ignorar gera denuncia, derruba a
 * nota de qualidade do numero e pode suspender a conta - o canal inteiro para.
 *
 * O DESAFIO AQUI E PRECISAO, NOS DOIS SENTIDOS
 *
 * Descadastrar quem nao pediu e pior do que nao descadastrar: o cliente perde
 * o atendimento sem entender por que. E "pare" aparece em frase legitima o
 * tempo todo - "pare de mandar audio", "o carro nao pare de puxar".
 *
 * Por isso a regra e: a palavra sozinha (a mensagem inteira e "PARE"), ou uma
 * frase que declare a intencao de forma inequivoca. Uma palavra no meio de
 * uma frase comum NAO descadastra.
 */

/** Palavra-chave quando enviada sozinha. E o formato que a Meta divulga. */
const PALAVRAS_EXATAS = new Set([
  'pare', 'parar', 'sair', 'stop', 'cancelar', 'descadastrar', 'remover',
  'sem', 'nao', 'chega', 'basta',
]);

/**
 * Frases que declaram a intencao sem ambiguidade.
 * Exigem o verbo E o complemento - "nao quero" sozinho nao basta, porque
 * pode ser resposta a qualquer pergunta.
 */
const FRASES_INEQUIVOCAS = [
  /\bn[aã]o\s+quero\s+(mais\s+)?receber\b/i,
  /\bn[aã]o\s+me\s+(mande|envie|manda|envia)\b/i,
  /\bn[aã]o\s+quero\s+mais\s+(nada|contato|mensagens?)\b/i,
  /\b(me\s+)?(tire|tira|remova|remove|exclua|exclui)\s+(da|do)\s+(lista|grupo|cadastro)\b/i,
  /\b(me\s+)?descadastr\w*/i,
  /\bparar?\s+de\s+(me\s+)?(mandar|enviar|receber)\s+(mensagens?|promo\w*|an[uú]ncios?)\b/i,
  /\bcancelar?\s+(o\s+)?(cadastro|recebimento|inscri[cç][aã]o)\b/i,
  /\bn[aã]o\s+perturbe?\b/i,
];

/**
 * Frases que pedem o CONTRARIO: voltar a receber.
 * Sem isso, quem se arrepende fica preso fora da lista para sempre.
 */
const FRASES_RETORNO = [
  /\b(quero|desejo)\s+(voltar|receber)\b/i,
  /\bme\s+(cadastr\w*|inscrev\w*)\b/i,
  /^\s*(voltar|retornar|sim,?\s*quero)\s*$/i,
];

export type PedidoDeContato = 'descadastrar' | 'voltar' | null;

/**
 * Interpreta a mensagem do cliente.
 *
 * Retorna `null` na esmagadora maioria das mensagens - o silencio e o caso
 * comum e o comportamento seguro.
 */
export function interpretarPedidoDeContato(texto: string | null | undefined): PedidoDeContato {
  if (!texto) return null;

  const limpo = texto
    .trim()
    .toLowerCase()
    // Tira pontuacao e emoji das pontas: "PARE!" e "PARE" sao o mesmo pedido.
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

  if (!limpo) return null;

  if (FRASES_RETORNO.some((padrao) => padrao.test(limpo))) return 'voltar';

  // Palavra sozinha: a mensagem INTEIRA e a palavra-chave.
  if (PALAVRAS_EXATAS.has(limpo)) return 'descadastrar';

  if (FRASES_INEQUIVOCAS.some((padrao) => padrao.test(limpo))) return 'descadastrar';

  return null;
}

// --- Aplicacao -------------------------------------------------------------

/**
 * Registra o descadastramento e confirma ao cliente.
 *
 * A confirmacao e obrigatoria: sem resposta, ele nao sabe se foi atendido e
 * manda "PARE" de novo, ou denuncia. Uma frase basta.
 */
export async function registrarDescadastramento(
  contactId: string,
  conversationId: string,
  textoOriginal: string,
): Promise<void> {
  await prisma.contact.update({
    where: { id: contactId },
    data: { optedOutAt: new Date(), optOutReason: textoOriginal.slice(0, 500) },
  });

  // Encerra a conversa: nao faz sentido deixar na fila alguem que pediu para
  // nao ser contatado, nem ocupar a vaga de um atendente.
  await prisma.conversation.updateMany({
    where: { id: conversationId, status: { not: ConversationStatus.RESOLVED } },
    data: {
      status: ConversationStatus.RESOLVED,
      aiControlled: false,
      resolvedAt: new Date(),
    },
  });

  await prisma.conversationEvent.create({
    data: {
      conversationId,
      type: ConversationEventType.RESOLVED,
      data: { motivo: 'descadastramento', texto: textoOriginal.slice(0, 200) },
    },
  });

  // A confirmacao passa por `bypassOptOut` porque e a UNICA mensagem que
  // ainda pode sair: e justamente a resposta ao pedido dele.
  await queueSystemMessage(
    conversationId,
    'Pronto! Você não receberá mais mensagens nossas. ' +
      'Se mudar de ideia, é só escrever VOLTAR.',
    { bypassOptOut: true },
  );

  logger.info({ contactId, conversationId }, 'Cliente descadastrado a pedido');
}

/** Desfaz o descadastramento quando o proprio cliente pede. */
export async function registrarRetorno(
  contactId: string,
  conversationId: string,
): Promise<void> {
  await prisma.contact.update({
    where: { id: contactId },
    data: { optedOutAt: null, optOutReason: null },
  });

  await queueSystemMessage(
    conversationId,
    'Que bom ter você de volta! Como podemos ajudar?',
    { bypassOptOut: true },
  );

  logger.info({ contactId }, 'Cliente voltou a aceitar contato');
}
