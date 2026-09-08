import {
  ConversationStatus,
  HandoffReason,
  MessageDirection,
  MessageSenderType,
} from '@crm/shared';
import { prisma } from '../../db/prisma.js';
import { logger } from '../../lib/logger.js';
import { env } from '../../env.js';
import { queueAiMessage, queueSystemMessage } from '../messages/outbox.js';
import { routeConversation } from '../routing/router.js';
import {
  generateCompletion,
  type AiMessageInput,
  type AiProviderName,
} from './provider.js';
import { getActivePersona } from './persona.js';
import { evaluateFastTriggers, evaluateLeadWarmth } from './evaluator.js';
import { buildShopContext } from './skills/index.js';

/**
 * Serviço de IA para conversação e triagem de leads.
 */

export async function generateAiReply(
  conversationId: string,
  triggerMessageId: string,
): Promise<{ replied: boolean; handoff: boolean; reason?: string }> {
  if (!env.AI_ENABLED) {
    logger.debug({ conversationId }, 'IA desabilitada globalmente');
    return { replied: false, handoff: false };
  }

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: {
      contact: true,
      channel: true,
      department: true,
      messages: {
        where: { isPrivate: false },
        orderBy: { createdAt: 'desc' },
        take: 15,
      },
    },
  });

  if (!conversation || !conversation.aiControlled || conversation.status !== ConversationStatus.BOT) {
    logger.debug({ conversationId }, 'Conversa nao controlada pela IA ou ja transferida');
    return { replied: false, handoff: false };
  }

  const persona = await getActivePersona(conversation.orgId);
  const messagesChronological = [...conversation.messages].reverse();
  const lastCustomerMessage = [...messagesChronological]
    .reverse()
    .find((m) => m.direction === MessageDirection.INBOUND && m.content);

  const lastContent = lastCustomerMessage?.content || '';

  // 1. Verificação de gatilhos rápidos (solicitação explícita de humano, setor financeiro, ofensas)
  const fastTrigger = evaluateFastTriggers(
    lastContent,
    conversation.aiTurnCount,
    persona.maxTurnsBeforeHandoff,
  );

  if (fastTrigger && fastTrigger.shouldHandoff) {
    logger.info(
      { conversationId, reason: fastTrigger.handoffReason },
      'Gatilho de transbordo rápido acionado',
    );
    await executeHandoff(conversation, fastTrigger.handoffReason!, fastTrigger.targetDepartmentName);
    return { replied: true, handoff: true, reason: fastTrigger.handoffReason };
  }

  // 2. Avaliação de aquecimento do lead
  const warmth = evaluateLeadWarmth(messagesChronological);

  // 2b. Skills da loja de pneus: lemos a medida, a intencao e o veiculo por
  // codigo e buscamos preco/estoque REAIS no banco. A IA recebe os fatos
  // prontos - assim ela nunca precisa (nem consegue) inventar um preco.
  const shop = await buildShopContext(conversation.orgId, lastContent);

  // 3. Montagem do histórico para a IA responder cordialmente
  const aiMessages: AiMessageInput[] = [
    {
      role: 'system',
      content: `${persona.systemPrompt}
Dados do cliente:
Nome: ${conversation.contact.name || conversation.contact.pushName || 'Não informado'}
Telefone: ${conversation.contact.phone || 'Não informado'}
Situação atual do lead: ${warmth.summary} (Score: ${warmth.score}/100)
${shop.contextBlock ? `
DADOS REAIS DA LOJA (fonte: banco de dados, use SOMENTE estes numeros):
${shop.contextBlock}
` : ''}
REGRA INEGOCIAVEL SOBRE PRECOS: só cite valores que aparecem no bloco acima.
Se não houver bloco de dados, não invente preço nenhum — diga que o vendedor confirma o orçamento.
${
  warmth.isWarm
    ? 'IMPORTANTE: O lead já tem dados suficientes e está AQUECIDO! Finalize sua resposta confirmando os detalhes e avisando que vai chamar um especialista agora.'
    : 'Ainda faltam informações. Faça perguntas amigáveis para entender o carro/medida do pneu ou serviço.'
}`,
    },
  ];

  for (const m of messagesChronological) {
    if (m.senderType === MessageSenderType.CONTACT && m.content) {
      aiMessages.push({ role: 'user', content: m.content });
    } else if (m.senderType === MessageSenderType.AI && m.content) {
      aiMessages.push({ role: 'assistant', content: m.content });
    }
  }

  try {
    const aiResult = await generateCompletion(aiMessages, {
      provider: persona.provider as AiProviderName,
      model: persona.model,
      temperature: persona.temperature,
      maxTokens: persona.maxTokens,
    });

    // Enfileira a resposta gerada para sair pelo WhatsApp
    await queueAiMessage(conversation.id, aiResult.content.trim());

    // Registra métrica de consumo
    await prisma.aiUsage.create({
      data: {
        orgId: conversation.orgId,
        conversationId: conversation.id,
        provider: aiResult.provider,
        model: aiResult.model,
        inputTokens: aiResult.inputTokens,
        outputTokens: aiResult.outputTokens,
        cachedTokens: aiResult.cachedTokens,
        costUsd: aiResult.costUsd,
        latencyMs: aiResult.latencyMs,
        purpose: 'chat',
        success: true,
      },
    });

    // Atualiza pontuação e turno da conversa
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        aiTurnCount: { increment: 1 },
        leadScore: warmth.score,
        leadSummary: warmth.summary,
        // Medida, intencao e veiculo ficam na conversa para o vendedor abrir
        // a tela ja sabendo do que se trata, sem reler o historico inteiro.
        intent: shop.intent,
        metadata: { ...(conversation.metadata as object ?? {}), shop: shop.facts } as never,
      },
    });

    // 4. Se o lead ficou aquecido após esta interação, agenda o transbordo para a equipe humana
    if (warmth.isWarm) {
      logger.info({ conversationId, score: warmth.score }, 'Lead aquecido com sucesso! Transferindo');
      await executeHandoff(conversation, HandoffReason.LEAD_QUALIFIED);
      return { replied: true, handoff: true, reason: HandoffReason.LEAD_QUALIFIED };
    }

    return { replied: true, handoff: false };
  } catch (error) {
    logger.error({ err: error, conversationId }, 'Erro ao gerar resposta da IA. Fazendo fallback para humano');

    // Em caso de indisponibilidade da IA, nunca deixe o cliente no vácuo: transborda para humano
    await executeHandoff(conversation, HandoffReason.AI_UNAVAILABLE);
    return { replied: false, handoff: true, reason: HandoffReason.AI_UNAVAILABLE };
  }
}

async function executeHandoff(
  conversation: { id: string; orgId: string; contactId: string; channelId: string },
  reason: HandoffReason,
  targetDepartmentName?: string | null,
): Promise<void> {
  let departmentId: string | null = null;

  if (targetDepartmentName) {
    const dept = await prisma.department.findFirst({
      where: {
        orgId: conversation.orgId,
        name: { contains: targetDepartmentName, mode: 'insensitive' },
        isActive: true,
      },
      select: { id: true },
    });
    if (dept) departmentId = dept.id;
  }

  // Se o motivo foi cliente pedindo ou lead aquecido, envia mensagem de aviso
  if (reason === HandoffReason.LEAD_QUALIFIED || reason === HandoffReason.CUSTOMER_REQUESTED) {
    await queueSystemMessage(
      conversation.id,
      'Entendido! Estou transferindo seu atendimento para nossa equipe agora mesmo. Aguarde um instante que um de nossos consultores já irá lhe atender.',
    );
  }

  // Desativa controle da IA na conversa
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { aiControlled: false },
  });

  // Roteia para atendente ou fila
  await routeConversation(conversation.id, {
    reason,
    departmentId,
  });
}
