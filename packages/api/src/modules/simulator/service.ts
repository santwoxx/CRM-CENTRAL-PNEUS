import { ChannelStatus, ChannelType, MessageType, normalizePhone, phoneVariants } from '@crm/shared';
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

export interface SimulatedConversationView {
  conversationId: string | null;
  status: string | null;
  department: string | null;
  assignedTo: string | null;
  aiControlled: boolean;
  intent: string | null;
  leadScore: number | null;
  /** O que o extrator leu da conversa: medida, quantidade, veiculo. */
  detected: Record<string, unknown>;
  messages: {
    id: string;
    from: 'cliente' | 'ia' | 'atendente' | 'sistema';
    author: string | null;
    text: string;
    status: string;
    at: string;
  }[];
}

/**
 * A conversa como o CLIENTE a veria no celular dele.
 *
 * Filtra notas internas de proposito: elas existem no historico da equipe,
 * mas o cliente nunca as recebe - e a tela de simulacao precisa mostrar
 * exatamente o que chega no WhatsApp dele, senao a demonstracao mente.
 */
export async function getSimulatedConversation(
  orgId: string,
  phone: string,
): Promise<SimulatedConversationView> {
  const normalized = normalizePhone(phone);
  const vazio: SimulatedConversationView = {
    conversationId: null,
    status: null,
    department: null,
    assignedTo: null,
    aiControlled: false,
    intent: null,
    leadScore: null,
    detected: {},
    messages: [],
  };

  if (!normalized) return vazio;

  const contact = await prisma.contact.findFirst({
    where: { orgId, phone: { in: phoneVariants(normalized) } },
    select: { id: true },
  });
  if (!contact) return vazio;

  const conversation = await prisma.conversation.findFirst({
    where: { contactId: contact.id },
    orderBy: { createdAt: 'desc' },
    include: {
      department: { select: { name: true } },
      assignedUser: { select: { name: true } },
      messages: {
        where: { isPrivate: false },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          content: true,
          senderType: true,
          status: true,
          createdAt: true,
          sender: { select: { name: true } },
        },
      },
    },
  });
  if (!conversation) return vazio;

  const origem: Record<string, SimulatedConversationView['messages'][number]['from']> = {
    CONTACT: 'cliente',
    AI: 'ia',
    AGENT: 'atendente',
    SYSTEM: 'sistema',
  };

  const metadata = (conversation.metadata ?? {}) as { shop?: Record<string, unknown> };

  return {
    conversationId: conversation.id,
    status: conversation.status,
    department: conversation.department?.name ?? null,
    assignedTo: conversation.assignedUser?.name ?? null,
    aiControlled: conversation.aiControlled,
    intent: conversation.intent,
    leadScore: conversation.leadScore,
    detected: metadata.shop ?? {},
    messages: conversation.messages.map((message) => ({
      id: message.id,
      from: origem[message.senderType] ?? 'sistema',
      author: message.sender?.name ?? null,
      text: message.content ?? '',
      status: message.status,
      at: message.createdAt.toISOString(),
    })),
  };
}

/** Apaga a conversa simulada para recomecar o teste do zero. */
export async function resetSimulatedContact(orgId: string, phone: string): Promise<boolean> {
  const normalized = normalizePhone(phone);
  if (!normalized) return false;

  const contact = await prisma.contact.findFirst({
    where: { orgId, phone: { in: phoneVariants(normalized) } },
    select: { id: true },
  });
  if (!contact) return false;

  // Em cascata: conversas, mensagens e eventos saem junto com o contato.
  await prisma.contact.delete({ where: { id: contact.id } });
  logger.info({ phone: normalized }, 'Contato de simulacao removido');
  return true;
}
