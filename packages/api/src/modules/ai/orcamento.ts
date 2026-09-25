import { prisma } from '../../db/prisma.js';
import { env } from '../../env.js';

/**
 * Teto mensal de gasto com IA.
 *
 * AI_MONTHLY_BUDGET_USD existia na configuracao e nao era lido por ninguem:
 * quem definia um limite achava estar protegido e nao estava. Numa operacao
 * que usa a OpenAI como reserva, isso e a diferenca entre uma conta de cinco
 * dolares e uma surpresa no fim do mes.
 *
 * O teto NAO desliga o atendimento. Ao ser atingido, a cadeia passa a usar
 * somente os provedores gratuitos; se nenhum estiver disponivel, a conversa
 * vai para um atendente humano, como em qualquer outra falha da IA. Parar de
 * gastar nunca pode virar parar de atender.
 *
 * Provedor gratuito registra custo zero, entao o total aqui e, por
 * construcao, apenas o que foi efetivamente pago.
 */

/** Primeiro instante do mes corrente, no fuso do servidor (TZ do container). */
export function inicioDoMes(agora: Date): Date {
  return new Date(agora.getFullYear(), agora.getMonth(), 1, 0, 0, 0, 0);
}

/** Teto zero (ou ausente) significa "sem teto", nao "nao pode gastar nada". */
export function estourouOTeto(gastoUsd: number, tetoUsd: number): boolean {
  if (!Number.isFinite(tetoUsd) || tetoUsd <= 0) return false;
  return gastoUsd >= tetoUsd;
}

export async function gastoDoMesUsd(orgId: string, agora = new Date()): Promise<number> {
  const total = await prisma.aiUsage.aggregate({
    _sum: { costUsd: true },
    where: { orgId, createdAt: { gte: inicioDoMes(agora) } },
  });

  return total._sum.costUsd ?? 0;
}

/**
 * Se true, esta conversa deve ser atendida somente por provedor gratuito.
 *
 * Uma falha ao consultar o gasto nao pode travar o atendimento: nesse caso
 * seguimos como antes e o registro fica no log.
 */
export async function apenasProvedoresGratuitos(orgId: string): Promise<boolean> {
  const gasto = await gastoDoMesUsd(orgId);
  return estourouOTeto(gasto, env.AI_MONTHLY_BUDGET_USD);
}
