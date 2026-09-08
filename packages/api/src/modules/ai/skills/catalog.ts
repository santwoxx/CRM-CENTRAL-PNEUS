import { prisma } from '../../../db/prisma.js';
import type { TireSize } from './tireSize.js';

/**
 * Consulta ao catalogo da loja.
 *
 * Serve a IA com FATOS do banco em vez de deixa-la inventar. Um modelo de
 * linguagem sem dados reais responde preco errado com total confianca - e no
 * ramo de pneus isso vira cliente na loja cobrando um preco que nao existe.
 * Aqui todo numero que a IA fala saiu daqui.
 */

export interface TireOffer {
  id: string;
  brand: string;
  model: string;
  sizeKey: string;
  category: string;
  priceCents: number;
  promoPriceCents: number | null;
  /** Preco que vale hoje: promocional se houver, senao o cheio. */
  effectivePriceCents: number;
  stockQuantity: number;
  warrantyMonths: number;
}

export interface ServiceOffer {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  priceCents: number;
  durationMinutes: number;
}

/**
 * Formata centavos como moeda brasileira. Nunca usar float para dinheiro.
 *
 * O `replace` no final nao e capricho: o Intl separa "R$" do valor com um
 * espaco NAO-SEPARAVEL (U+00A0), invisivel a olho nu. Ele atravessa o
 * prompt da IA, o log e a mensagem do WhatsApp, quebra qualquer comparacao
 * de texto e aparece como caractere estranho em clientes mais antigos.
 * Trocamos por espaco comum para o valor ser sempre previsivel.
 */
export function formatBRL(cents: number): string {
  return (cents / 100)
    .toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 2,
    })
    .replace(/ /g, ' ');
}

function toOffer(product: {
  id: string;
  brand: string;
  model: string;
  sizeKey: string;
  category: string;
  priceCents: number;
  promoPriceCents: number | null;
  stockQuantity: number;
  warrantyMonths: number;
}): TireOffer {
  return {
    ...product,
    effectivePriceCents: product.promoPriceCents ?? product.priceCents,
  };
}

const OFFER_SELECT = {
  id: true,
  brand: true,
  model: true,
  sizeKey: true,
  category: true,
  priceCents: true,
  promoPriceCents: true,
  stockQuantity: true,
  warrantyMonths: true,
} as const;

/**
 * Pneus disponiveis na medida pedida.
 * Ordena pelo mais barato: e a primeira pergunta do cliente em 9 de 10 casos.
 */
export async function findTiresBySize(
  orgId: string,
  size: TireSize,
  options: { limit?: number; onlyInStock?: boolean } = {},
): Promise<TireOffer[]> {
  const products = await prisma.tireProduct.findMany({
    where: {
      orgId,
      sizeKey: size.key,
      isActive: true,
      ...(options.onlyInStock === false ? {} : { stockQuantity: { gt: 0 } }),
    },
    select: OFFER_SELECT,
    orderBy: [{ promoPriceCents: 'asc' }, { priceCents: 'asc' }],
    take: options.limit ?? 5,
  });

  return products.map(toOffer);
}

/** Alternativas no mesmo aro, quando a medida exata acabou no estoque. */
export async function findTiresByRim(
  orgId: string,
  rim: number,
  options: { limit?: number } = {},
): Promise<TireOffer[]> {
  const products = await prisma.tireProduct.findMany({
    where: { orgId, rim, isActive: true, stockQuantity: { gt: 0 } },
    select: OFFER_SELECT,
    orderBy: [{ priceCents: 'asc' }],
    take: options.limit ?? 5,
  });

  return products.map(toOffer);
}

export async function findServices(orgId: string, limit = 8): Promise<ServiceOffer[]> {
  return prisma.serviceItem.findMany({
    where: { orgId, isActive: true },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      priceCents: true,
      durationMinutes: true,
    },
    orderBy: { priceCents: 'asc' },
    take: limit,
  });
}

/** Linha curta de oferta, no formato que cabe numa mensagem de WhatsApp. */
export function describeOffer(offer: TireOffer, quantity = 1): string {
  const unit = offer.effectivePriceCents;
  const promo = offer.promoPriceCents !== null ? ' (promocao)' : '';
  const total =
    quantity > 1 ? ` | ${quantity} un: ${formatBRL(unit * quantity)}` : '';

  return (
    `${offer.brand} ${offer.model} ${offer.sizeKey} - ${formatBRL(unit)}${promo}` +
    `${total} | estoque: ${offer.stockQuantity} | garantia ${offer.warrantyMonths} meses`
  );
}
