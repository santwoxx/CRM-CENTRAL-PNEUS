import { Redis } from 'ioredis';
import type { ServerToClientEvents } from '@crm/shared';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import { env } from '../env.js';

/**
 * Barramento de eventos em tempo real.
 *
 * O problema que ele resolve: os workers (processo separado) precisam empurrar
 * eventos para telas conectadas ao processo da API. Em vez do adaptador Redis
 * do Socket.IO, usamos um canal pub/sub proprio - assim cada instancia da API
 * emite APENAS para os sockets dela, e a mensagem chega uma unica vez em cada
 * tela, mesmo com varias instancias no ar.
 */

const CHANNEL = 'crm:realtime';

export interface RealtimeEnvelope<E extends keyof ServerToClientEvents = keyof ServerToClientEvents> {
  rooms: string[];
  event: E;
  payload: Parameters<ServerToClientEvents[E]>[0];
  /** Socket que originou a acao; usado para nao devolver o eco a ele. */
  originSocketId?: string;
  emittedAt: number;
}

/** Publica um evento para as salas indicadas. Seguro em qualquer processo. */
export async function publishRealtime<E extends keyof ServerToClientEvents>(
  rooms: string | string[],
  event: E,
  payload: Parameters<ServerToClientEvents[E]>[0],
  options: { originSocketId?: string } = {},
): Promise<void> {
  const roomList = (Array.isArray(rooms) ? rooms : [rooms]).filter(Boolean);
  if (roomList.length === 0) return;

  const envelope: RealtimeEnvelope<E> = {
    rooms: [...new Set(roomList)],
    event,
    payload,
    emittedAt: Date.now(),
    ...(options.originSocketId ? { originSocketId: options.originSocketId } : {}),
  };

  try {
    await redis.publish(CHANNEL, JSON.stringify(envelope));
  } catch (error) {
    // Uma tela que nao atualiza e ruim, mas nunca pode derrubar a operacao
    // que estava acontecendo. O proximo refresh corrige a tela.
    logger.error({ err: error, event, rooms: roomList }, 'Falha ao publicar evento de tempo real');
  }
}

type EnvelopeHandler = (envelope: RealtimeEnvelope) => void;

let subscriber: Redis | null = null;

/** Assina o barramento. Chamado apenas pelo processo que serve WebSocket. */
export async function subscribeRealtime(handler: EnvelopeHandler): Promise<void> {
  if (subscriber) return;

  subscriber = new Redis(env.REDIS_URL, {
    connectionName: 'crm:realtime-sub',
    retryStrategy: (attempt) => Math.min(attempt * 200, 3_000),
  });

  subscriber.on('error', (error) => {
    logger.error({ err: error }, 'Erro no assinante do barramento de tempo real');
  });

  subscriber.on('message', (channel, raw) => {
    if (channel !== CHANNEL) return;
    try {
      handler(JSON.parse(raw) as RealtimeEnvelope);
    } catch (error) {
      logger.error({ err: error }, 'Envelope de tempo real invalido');
    }
  });

  await subscriber.subscribe(CHANNEL);
  logger.info('Barramento de tempo real assinado');
}

export async function unsubscribeRealtime(): Promise<void> {
  if (!subscriber) return;
  await subscriber.quit().catch(() => undefined);
  subscriber = null;
}
