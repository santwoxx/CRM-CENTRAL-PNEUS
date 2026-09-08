import { PrismaClient, Prisma } from '@prisma/client';
import { env, isProduction } from '../env.js';
import { logger } from '../lib/logger.js';

/**
 * Cliente do banco.
 *
 * Instancia unica por processo. Em desenvolvimento e guardada no globalThis
 * para o hot-reload do tsx nao abrir um pool novo a cada salvar de arquivo -
 * o que esgota as conexoes do Postgres em poucos minutos.
 */

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient(): PrismaClient {
  const client = new PrismaClient({
    datasources: { db: { url: env.DATABASE_URL } },
    log: [
      { emit: 'event', level: 'warn' },
      { emit: 'event', level: 'error' },
      ...(env.LOG_LEVEL === 'debug' || env.LOG_LEVEL === 'trace'
        ? ([{ emit: 'event', level: 'query' }] as const)
        : []),
    ],
  });

  client.$on('warn' as never, (event: Prisma.LogEvent) => {
    logger.warn({ target: event.target }, event.message);
  });
  client.$on('error' as never, (event: Prisma.LogEvent) => {
    logger.error({ target: event.target }, event.message);
  });
  client.$on('query' as never, (event: Prisma.QueryEvent) => {
    // Consultas lentas sao o primeiro sintoma de indice faltando.
    if (event.duration >= 200) {
      logger.warn({ durationMs: event.duration, query: event.query }, 'Consulta lenta');
    } else {
      logger.trace({ durationMs: event.duration }, event.query);
    }
  });

  return client;
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createPrismaClient();

if (!isProduction) globalForPrisma.prisma = prisma;

export { Prisma };
export type { PrismaClient };

/** Cliente ou transacao: use este tipo em qualquer funcao que aceite os dois. */
export type Db = PrismaClient | Prisma.TransactionClient;

/** Codigos de erro do Prisma que valem uma nova tentativa. */
const RETRYABLE_PRISMA_CODES = new Set([
  'P2034', // deadlock / falha de serializacao
  'P1001', // servidor inalcancavel
  'P1002', // timeout de conexao
  'P1017', // conexao fechada pelo servidor
]);

export function isRetryablePrismaError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && RETRYABLE_PRISMA_CODES.has(error.code)
  );
}

/**
 * Transacao com nova tentativa automatica em deadlock.
 *
 * Duas mensagens do mesmo cliente chegando juntas disputam a mesma conversa;
 * sem isso, uma das duas se perde com erro de serializacao.
 */
export async function withTransaction<T>(
  handler: (tx: Prisma.TransactionClient) => Promise<T>,
  options: { maxAttempts?: number; timeoutMs?: number; isolationLevel?: Prisma.TransactionIsolationLevel } = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await prisma.$transaction(handler, {
        timeout: options.timeoutMs ?? 15_000,
        maxWait: 5_000,
        ...(options.isolationLevel ? { isolationLevel: options.isolationLevel } : {}),
      });
    } catch (error) {
      lastError = error;
      if (!isRetryablePrismaError(error) || attempt === maxAttempts) throw error;

      const backoffMs = 50 * 2 ** (attempt - 1) + Math.random() * 50;
      logger.warn({ attempt, backoffMs }, 'Transacao em conflito, tentando novamente');
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  throw lastError;
}

/**
 * Trava de aplicacao do Postgres, serializando uma secao critica entre TODOS
 * os processos (api e workers). Usada no roteamento: sem ela, dois workers
 * atribuem a mesma conversa a dois atendentes diferentes.
 *
 * A trava e liberada no fim da transacao - por isso ela so funciona dentro de
 * uma transacao, e o codigo abaixo garante isso.
 */
export async function withAdvisoryLock<T>(
  key: string,
  handler: (tx: Prisma.TransactionClient) => Promise<T>,
  options: { timeoutMs?: number } = {},
): Promise<T> {
  const lockId = advisoryLockId(key);

  return withTransaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockId}::bigint)`;
    return handler(tx);
  }, { timeoutMs: options.timeoutMs ?? 20_000 });
}

/** Converte uma chave textual num bigint de 64 bits estavel. */
function advisoryLockId(key: string): bigint {
  // FNV-1a de 64 bits: distribuicao boa o suficiente e sem dependencia externa.
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;

  for (let index = 0; index < key.length; index += 1) {
    hash ^= BigInt(key.charCodeAt(index));
    hash = (hash * prime) & mask;
  }

  // Postgres usa bigint com sinal: dobramos para o intervalo valido.
  return BigInt.asIntN(64, hash);
}

export async function checkDatabase(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const startedAt = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}
