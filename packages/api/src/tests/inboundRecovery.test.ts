import { Prisma } from '@prisma/client';
import { WebhookEventStatus } from '@crm/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  findUnique: vi.fn(),
  findMany: vi.fn(),
  enqueueInbound: vi.fn(),
}));

vi.mock('../db/prisma.js', () => ({
  Prisma,
  prisma: {
    webhookEvent: {
      create: mocks.create,
      findUnique: mocks.findUnique,
      findMany: mocks.findMany,
    },
  },
}));

vi.mock('../queue/queues.js', () => ({ enqueueInbound: mocks.enqueueInbound }));

vi.mock('../channels/registry.js', () => ({
  parseWebhookPayload: () => [
    {
      kind: 'message',
      message: {
        externalId: 'provider-1',
        from: '5531999999999',
        phone: '5531999999999',
        pushName: 'Cliente',
        timestamp: new Date('2026-09-11T12:00:00Z'),
        type: 'TEXT',
        content: 'Oi',
      },
    },
  ],
  eventExternalId: () => 'msg:provider-1',
}));

const { ingestWebhook, sweepInbound } = await import('../modules/messages/inbound.js');

function duplicateError() {
  return new Prisma.PrismaClientKnownRequestError('duplicado', {
    code: 'P2002',
    clientVersion: '6.19.0',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('recuperacao da fila de entrada', () => {
  it('reenfileira uma reentrega cujo registro ficou salvo sem job', async () => {
    mocks.create.mockRejectedValueOnce(duplicateError());
    mocks.findUnique.mockResolvedValueOnce({
      id: 'evento-1',
      status: WebhookEventStatus.RECEIVED,
    });

    const result = await ingestWebhook('canal-1', 'WHATSAPP_CLOUD' as never, {});

    expect(result.duplicated).toBe(1);
    expect(mocks.enqueueInbound).toHaveBeenCalledWith({
      webhookEventId: 'evento-1',
      channelId: 'canal-1',
    });
  });

  it('nao recria job para evento que ja terminou', async () => {
    mocks.create.mockRejectedValueOnce(duplicateError());
    mocks.findUnique.mockResolvedValueOnce({
      id: 'evento-1',
      status: WebhookEventStatus.PROCESSED,
    });

    await ingestWebhook('canal-1', 'WHATSAPP_CLOUD' as never, {});
    expect(mocks.enqueueInbound).not.toHaveBeenCalled();
  });

  it('varre eventos presos depois de uma indisponibilidade', async () => {
    mocks.findMany.mockResolvedValueOnce([
      { id: 'evento-1', channelId: 'canal-1' },
      { id: 'evento-2', channelId: 'canal-2' },
    ]);

    await expect(sweepInbound()).resolves.toBe(2);
    expect(mocks.enqueueInbound).toHaveBeenCalledTimes(2);
  });
});
