import { Redis, type RedisOptions } from 'ioredis';
import { env } from '../env.js';
import { logger } from './logger.js';

/**
 * Conexoes Redis.
 *
 * Precisamos de conexoes separadas por proposito porque uma conexao em modo
 * subscribe nao aceita mais nenhum comando. Sao tres papeis:
 *   - `redis`      : comandos gerais (cache, presenca, contadores)
 *   - `bullmq`     : filas (exige maxRetriesPerRequest: null)
 *   - `pub` / `sub`: adaptador do Socket.IO entre processos
 */

const baseOptions: RedisOptions = {
  lazyConnect: false,
  enableReadyCheck: true,
  // Reconexao com espera crescente ate 3s; nunca desiste.
  retryStrategy: (attempt) => Math.min(attempt * 200, 3_000),
  reconnectOnError: (error) => {
    // READONLY acontece em failover: reconectar resolve.
    if (error.message.includes('READONLY')) return 2;
    return false;
  },
};

function createConnection(name: string, options: RedisOptions = {}): Redis {
  const connection = new Redis(env.REDIS_URL, { ...baseOptions, ...options, connectionName: name });

  connection.on('error', (error) => {
    logger.error({ err: error, connection: name }, 'Erro na conexao Redis');
  });
  connection.on('reconnecting', () => {
    logger.warn({ connection: name }, 'Reconectando ao Redis');
  });
  connection.on('ready', () => {
    logger.debug({ connection: name }, 'Redis pronto');
  });

  return connection;
}

export const redis: Redis = createConnection('crm:general');

/**
 * Conexao dedicada ao BullMQ.
 * `maxRetriesPerRequest: null` e exigencia da biblioteca: com um numero finito,
 * um blip de rede mata o worker em vez de faze-lo esperar a reconexao.
 */
export function createQueueConnection(name: string): Redis {
  return createConnection(name, { maxRetriesPerRequest: null, enableReadyCheck: false });
}

let pubClient: Redis | null = null;
let subClient: Redis | null = null;

/** Par pub/sub do adaptador do Socket.IO. Criado sob demanda. */
export function getPubSubClients(): { pub: Redis; sub: Redis } {
  pubClient ??= createConnection('crm:socket-pub');
  subClient ??= pubClient.duplicate({ connectionName: 'crm:socket-sub' });
  return { pub: pubClient, sub: subClient };
}

export async function checkRedis(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const startedAt = Date.now();
  try {
    const reply = await redis.ping();
    return { ok: reply === 'PONG', latencyMs: Date.now() - startedAt };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function disconnectRedis(): Promise<void> {
  const connections = [redis, pubClient, subClient].filter(Boolean) as Redis[];
  await Promise.allSettled(connections.map((connection) => connection.quit()));
}

// --- Utilitarios -----------------------------------------------------------

/**
 * Trava distribuida simples (SET NX PX).
 *
 * Para secoes criticas curtas fora do banco. Quando a secao critica mexe em
 * dados, prefira `withAdvisoryLock`, que amarra a trava a transacao.
 */
export async function acquireLock(key: string, ttlMs: number): Promise<string | null> {
  const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const result = await redis.set(`lock:${key}`, token, 'PX', ttlMs, 'NX');
  return result === 'OK' ? token : null;
}

/** Libera a trava apenas se ainda for nossa (evita liberar a trava de outro). */
export async function releaseLock(key: string, token: string): Promise<boolean> {
  const script = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end`;
  const released = await redis.eval(script, 1, `lock:${key}`, token);
  return released === 1;
}

export async function withLock<T>(
  key: string,
  ttlMs: number,
  handler: () => Promise<T>,
): Promise<T | null> {
  const token = await acquireLock(key, ttlMs);
  if (!token) return null;

  try {
    return await handler();
  } finally {
    await releaseLock(key, token).catch((error) => {
      logger.warn({ err: error, key }, 'Falha ao liberar trava');
    });
  }
}
