/**
 * Leitura de medida de pneu a partir de texto livre.
 *
 * POR QUE ISSO E CODIGO, E NAO PROMPT
 *
 * A medida do pneu e o dado mais importante de todo o atendimento: erra a
 * medida, erra o orcamento, erra o estoque e o cliente recebe o pneu errado.
 * Modelos de linguagem pequenos - justamente os que rodam de graca na maquina
 * da loja - sao ruins em extrair dado estruturado e inventam numeros com
 * seguranca. Entao a extracao acontece aqui, de forma deterministica e
 * testavel, e a IA so recebe o resultado ja pronto para conversar.
 *
 * Formas que o cliente realmente usa no WhatsApp:
 *   "205/55R16"    "205/55 r16"   "205 55 16"    "205/55/16"
 *   "2055516"      "175 70 13"    "aro 16"       "205/55R16 91V"
 *   "275/80R22.5"  (caminhao, aro fracionado)
 */

export interface TireSize {
  /** Largura em milimetros. Ex.: 205 */
  width: number;
  /** Perfil / altura em % da largura. Ex.: 55 */
  aspectRatio: number;
  /** Aro em polegadas. Ex.: 16 (ou 22.5 em caminhao) */
  rim: number;
  /** Indice de carga, quando informado. Ex.: 91 */
  loadIndex: number | null;
  /** Indice de velocidade, quando informado. Ex.: "V" */
  speedRating: string | null;
  /** Forma canonica: "205/55 R16" */
  formatted: string;
  /** Chave de busca no catalogo, sem espacos: "205/55R16" */
  key: string;
}

/** Faixas reais de mercado. Fora disso e ruido, nao medida. */
const LIMITS = {
  width: { min: 125, max: 415 },
  aspectRatio: { min: 25, max: 95 },
  rim: { min: 10, max: 24 },
} as const;

/** Aros fracionados usados em caminhao e van. */
const FRACTIONAL_RIMS = new Set([16.5, 17.5, 19.5, 22.5]);

const SPEED_RATINGS = new Set([
  'L', 'M', 'N', 'P', 'Q', 'R', 'S', 'T', 'U', 'H', 'V', 'W', 'Y', 'Z',
]);

function isValidRim(rim: number): boolean {
  if (FRACTIONAL_RIMS.has(rim)) return true;
  return Number.isInteger(rim) && rim >= LIMITS.rim.min && rim <= LIMITS.rim.max;
}

function isValidSize(width: number, aspectRatio: number, rim: number): boolean {
  return (
    width >= LIMITS.width.min &&
    width <= LIMITS.width.max &&
    aspectRatio >= LIMITS.aspectRatio.min &&
    aspectRatio <= LIMITS.aspectRatio.max &&
    isValidRim(rim)
  );
}

function build(
  width: number,
  aspectRatio: number,
  rim: number,
  loadIndex: number | null,
  speedRating: string | null,
): TireSize | null {
  if (!isValidSize(width, aspectRatio, rim)) return null;

  // Aro inteiro sai "16"; fracionado preserva o ".5".
  const rimLabel = Number.isInteger(rim) ? String(rim) : rim.toFixed(1);

  return {
    width,
    aspectRatio,
    rim,
    loadIndex,
    speedRating,
    formatted: `${width}/${aspectRatio} R${rimLabel}`,
    key: `${width}/${aspectRatio}R${rimLabel}`,
  };
}

/**
 * Sufixo de carga/velocidade que pode vir depois da medida ("91V", "91 V").
 * Extraido separadamente porque e opcional e nao pode atrapalhar a medida.
 */
function parseLoadAndSpeed(tail: string): { loadIndex: number | null; speedRating: string | null } {
  const match = /^\s*(\d{2,3})\s*([A-Z])\b/i.exec(tail);
  if (!match) return { loadIndex: null, speedRating: null };

  const loadIndex = Number(match[1]);
  const speedRating = (match[2] ?? '').toUpperCase();

  // Indice de carga real vai de 60 a 130 em pneus de passeio/utilitario.
  if (loadIndex < 60 || loadIndex > 130 || !SPEED_RATINGS.has(speedRating)) {
    return { loadIndex: null, speedRating: null };
  }

  return { loadIndex, speedRating };
}

/**
 * Encontra TODAS as medidas citadas na mensagem.
 * O cliente as vezes manda duas ("tenho 205/55R16 na frente e 225/45R17 atras").
 */
export function extractTireSizes(text: string): TireSize[] {
  if (!text) return [];

  const found: TireSize[] = [];
  const seen = new Set<string>();

  const push = (size: TireSize | null) => {
    if (size && !seen.has(size.key)) {
      seen.add(size.key);
      found.push(size);
    }
  };

  // 1. Formato com separador: 205/55R16, 205-55-16, 205 55 16, 205/55/16.
  //    O separador antes do aro aceita "R" opcional (aro 22.5 tem ponto).
  const separated = /(\d{3})\s*[\/\-\s]\s*(\d{2})\s*[\/\-\s]?\s*R?\s*(\d{2}(?:[.,]5)?)/gi;
  for (const match of text.matchAll(separated)) {
    const width = Number(match[1]);
    const aspectRatio = Number(match[2]);
    const rim = Number((match[3] ?? '').replace(',', '.'));

    const tail = text.slice((match.index ?? 0) + match[0].length);
    const { loadIndex, speedRating } = parseLoadAndSpeed(tail);

    push(build(width, aspectRatio, rim, loadIndex, speedRating));
  }

  // 2. Sete digitos colados: "2055516" -> 205/55 R16.
  //    So aceitamos quando NAO ha digito grudado em volta, para nao recortar
  //    pedaco de telefone ou de CPF.
  for (const match of text.matchAll(/(?<!\d)(\d{7})(?!\d)/g)) {
    const digits = match[1] ?? '';
    push(
      build(
        Number(digits.slice(0, 3)),
        Number(digits.slice(3, 5)),
        Number(digits.slice(5, 7)),
        null,
        null,
      ),
    );
  }

  return found;
}

/** A primeira medida citada, que na pratica e a que o cliente quer. */
export function extractTireSize(text: string): TireSize | null {
  return extractTireSizes(text)[0] ?? null;
}

/**
 * Aro solto ("aro 16", "roda 17"), usado quando o cliente ainda nao sabe a
 * medida completa. Nao serve para orcar, mas ja estreita a conversa.
 */
export function extractRimOnly(text: string): number | null {
  if (!text) return null;

  const match = /\b(?:aro|roda|rodas)\s*(\d{2}(?:[.,]5)?)\b/i.exec(text);
  if (!match) return null;

  const rim = Number((match[1] ?? '').replace(',', '.'));
  return isValidRim(rim) ? rim : null;
}

/** Quantidade de pneus pedida ("2 pneus", "um jogo", "os quatro"). */
export function extractQuantity(text: string): number | null {
  if (!text) return null;
  const lower = text.toLowerCase();

  // "jogo" e "os quatro" significam 4 no vocabulario de borracharia.
  if (/\bjogo\b|\bjogo completo\b|\bos quatro\b|\bas quatro\b/.test(lower)) return 4;
  if (/\bpar\b|\bum par\b/.test(lower)) return 2;

  const written: Record<string, number> = {
    um: 1, uma: 1, dois: 2, duas: 2, tres: 3, 'três': 3, quatro: 4, cinco: 5, seis: 6,
  };

  const writtenMatch = /\b(um|uma|dois|duas|tres|três|quatro|cinco|seis)\s+pneus?\b/i.exec(lower);
  if (writtenMatch) return written[(writtenMatch[1] ?? '').toLowerCase()] ?? null;

  const numericMatch = /\b(\d{1,2})\s*(?:pneus?|un|unidades?)\b/i.exec(lower);
  if (numericMatch) {
    const quantity = Number(numericMatch[1]);
    // Acima de 12 e provavelmente outro numero da frase, nao quantidade.
    if (quantity >= 1 && quantity <= 12) return quantity;
  }

  return null;
}

/** Medida sem o aro: o cliente disse "175/70" e parou ai. */
export interface PartialTireSize {
  width: number;
  aspectRatio: number;
  /** "175/70" - propositalmente SEM aro, para nao induzir a um palpite. */
  formatted: string;
}

/**
 * Detecta medida incompleta (largura e perfil, sem o aro).
 *
 * POR QUE ISSO IMPORTA MAIS DO QUE PARECE
 *
 * "175/70" e uma das formas mais comuns de o cliente responder, e sem tratar
 * esse caso o modelo de linguagem completa o numero sozinho - vimos ele
 * escrever "175/70 R13" quando o cliente nunca disse R13. Isso e pior do que
 * nao entender: o cliente confirma, compra, e recebe o pneu errado.
 *
 * Reconhecendo a medida parcial explicitamente, conseguimos dizer a IA
 * exatamente o que falta e proibir o palpite.
 */
export function extractPartialSize(text: string): PartialTireSize | null {
  if (!text) return null;

  // Se ja existe medida completa, nao ha nada de parcial a tratar.
  if (extractTireSize(text)) return null;

  // Largura/perfil que NAO sao seguidos de um aro.
  const pattern = /(?<!\d)(\d{3})\s*[\/\-]\s*(\d{2})(?!\s*[\/\-]?\s*[rR]?\s*\d)/g;

  for (const match of text.matchAll(pattern)) {
    const width = Number(match[1]);
    const aspectRatio = Number(match[2]);

    if (
      width >= LIMITS.width.min &&
      width <= LIMITS.width.max &&
      aspectRatio >= LIMITS.aspectRatio.min &&
      aspectRatio <= LIMITS.aspectRatio.max
    ) {
      return { width, aspectRatio, formatted: `${width}/${aspectRatio}` };
    }
  }

  return null;
}
