import { HandoffReason } from '@crm/shared';

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
 * Avalia se as respostas do cliente já contêm dados suficientes para o lead estar AQUECIDO.
 * Por exemplo: medidas de pneus (175/70r13, 205/55/16, aro 16, etc.) e quantidade ou modelo do carro.
 */
export function evaluateLeadWarmth(
  messages: { content: string | null; direction: string }[],
): { isWarm: boolean; summary: string; score: number } {
  const customerTexts = messages
    .filter((m) => m.direction === 'INBOUND' && m.content)
    .map((m) => m.content as string)
    .join(' ');

  const tireSizeRegex = /\b\d{3}\s*[\/\-]?\s*\d{2}\s*[rR]?\s*\d{2}\b/; // ex: 205/55R16 ou 175 70 13
  const rimRegex = /\baro\s*\d{2}\b/i; // ex: aro 15, aro 16
  const quantityRegex = /\b(1|2|3|4|quatro|dois|duas|par|jogo)\s*(pneus?|unidades?)?\b/i;

  let score = 20;
  const features: string[] = [];

  if (tireSizeRegex.test(customerTexts)) {
    score += 40;
    const match = customerTexts.match(tireSizeRegex);
    features.push(`Medida informada: ${match?.[0]}`);
  } else if (rimRegex.test(customerTexts)) {
    score += 25;
    const match = customerTexts.match(rimRegex);
    features.push(`Aro informado: ${match?.[0]}`);
  }

  if (quantityRegex.test(customerTexts)) {
    score += 20;
    features.push('Quantidade/interesse especificado');
  }

  if (customerTexts.length > 50) {
    score += 15;
  }

  const isWarm = score >= 60;
  return {
    isWarm,
    score: Math.min(100, score),
    summary: features.length > 0 ? features.join(', ') : 'Cliente colhendo informações iniciais.',
  };
}
