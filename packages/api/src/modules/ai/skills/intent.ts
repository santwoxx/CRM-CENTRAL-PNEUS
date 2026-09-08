/**
 * Classificacao de intencao por palavra-chave.
 *
 * Deliberadamente simples e deterministica. Nao substitui a IA - ela ainda
 * escreve a resposta. O que isto faz e decidir QUAIS FATOS buscar no banco
 * antes de chamar o modelo, e para isso uma regra explicita e melhor que uma
 * chamada de IA: e instantanea, custa zero e nunca alucina.
 *
 * Tambem sustenta o transbordo imediato: "quero falar com o financeiro" nao
 * pode depender de um modelo local de 7B interpretar certo.
 */

export const ShopIntent = {
  TIRE_QUOTE: 'TIRE_QUOTE',
  SERVICE: 'SERVICE',
  WARRANTY: 'WARRANTY',
  FINANCIAL: 'FINANCIAL',
  HOURS_LOCATION: 'HOURS_LOCATION',
  GREETING: 'GREETING',
  OTHER: 'OTHER',
} as const;
export type ShopIntent = (typeof ShopIntent)[keyof typeof ShopIntent];

interface IntentRule {
  intent: ShopIntent;
  patterns: RegExp[];
}

/**
 * Ordem importa: a primeira regra que casar vence. Garantia e financeiro vem
 * antes de cotacao porque "pneu com bolha" cita "pneu" mas nao e uma venda.
 */
const RULES: IntentRule[] = [
  {
    intent: ShopIntent.WARRANTY,
    patterns: [
      /\bgarantia\b/i,
      /\b(bolhas?|deformad\w*|rach\w*|estour\w*|fur(ou|ado|a)\b|careca)\b/i,
      /\b(defeito|reclama\w*|troca em garantia|veio errado)\b/i,
    ],
  },
  {
    intent: ShopIntent.FINANCIAL,
    patterns: [
      /\b(financeiro|boleto|segunda via|2\?? ?via|nota fiscal|nfe?\b|cobran[cç]a)\b/i,
      /\b(pagamento (n[aã]o )?(consta|caiu)|estorno|reembolso|parcel(a|amento) em aberto)\b/i,
    ],
  },
  {
    intent: ShopIntent.SERVICE,
    patterns: [
      /\b(alinhament\w*|balanceament\w*|cambagem|desempeno|geometria)\b/i,
      /\b(amortecedor\w*|suspens[aã]o|freios?|pastilhas?|discos?|troca de [oó]leo|revis[aã]o)\b/i,
      /\b(agendar|agendamento|hor[aá]rio para|marcar)\b/i,
    ],
  },
  {
    intent: ShopIntent.HOURS_LOCATION,
    patterns: [
      /\b(endere[cç]o|onde (fica|voc[eê]s|e)|localiza[cç][aã]o|como chego|maps)\b/i,
      /\b(que horas|hor[aá]rio de (funcionament|atendiment)|abre|fecha|domingo|s[aá]bado)\b/i,
    ],
  },
  {
    intent: ShopIntent.TIRE_QUOTE,
    patterns: [
      /\bpneu?s?\b/i,
      /\b(or[cç]ament\w*|cota[cç][aã]o|pre[cç]os?|quanto (custa|sai|fica|é|e)|valor(es)?)\b/i,
      /\b(aro|medida|jogo de pneu|remold|recap)\b/i,
    ],
  },
  {
    intent: ShopIntent.GREETING,
    patterns: [
      /^\s*(oi|ol[aá]|bom dia|boa tarde|boa noite|e a[ií]|opa|tudo bem)\W*$/i,
    ],
  },
];

export function detectIntent(text: string): ShopIntent {
  if (!text?.trim()) return ShopIntent.OTHER;

  for (const rule of RULES) {
    if (rule.patterns.some((pattern) => pattern.test(text))) return rule.intent;
  }

  return ShopIntent.OTHER;
}

/** Modelo/marca do veiculo citado, para o vendedor ja abrir a conversa sabendo. */
export function extractVehicle(text: string): string | null {
  if (!text) return null;

  // Lista curta e pratica: os carros que mais aparecem numa loja de pneus no
  // Brasil. Nao precisa ser exaustiva, precisa acertar o caso comum.
  const models = [
    'gol', 'palio', 'uno', 'onix', 'hb20', 'ka', 'fiesta', 'celta', 'siena', 'prisma',
    'corsa', 'fox', 'voyage', 'saveiro', 'strada', 'toro', 'hilux', 'ranger', 's10',
    'amarok', 'civic', 'corolla', 'cruze', 'jetta', 'golf', 'polo', 'virtus', 'tcross',
    't-cross', 'nivus', 'creta', 'renegade', 'compass', 'duster', 'kwid', 'sandero',
    'logan', 'kicks', 'versa', 'march', 'tracker', 'spin', 'cobalt', 'montana',
    'ecosport', 'territory', 'hrv', 'hr-v', 'crv', 'cr-v', 'city', 'fit', 'yaris',
    'etios', 'sw4', 'pajero', 'l200', 'frontier', 'oroch', 'fiorino', 'ducato',
    'sprinter', 'master', 'daily', 'accelo', 'atego', 'constellation',
  ];

  const lower = text.toLowerCase();
  for (const model of models) {
    // \b nao funciona com hifen; delimitamos manualmente.
    const pattern = new RegExp(`(^|[^a-z0-9])${model.replace('-', '[- ]?')}([^a-z0-9]|$)`, 'i');
    if (pattern.test(lower)) return model;
  }

  return null;
}
