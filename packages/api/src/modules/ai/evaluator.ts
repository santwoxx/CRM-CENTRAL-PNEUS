import { HandoffReason } from '@crm/shared';
import {
  extractPartialSize,
  extractQuantity,
  extractRimOnly,
  extractTireSize,
} from './skills/tireSize.js';

/**
 * Avaliador de aquecimento do lead e gatilhos de transbordo (Handoff).
 *
 * Combina detecção rápida por heurística (palavras-chave explícitas que não
 * precisam gastar LLM para saber que quer atendente) com avaliação semântica.
 */

export interface LeadEvaluation {
  shouldHandoff: boolean;
  handoffReason?: HandoffReason;
  targetDepartmentName?: 'Comercial' | 'Financeiro' | 'Oficina' | null;
  leadScore: number;
  leadSummary: string | null;
  intent: string | null;
}

export function evaluateFastTriggers(
  lastMessageText: string,
  turnCount: number,
  maxTurns: number,
): LeadEvaluation | null {
  const text = lastMessageText.toLowerCase().trim();

  // Limite de turnos atingido: a IA não pode ficar em loop infinito
  if (turnCount >= maxTurns) {
    return {
      shouldHandoff: true,
      handoffReason: HandoffReason.MAX_TURNS,
      leadScore: 50,
      leadSummary: 'Transbordo automático por limite de interações com a IA.',
      intent: 'Dúvidas gerais',
    };
  }

  // Cliente pedindo explicitamente atendente humano
  const humanTriggers = [
    'atendente',
    'humano',
    'falar com alguém',
    'falar com alguem',
    'pessoa',
    'vendedor',
    'consultor',
    'atendimento humano',
  ];
  if (humanTriggers.some((t) => text.includes(t))) {
    return {
      shouldHandoff: true,
      handoffReason: HandoffReason.CUSTOMER_REQUESTED,
      leadScore: 70,
      leadSummary: 'Cliente solicitou falar com atendente humano.',
      intent: 'Atendimento com consultor',
    };
  }

  // Cliente pedindo Financeiro
  const financeTriggers = ['financeiro', 'boleto', 'nota fiscal', 'pagamento', 'fatura', 'nf-e', 'xml'];
  if (financeTriggers.some((t) => text.includes(t))) {
    return {
      shouldHandoff: true,
      handoffReason: HandoffReason.MENU_SELECTION,
      targetDepartmentName: 'Financeiro',
      leadScore: 80,
      leadSummary: 'Cliente solicitou contato com setor Financeiro.',
      intent: 'Financeiro / Cobrança / Pagamento',
    };
  }

  // Cliente pedindo Oficina / Serviços
  const serviceTriggers = ['agendamento', 'oficina', 'mecânico', 'mecanico', 'alinhar', 'balancear', 'cambagem', 'suspensão', 'suspensao', 'revisão'];
  if (serviceTriggers.some((t) => text.includes(t)) && (text.includes('agendar') || text.includes('marcar') || text.includes('horário'))) {
    return {
      shouldHandoff: true,
      handoffReason: HandoffReason.LEAD_QUALIFIED,
      targetDepartmentName: 'Oficina',
      leadScore: 75,
      leadSummary: 'Cliente interessado em agendar serviços de oficina/mecânica.',
      intent: 'Agendamento de oficina e serviços',
    };
  }

  /**
   * Cliente disse que nao sabe a medida.
   *
   * Sem isto a conversa entrava em laco: a IA explicava de novo onde olhar, o
   * cliente repetia que nao achava, e o atendimento morria ali. Um vendedor
   * identifica a medida em segundos pelo veiculo ou pelo historico de compra.
   * Entregar e mais resolutivo do que insistir.
   */
  const semSaberTriggers = [
    'nao sei',
    'não sei',
    'nao lembro',
    'não lembro',
    'nao faco ideia',
    'não faço ideia',
    'nao consigo ver',
    'não consigo ver',
    'nao acho',
    'não acho',
    'nao entendi',
    'não entendi',
    'nao to achando',
    'não tô achando',
  ];
  if (semSaberTriggers.some((t) => text.includes(t))) {
    return {
      shouldHandoff: true,
      handoffReason: HandoffReason.AI_UNCERTAIN,
      leadScore: 55,
      leadSummary: 'Cliente não sabe a medida do pneu. Precisa de ajuda para identificar.',
      intent: 'Identificação da medida',
    };
  }

  // Sentimento muito negativo / irritação
  const angryTriggers = ['processo', 'procon', 'golpe', 'absurdo', 'péssimo', 'pessimo', 'lixo', 'reclamação', 'reclamacao', 'propaganda enganosa'];
  if (angryTriggers.some((t) => text.includes(t))) {
    return {
      shouldHandoff: true,
      handoffReason: HandoffReason.NEGATIVE_SENTIMENT,
      leadScore: 30,
      leadSummary: 'Cliente com sentimento negativo ou reclamação severa.',
      intent: 'Reclamação urgente',
    };
  }

  return null;
}

/**
 * Decide se o lead ja esta quente o bastante para um humano assumir.
 *
 * A leitura da medida usa o MESMO extrator do resto do sistema. Antes havia
 * uma regex propria aqui, mais frouxa, e as duas discordavam: o extrator
 * oficial recusava "175/70" por falta de aro enquanto esta dava por
 * completa - foi assim que "R13" apareceu num resumo sem ninguem ter dito.
 *
 * O limiar e baixo de proposito. Quem procura pneu no WhatsApp compara preco
 * em tres lojas ao mesmo tempo; cada pergunta a mais da IA e uma chance a
 * mais de o cliente desistir. Tendo a medida, um vendedor fecha melhor.
 */
export function evaluateLeadWarmth(
  messages: { content: string | null; direction: string }[],
): { isWarm: boolean; summary: string; score: number } {
  const customerTexts = messages
    .filter((m) => m.direction === 'INBOUND' && m.content)
    .map((m) => m.content as string)
    .join(' ');

  const size = extractTireSize(customerTexts);
  const partial = size ? null : extractPartialSize(customerTexts);
  const rim = size || partial ? null : extractRimOnly(customerTexts);
  const quantity = extractQuantity(customerTexts);

  let score = 20;
  const features: string[] = [];

  if (size) {
    // Medida completa: nao ha mais o que a IA precise descobrir.
    score += 60;
    features.push(`Medida: ${size.formatted}`);
  } else if (partial) {
    // Falta so o aro. Registramos a medida PARCIAL, sem completar.
    score += 30;
    features.push(`Medida parcial: ${partial.formatted} (falta o aro)`);
  } else if (rim) {
    score += 25;
    features.push(`Aro ${rim}`);
  }

  if (quantity) {
    score += 15;
    features.push(`${quantity} unidade(s)`);
  }

  score = Math.min(100, score);

  return {
    isWarm: score >= 60,
    score,
    summary: features.length > 0 ? features.join(' · ') : 'Cliente colhendo informações iniciais.',
  };
}
