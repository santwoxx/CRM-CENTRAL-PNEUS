import { ChannelStatus, ChannelType, MessageType, normalizePhone } from '@crm/shared';
import { createId } from '@paralleldrive/cuid2';
import { prisma } from '../../db/prisma.js';
import { logger } from '../../lib/logger.js';
import { ValidationError } from '../../lib/errors.js';
import { processInboundMessage } from '../messages/processor.js';
import type { NormalizedInboundMessage } from '../../channels/types.js';

/**
 * Simulador de conversa.
 *
 * Injeta uma mensagem no MESMO caminho de uma mensagem real do WhatsApp:
 * resolucao de contato, criacao de conversa, skills de pneu, consulta ao
 * catalogo, resposta da IA, fila e roteamento. A unica diferenca e o
 * transporte - nada sai para a internet.
 *
 * Por que isso importa: da para avaliar o CRM inteiro sem numero de WhatsApp,
 * sem token da Meta, sem Docker e sem QR Code. E o caminho para alguem de
 * fora testar o sistema hoje.
 *
 * Importante: e uma ferramenta de TESTE. As conversas que ela cria sao
 * conversas de verdade no banco, e por isso a rota exige autenticacao e pode
 * ser desligada por configuracao em producao.
 */

const SIMULATOR_CHANNEL_NAME = 'Simulador / Webchat';

/**
 * Garante que existe um canal interno para as conversas simuladas.
 * Fica separado dos canais reais para nao poluir metricas do WhatsApp.
 */
export async function ensureSimulatorChannel(orgId: string): Promise<{
  id: string;
  orgId: string;
  type: string;
}> {
  const existing = await prisma.channel.findFirst({
    where: { orgId, type: ChannelType.WEBCHAT },
    select: { id: true, orgId: true, type: true },
  });

  if (existing) return existing;

  const created = await prisma.channel.create({
    data: {
      orgId,
      type: ChannelType.WEBCHAT,
      name: SIMULATOR_CHANNEL_NAME,
      identifier: 'webchat',
      isActive: true,
      isDefault: false,
      // Canal interno nao depende de nada externo: ja nasce conectado.
      status: ChannelStatus.CONNECTED,
      statusDetail: 'Canal interno para testes e webchat',
    },
    select: { id: true, orgId: true, type: true },
  });

  logger.info({ channelId: created.id, orgId }, 'Canal de simulacao criado');
  return created;
}

export interface SimulateInput {
  orgId: string;
  /** Telefone ficticio do cliente. Mensagens do mesmo numero caem na mesma conversa. */
  phone: string;
  /** Nome que aparece para o atendente. */
  name?: string;
  text: string;
}

export async function simulateInboundMessage(input: SimulateInput): Promise<{
  conversationId: string;
  messageId: string;
  duplicated: boolean;
}> {
  const phone = normalizePhone(input.phone);
  if (!phone) {
    throw new ValidationError('Telefone invalido para simulacao', [
      { path: 'phone', message: 'Use um numero valido, ex.: 31988887777' },
    ]);
  }

  const text = input.text.trim();
  if (!text) {
    throw new ValidationError('Mensagem vazia', [
      { path: 'text', message: 'Escreva algo para o cliente enviar' },
    ]);
  }

  const channel = await ensureSimulatorChannel(input.orgId);

  const incoming: NormalizedInboundMessage = {
    // Id unico por mensagem: a deduplicacao do pipeline e por (canal, id).
    externalId: `sim_${createId()}`,
    from: phone,
    phone,
    pushName: input.name?.trim() || null,
    timestamp: new Date(),
    type: MessageType.TEXT,
    content: text,
  };

  const result = await processInboundMessage(
    { id: channel.id, orgId: channel.orgId, type: channel.type },
    incoming,
  );

  if (!result) {
    throw new ValidationError('Nao foi possivel processar a mensagem simulada');
  }

  logger.info(
    { conversationId: result.conversationId, phone },
    'Mensagem simulada injetada no pipeline',
  );

  return result;
}
