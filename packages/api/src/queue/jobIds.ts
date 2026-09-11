/**
 * Montagem dos `jobId` das filas.
 *
 * Isto existe como modulo proprio para que duas regras nao-obvias fiquem
 * cobertas por teste, em vez de viverem so num comentario:
 *
 *  1. NUNCA usar ":" no jobId. O BullMQ reserva os dois-pontos para montar
 *     as proprias chaves no Redis e RECUSA ids que o contenham. Ja aconteceu:
 *     os quatro auxiliares usavam "inbound:", "outbound:", "ai:" e "media:",
 *     o que derrubaria o pipeline inteiro de mensagens em producao.
 *
 *  2. O jobId e a chave de deduplicacao. Se o identificador chegar vazio ou
 *     indefinido, o resultado vira "inbound-undefined" - uma chave constante.
 *     O primeiro evento entra e TODOS os seguintes sao descartados como
 *     duplicados, em silencio, sem erro em lugar nenhum. Esse e o modo de
 *     falha mais caro possivel: o sistema parece vivo e nao entrega nada.
 *     Por isso falhamos alto, na hora de enfileirar.
 */

/** Caracteres que o BullMQ nao aceita em jobId customizado. */
const PROIBIDOS = /:/;

function montar(prefixo: string, identificador: string | null | undefined): string {
  if (typeof identificador !== 'string' || identificador.trim() === '') {
    throw new Error(
      `jobId de "${prefixo}" recebeu um identificador vazio. Isso transformaria a ` +
        `chave de deduplicacao numa constante e descartaria em silencio todos os ` +
        `jobs seguintes desta fila.`,
    );
  }

  if (PROIBIDOS.test(identificador)) {
    throw new Error(
      `jobId de "${prefixo}" contem ":", que o BullMQ recusa: ${identificador}`,
    );
  }

  return `${prefixo}-${identificador}`;
}

/** Reentrega do mesmo evento pela Meta nao vira job duplicado. */
export const jobIdEntrada = (webhookEventId: string): string => montar('inbound', webhookEventId);

/** Dois cliques no botao enviam uma mensagem so. */
export const jobIdSaida = (messageId: string): string => montar('outbound', messageId);

/** Uma resposta da IA por mensagem que a disparou. */
export const jobIdIa = (triggerMessageId: string): string => montar('ai', triggerMessageId);

/** Um download por midia recebida. */
export const jobIdMidia = (messageId: string): string => montar('media', messageId);
