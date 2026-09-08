import { logger } from '../../../lib/logger.js';
import { describeOffer, findServices, findTiresByRim, findTiresBySize, formatBRL } from './catalog.js';
import { ShopIntent, detectIntent, extractVehicle } from './intent.js';
import { extractQuantity, extractRimOnly, extractTireSize, type TireSize } from './tireSize.js';

export * from './tireSize.js';
export * from './intent.js';
export * from './catalog.js';

/**
 * Pacote de skills da loja de pneus.
 *
 * A ideia central: em vez de pedir para a IA "usar ferramentas" (que modelos
 * pequenos e gratuitos executam mal), o codigo LE a mensagem, BUSCA os fatos
 * no banco e ENTREGA tudo pronto no prompt. A IA fica com a unica tarefa em
 * que ela e boa de verdade: escrever uma resposta natural em portugues.
 *
 * Resultado pratico: preco, estoque e medida saem sempre do banco. O modelo
 * pode escrever mal uma frase, mas nao consegue inventar um preco.
 */

export interface ShopSkillResult {
  intent: ShopIntent;
  size: TireSize | null;
  rim: number | null;
  quantity: number | null;
  vehicle: string | null;
  /** Bloco de fatos para injetar no prompt. Vazio quando nada se aplica. */
  contextBlock: string;
  /** Dados estruturados para gravar na conversa e o vendedor ja ver na tela. */
  facts: Record<string, unknown>;
  /** true quando ja temos o suficiente para um vendedor assumir com contexto. */
  readyForHandoff: boolean;
}

export async function buildShopContext(
  orgId: string,
  text: string,
): Promise<ShopSkillResult> {
  let intent = detectIntent(text);
  const size = extractTireSize(text);

  // Uma medida de pneu na mensagem JA E um pedido de orcamento, mesmo que a
  // frase nao diga "pneu" nem "preco" - "quero um jogo de 195/65R15" e o
  // caso tipico. Sem isto a conversa caia em OTHER e o cliente nao recebia a
  // tabela de precos que o codigo ja tinha buscado.
  if (size && (intent === ShopIntent.OTHER || intent === ShopIntent.GREETING)) {
    intent = ShopIntent.TIRE_QUOTE;
  }
  const rim = size ? null : extractRimOnly(text);
  const quantity = extractQuantity(text);
  const vehicle = extractVehicle(text);

  const lines: string[] = [];
  const facts: Record<string, unknown> = {
    intent,
    ...(size ? { tireSize: size.formatted, tireSizeKey: size.key } : {}),
    ...(rim ? { rim } : {}),
    ...(quantity ? { quantity } : {}),
    ...(vehicle ? { vehicle } : {}),
  };

  try {
    if (size) {
      const offers = await findTiresBySize(orgId, size);

      if (offers.length > 0) {
        lines.push(`ESTOQUE REAL para ${size.formatted} (use exatamente estes precos):`);
        for (const offer of offers) lines.push(`- ${describeOffer(offer, quantity ?? 1)}`);

        const cheapest = offers[0];
        if (cheapest && quantity && quantity > 1) {
          lines.push(
            `Total de ${quantity} un. da opcao mais barata: ` +
              `${formatBRL(cheapest.effectivePriceCents * quantity)}.`,
          );
        }

        facts.offersFound = offers.length;
        facts.cheapestPriceCents = cheapest?.effectivePriceCents ?? null;
      } else {
        // Sem estoque na medida exata: oferecemos o mesmo aro em vez de
        // simplesmente dizer "nao temos" e perder a venda.
        lines.push(`SEM ESTOQUE na medida ${size.formatted}.`);

        const alternatives = await findTiresByRim(orgId, size.rim, { limit: 3 });
        if (alternatives.length > 0) {
          lines.push(`Alternativas disponiveis no aro ${size.rim}:`);
          for (const offer of alternatives) lines.push(`- ${describeOffer(offer)}`);
        }
        lines.push(
          'Informe que consultamos com o fornecedor e o vendedor confirma prazo e preco.',
        );
        facts.offersFound = 0;
      }
    } else if (rim) {
      const offers = await findTiresByRim(orgId, rim, { limit: 4 });
      if (offers.length > 0) {
        lines.push(`Opcoes em estoque no aro ${rim}:`);
        for (const offer of offers) lines.push(`- ${describeOffer(offer)}`);
      }
      lines.push(
        'ATENCAO: o cliente informou apenas o aro. Peca a medida completa ' +
          '(ex.: 205/55 R16), que esta na lateral do pneu atual.',
      );
    }

    if (intent === ShopIntent.SERVICE) {
      const services = await findServices(orgId);
      if (services.length > 0) {
        lines.push('TABELA REAL DE SERVICOS (use exatamente estes precos):');
        for (const service of services) {
          lines.push(
            `- ${service.name}: ${formatBRL(service.priceCents)} ` +
              `(~${service.durationMinutes} min)`,
          );
        }
        facts.servicesOffered = services.length;
      }
    }
  } catch (error) {
    // Catalogo indisponivel nao pode derrubar o atendimento: a IA segue sem
    // os fatos e, sem preco em maos, o transbordo para humano resolve.
    logger.error({ err: error, orgId }, 'Falha ao montar contexto do catalogo');
    lines.length = 0;
    lines.push('Catalogo indisponivel no momento: NAO cite precos, transfira para um vendedor.');
  }

  // Pronto para o vendedor assumir quando ja sabemos o que ele quer e para
  // qual medida - o resto o humano fecha melhor que a IA.
  const readyForHandoff =
    (intent === ShopIntent.TIRE_QUOTE && Boolean(size)) ||
    intent === ShopIntent.WARRANTY ||
    intent === ShopIntent.FINANCIAL ||
    (intent === ShopIntent.SERVICE && Boolean(vehicle || size));

  if (vehicle) lines.push(`Veiculo informado pelo cliente: ${vehicle}.`);

  return {
    intent,
    size,
    rim,
    quantity,
    vehicle,
    contextBlock: lines.join('\n'),
    facts,
    readyForHandoff,
  };
}

/** Setor sugerido para cada intencao, usado no transbordo automatico. */
export function departmentSlugForIntent(intent: ShopIntent): string | null {
  switch (intent) {
    case ShopIntent.FINANCIAL:
      return 'financeiro';
    case ShopIntent.WARRANTY:
    case ShopIntent.SERVICE:
      return 'oficina';
    case ShopIntent.TIRE_QUOTE:
      return 'vendas';
    default:
      return null;
  }
}
