/**
 * Normalizacao de telefone com o tratamento do "nono digito" brasileiro.
 *
 * Por que isso existe: o WhatsApp devolve o `wa_id` de numeros brasileiros
 * antigos SEM o 9 inicial do celular (ex.: 553188887777), enquanto o cliente
 * cadastra o numero COM o 9 (ex.: 5531988887777). Se tratarmos os dois como
 * telefones diferentes, o mesmo cliente vira dois contatos e o historico se
 * parte no meio - que e exatamente o tipo de falha que nao pode acontecer.
 *
 * A solucao: guardamos sempre a forma canonica (COM o 9) e, na hora de
 * procurar um contato, testamos todas as variantes conhecidas.
 */

const BRAZIL_COUNTRY_CODE = '55';

/** DDDs validos no Brasil. Fora desta lista o numero e recusado. */
const VALID_BR_AREA_CODES = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38, 41, 42, 43,
  44, 45, 46, 47, 48, 49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 73, 74, 75, 77,
  79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

export function onlyDigits(value: string): string {
  return value.replace(/\D+/g, '');
}

/**
 * Converte qualquer entrada para E.164 sem o `+` (formato que o WhatsApp usa).
 * Retorna `null` quando o numero e reconhecidamente invalido.
 *
 * Aceita: "(31) 98888-7777", "31988887777", "5531988887777", "+55 31 98888-7777".
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;

  let digits = onlyDigits(input);
  if (digits.length < 8) return null;

  // Trata o prefixo internacional 00 (ex.: 005531988887777).
  if (digits.startsWith('00')) digits = digits.slice(2);

  // Sem codigo de pais: 10 ou 11 digitos (DDD + numero) assume Brasil.
  if (digits.length === 10 || digits.length === 11) {
    const areaCode = Number(digits.slice(0, 2));
    if (VALID_BR_AREA_CODES.has(areaCode)) {
      digits = BRAZIL_COUNTRY_CODE + digits;
    }
  }

  if (digits.startsWith(BRAZIL_COUNTRY_CODE)) {
    return normalizeBrazilian(digits);
  }

  // Numero internacional: aceitamos como veio, apenas checando o tamanho E.164.
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

function normalizeBrazilian(digits: string): string | null {
  const national = digits.slice(BRAZIL_COUNTRY_CODE.length);
  if (national.length !== 10 && national.length !== 11) return null;

  const areaCode = Number(national.slice(0, 2));
  if (!VALID_BR_AREA_CODES.has(areaCode)) return null;

  const subscriber = national.slice(2);

  // 8 digitos comecando em 6-9 e celular antigo: a forma canonica leva o 9.
  if (subscriber.length === 8 && /^[6-9]/.test(subscriber)) {
    return `${BRAZIL_COUNTRY_CODE}${national.slice(0, 2)}9${subscriber}`;
  }

  // 9 digitos precisa comecar com 9 (celular); 8 digitos com 2-5 e fixo.
  if (subscriber.length === 9 && !subscriber.startsWith('9')) return null;

  return digits;
}

/**
 * Todas as formas sob as quais o mesmo telefone pode chegar de um provedor.
 * Use no `WHERE phone IN (...)` ao procurar um contato existente.
 */
export function phoneVariants(phone: string): string[] {
  const canonical = normalizePhone(phone);
  if (!canonical) return [];

  const variants = new Set<string>([canonical]);

  if (canonical.startsWith(BRAZIL_COUNTRY_CODE)) {
    const national = canonical.slice(BRAZIL_COUNTRY_CODE.length);
    const areaCode = national.slice(0, 2);
    const subscriber = national.slice(2);

    // Variante sem o nono digito, que e como o WhatsApp entrega numeros antigos.
    if (subscriber.length === 9 && subscriber.startsWith('9')) {
      variants.add(`${BRAZIL_COUNTRY_CODE}${areaCode}${subscriber.slice(1)}`);
    }
    if (subscriber.length === 8) {
      variants.add(`${BRAZIL_COUNTRY_CODE}${areaCode}9${subscriber}`);
    }
  }

  return [...variants];
}

/** Formata para exibicao: "+55 (31) 98888-7777". */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const digits = onlyDigits(phone);

  if (digits.startsWith(BRAZIL_COUNTRY_CODE) && (digits.length === 12 || digits.length === 13)) {
    const areaCode = digits.slice(2, 4);
    const subscriber = digits.slice(4);
    const half = subscriber.length === 9 ? 5 : 4;
    return `+55 (${areaCode}) ${subscriber.slice(0, half)}-${subscriber.slice(half)}`;
  }

  return `+${digits}`;
}

export function isValidPhone(input: string | null | undefined): boolean {
  return normalizePhone(input) !== null;
}
