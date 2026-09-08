import { Queue, type JobsOptions, type QueueOptions } from 'bullmq';
import { createQueueConnection } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import { env } from '../env.js';
import {
  MaintenanceTask,
  QueueName,
  type AiJobData,
  type InboundJobData,
  type JobDataMap,
  type MaintenanceJobData,
  type MediaJobData,
  type OutboundJobData,
  type RoutingJobData,
} from './jobs.js';

/**
 * Filas.
 *
 * Politica de tentativas por fila, nao global: reenviar uma mensagem ao
 * WhatsApp merece muito mais paciencia do que refazer uma varredura de
 * manutencao que roda de minuto em minuto de qualquer jeito.
 */

const connection = createQueueConnection('crm:queues');

const baseQueueOptions: QueueOptions = {
  connection,
  defaultJobOptions: {
    // Mantemos os concluidos por um tempo para conseguir auditar.
    removeOnComplete: { age: 3_600, count: 1_000 },
    // Os que falharam ficam uma semana: sao a evidencia do que deu errado.
    removeOnFail: { age: 7 * 24 * 3_600 },
  },
};

const RETRY_POLICIES: Record<QueueName, JobsOptions> = {
  [QueueName.INBOUND]: {
    attempts: 8,
    backoff: { type: 'exponential', delay: 1_000 },
  },
  [QueueName.OUTBOUND]: {
    // ~2h de tentativas: cobre uma queda longa da API da Meta sem perder a mensagem.
    attempts: 12,
    backoff: { type: 'exponential', delay: 2_000 },
  },
  [QueueName.AI]: {
    // Se a IA falha 3 vezes, entregamos para um humano em vez de insistir.
    attempts: 3,
    backoff: { type: 'exponential', delay: 2_000 },
  },
  [QueueName.ROUTING]: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 1_000 },
  },
  [QueueName.MEDIA]: {
    attempts: 6,
    backoff: { type: 'exponential', delay: 3_000 },
  },
  [QueueName.MAINTENANCE]: {
    attempts: 2,
    backoff: { type: 'fixed', delay: 5_000 },
  },
};

function createQueue<T extends QueueName>(name: T): Queue<JobDataMap[T]> {
  return new Queue<JobDataMap[T]>(name, {
    ...baseQueueOptions,
    defaultJobOptions: {
      ...baseQueueOptions.defaultJobOptions,
      ...RETRY_POLICIES[name],
    },
  });
}

export const inboundQueue = createQueue(QueueName.INBOUND);
export const outboundQueue = createQueue(QueueName.OUTBOUND);
export const aiQueue = createQueue(QueueName.AI);
export const routingQueue = createQueue(QueueName.ROUTING);
export const mediaQueue = createQueue(QueueName.MEDIA);
export const maintenanceQueue = createQueue(QueueName.MAINTENANCE);

export const allQueues = [
  inboundQueue,
  outboundQueue,
  aiQueue,
  routingQueue,
  mediaQueue,
  maintenanceQueue,
] as const;

// --- Enfileiramento --------------------------------------------------------

export async function enqueueInbound(data: InboundJobData): Promise<void> {
  // jobId = id do evento: reentrega da Meta nao vira job duplicado.
  await inboundQueue.add('process', data, { jobId: `inbound:${data.webhookEventId}` });
}

export async function enqueueOutbound(data: OutboundJobData, delayMs = 0): Promise<void> {
  // jobId = id da mensagem: dois cliques no botao enviam uma mensagem so.
  await outboundQueue.add('send', data, {
    jobId: `outbound:${data.messageId}`,
    ...(delayMs > 0 ? { delay: delayMs } : {}),
  });
}

export async function enqueueAi(data: AiJobData): Promise<void> {
  await aiQueue.add('reply', data, { jobId: `ai:${data.triggerMessageId}` });
}

export async function enqueueRouting(data: RoutingJobData, delayMs = 0): Promise<void> {
  // Sem jobId fixo: a mesma conversa pode precisar ser roteada varias vezes.
  await routingQueue.add('route', data, delayMs > 0 ? { delay: delayMs } : {});
}

export async function enqueueMedia(data: MediaJobData): Promise<void> {
  await mediaQueue.add('download', data, { jobId: `media:${data.messageId}` });
}

export async function enqueueMaintenance(data: MaintenanceJobData): Promise<void> {
  await maintenanceQueue.add(data.task, data);
}

// --- Tarefas recorrentes ---------------------------------------------------

/**
 * Registra os agendamentos. Idempotente: o BullMQ usa o nome como chave, entao
 * subir dez workers nao cria dez agendamentos.
 */
export async function registerRepeatableJobs(): Promise<void> {
  const schedules: { task: MaintenanceTask; everyMs: number }[] = [
    { task: MaintenanceTask.SLA_SWEEP, everyMs: 30_000 },
    { task: MaintenanceTask.QUEUE_ESCALATION, everyMs: 60_000 },
    { task: MaintenanceTask.QUEUE_DRAIN, everyMs: 45_000 },
    { task: MaintenanceTask.AGENT_AUTO_AWAY, everyMs: 60_000 },
    { task: MaintenanceTask.OUTBOX_SWEEP, everyMs: env.OUTBOX_SWEEP_INTERVAL_SECONDS * 1_000 },
    { task: MaintenanceTask.AUTO_CLOSE, everyMs: 5 * 60_000 },
    { task: MaintenanceTask.CHANNEL_HEALTH, everyMs: 2 * 60_000 },
    { task: MaintenanceTask.WEBHOOK_CLEANUP, everyMs: 60 * 60_000 },
    { task: MaintenanceTask.SESSION_CLEANUP, everyMs: 6 * 60 * 60_000 },
  ];

  // Remove agendamentos orfaos de versoes anteriores antes de registrar.
  const existing = await maintenanceQueue.getJobSchedulers();
  const wanted = new Set<string>(schedules.map((schedule) => schedule.task));
  await Promise.all(
    existing
      .filter((scheduler) => !wanted.has(scheduler.key ?? ''))
      .map((scheduler) => maintenanceQueue.removeJobScheduler(scheduler.key)),
  );

  await Promise.all(
    schedules.map((schedule) =>
      maintenanceQueue.upsertJobScheduler(
        schedule.task,
        { every: schedule.everyMs },
        { name: schedule.task, data: { task: schedule.task } },
      ),
    ),
  );

  logger.info({ count: schedules.length }, 'Tarefas recorrentes registradas');
}

// --- Observabilidade -------------------------------------------------------

export interface QueueSnapshot {
  name: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
  paused: boolean;
}

export async function getQueueSnapshots(): Promise<QueueSnapshot[]> {
  return Promise.all(
    allQueues.map(async (queue) => {
      const [counts, paused] = await Promise.all([
        queue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed'),
        queue.isPaused(),
      ]);

      return {
        name: queue.name,
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        delayed: counts.delayed ?? 0,
        failed: counts.failed ?? 0,
        completed: counts.completed ?? 0,
        paused,
      };
    }),
  );
}

export async function closeQueues(): Promise<void> {
  await Promise.allSettled(allQueues.map((queue) => queue.close()));
  await connection.quit().catch(() => undefined);
}
