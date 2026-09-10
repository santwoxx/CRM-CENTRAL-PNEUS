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
  resolvePersonaProvider,
  type AiMessageInput,
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
      content: [
        persona.systemPrompt,
        '',
        `Cliente: ${conversation.contact.name || conversation.contact.pushName || 'sem nome'}`,
        warmth.summary !== 'Cliente colhendo informações iniciais.'
          ? `Já sabemos: ${warmth.summary}. NÃO pergunte isso de novo.`
          : '',
        shop.contextBlock ? `
DADOS REAIS DA LOJA (única fonte de números):
${shop.contextBlock}` : '',
        !shop.contextBlock
          ? 'Sem dados da loja nesta mensagem: não cite preço, marca nem estoque.'
          : '',
        '',
        // A instrucao de encerrar vem por ultimo: e a ultima coisa que o
        // modelo le e a que mais pesa na resposta.
        shop.readyForHandoff || warmth.isWarm
          ? 'AGORA ENCERRE: responda o que foi perguntado e avise em UMA frase que vai chamar um consultor. Não faça mais perguntas.'
          : 'Falta informação. Faça UMA pergunta curta — a mais útil de todas.',
      ]
        .filter(Boolean)
        .join('\n'),
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
    // A persona guarda uma PREFERENCIA de provedor; se ela nao estiver
    // configurada nesta instalacao, caimos para o provedor do .env em vez de
    // derrubar a conversa para a fila humana.
    const escolha = resolvePersonaProvider(persona.provider, persona.model);

    const aiResult = await generateCompletion(aiMessages, {
      ...escolha,
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
    if (warmth.isWarm || shop.readyForHandoff) {
      logger.info(
        { conversationId, score: warmth.score, readyForHandoff: shop.readyForHandoff },
        'Lead pronto para atendimento humano: transferindo',
      );
      await executeHandoff(conversation, HandoffReason.LEAD_QUALIFIED, null, true);
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
  /** true quando a IA acabou de responder e ja avisou o cliente. */
  silent = false,
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

  /**
   * Aviso de transferencia.
   *
   * Enviado apenas quando a IA nao respondeu nada agora - ou seja, quando o
   * transbordo veio de um gatilho direto, sem passar pelo modelo. Quando a
   * IA responde, ela mesma ja avisa que vai chamar um consultor; somar esta
   * mensagem produzia duas frases seguidas dizendo a mesma coisa, e a da
   * fila logo depois virava a terceira.
   */
  if (
    !silent &&
    (reason === HandoffReason.CUSTOMER_REQUESTED ||
      reason === HandoffReason.MENU_SELECTION ||
      // Cliente sem saber a medida: a IA nao respondeu, entao o aviso e dela.
      reason === HandoffReason.AI_UNCERTAIN)
  ) {
    const aviso =
      reason === HandoffReason.AI_UNCERTAIN
        ? 'Sem problema! Um consultor identifica a medida certa pra você rapidinho. Já estou chamando. 👍'
        : 'Certo! Já estou chamando um consultor. 👍';
    await queueSystemMessage(conversation.id, aviso);
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
