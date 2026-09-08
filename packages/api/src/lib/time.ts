import { env } from '../env.js';

/**
 * Tempo e horario comercial.
 *
 * Tudo no banco e UTC. A conversao para o fuso da empresa acontece so aqui,
 * usando o proprio Intl do Node - sem biblioteca de fuso horario para dar
 * manutencao e sem risco de tabela de horario de verao desatualizada.
 */

export interface BusinessHourRange {
  /** 0 = domingo ... 6 = sabado. */
  weekday: number;
  /** "08:00" */
  start: string;
  /** "18:00" */
  end: string;
}

interface LocalParts {
  weekday: number;
  minutes: number;
}

/** Extrai dia da semana e minutos do dia no fuso informado. */
function localParts(date: Date, timeZone: string): LocalParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';

  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };

  const hour = Number(get('hour'));
  return {
    weekday: weekdayMap[get('weekday')] ?? 0,
    // "24" aparece a meia-noite em alguns ambientes; normalizamos para 0.
    minutes: (hour % 24) * 60 + Number(get('minute')),
  };
}

function toMinutes(time: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Verifica se o momento cai dentro do expediente.
 * Sem faixas configuradas, considera 24x7 - um setor sem horario definido
 * nunca deve recusar atendimento por engano.
 */
export function isWithinBusinessHours(
  ranges: BusinessHourRange[] | null | undefined,
  timeZone: string = env.TZ,
  at: Date = new Date(),
): boolean {
  if (!ranges || ranges.length === 0) return true;

  const { weekday, minutes } = localParts(at, timeZone);

  return ranges.some((range) => {
    if (range.weekday !== weekday) return false;

    const start = toMinutes(range.start);
    const end = toMinutes(range.end);
    if (start === null || end === null) return false;

    // Faixa que cruza a meia-noite (ex.: 22:00 - 02:00).
    if (end <= start) return minutes >= start || minutes < end;
    return minutes >= start && minutes < end;
  });
}

/** Valida o JSON de horario vindo do banco antes de usar. */
export function parseBusinessHours(value: unknown): BusinessHourRange[] | null {
  if (!Array.isArray(value)) return null;

  const ranges = value.filter(
    (item): item is BusinessHourRange =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as BusinessHourRange).weekday === 'number' &&
      typeof (item as BusinessHourRange).start === 'string' &&
      typeof (item as BusinessHourRange).end === 'string',
  );

  return ranges.length > 0 ? ranges : null;
}

export const seconds = (value: number) => value * 1_000;
export const minutes = (value: number) => value * 60_000;
export const hours = (value: number) => value * 3_600_000;

export function secondsBetween(from: Date, to: Date = new Date()): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 1_000));
}

/** Fim da janela de 24h do WhatsApp a partir da ultima mensagem do cliente. */
export function whatsappWindowExpiry(lastCustomerMessageAt: Date): Date {
  return new Date(lastCustomerMessageAt.getTime() + 24 * 3_600_000);
}

export function isWindowOpen(windowExpiresAt: Date | null | undefined): boolean {
  return Boolean(windowExpiresAt && windowExpiresAt.getTime() > Date.now());
}
