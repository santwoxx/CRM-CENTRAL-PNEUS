import type { Worker } from 'bullmq';
import { logger } from '../../lib/logger.js';
import { createInboundWorker } from './inbound.worker.js';
import { createOutboundWorker } from './outbound.worker.js';
import { createAiWorker } from './ai.worker.js';
import { createRoutingWorker } from './routing.worker.js';
import { createMediaWorker } from './media.worker.js';
import { createMaintenanceWorker } from './maintenance.worker.js';

export interface WorkersInstance {
  workers: Worker[];
  close: () => Promise<void>;
}

export function startWorkers(): WorkersInstance {
  logger.info('Iniciando workers do BullMQ...');

  const workers: Worker[] = [
    createInboundWorker(),
    createOutboundWorker(),
    createAiWorker(),
    createRoutingWorker(),
    createMediaWorker(),
    createMaintenanceWorker(),
  ];

  logger.info({ count: workers.length }, 'Todos os workers iniciados com sucesso');

  return {
    workers,
    close: async () => {
      logger.info('Finalizando workers...');
      await Promise.allSettled(workers.map((w) => w.close()));
      logger.info('Todos os workers finalizados');
    },
  };
}
