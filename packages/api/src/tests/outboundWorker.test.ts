import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageStatus, MessageType } from '@crm/shared';

const findUnique = vi.fn();
const update = vi.fn();
const getAdapter = vi.fn();
const emitMessageStatus = vi.fn();
const readMedia = vi.fn();

const adapter = {
  sendText: vi.fn(),
  sendMedia: vi.fn(),
  sendInteractive: vi.fn(),
  sendTemplate: vi.fn(),
};

vi.mock('../db/prisma.js', () => ({
  prisma: {
    message: {
      findUnique: (...args: unknown[]) => findUnique(...args),
      update: (...args: unknown[]) => update(...args),
    },
  },
}));

vi.mock('../channels/registry.js', () => ({
  getAdapter: (...args: unknown[]) => getAdapter(...args),
}));

vi.mock('../realtime/emitter.js', () => ({
  emitMessageStatus: (...args: unknown[]) => emitMessageStatus(...args),
}));

vi.mock('../modules/media/storage.js', () => ({
  storage: { read: (...args: unknown[]) => readMedia(...args) },
}));

vi.mock('../lib/redis.js', () => ({ createQueueConnection: vi.fn() }));
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { processOutboundMessage } = await import('../queue/workers/outbound.worker.js');

function message(overrides: Record<string, unknown> = {}) {
  return {
    id: 'message-1',
    orgId: 'org-1',
    conversationId: 'conversation-1',
    channelId: 'channel-1',
    type: MessageType.TEXT,
    content: 'Ola!',
    payload: null,
    media: null,
    replyTo: null,
    isPrivate: false,
    allowOptedOutDelivery: false,
    status: MessageStatus.PENDING,
    conversation: {
      id: 'conversation-1',
      orgId: 'org-1',
      departmentId: 'department-1',
      assignedUserId: 'user-1',
      contact: {
        id: 'contact-1',
        phone: '5531999999999',
        isBlocked: false,
        optedOutAt: null,
      },
    },
    ...overrides,
  };
}

function statusUpdates(status: string) {
  return update.mock.calls.filter(
    ([call]) => (call as { data?: { status?: string } }).data?.status === status,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  update.mockResolvedValue({});
  emitMessageStatus.mockResolvedValue(undefined);
  getAdapter.mockResolvedValue(adapter);
  adapter.sendText.mockResolvedValue({ externalId: 'external-text' });
  adapter.sendMedia.mockResolvedValue({ externalId: 'external-media' });
  adapter.sendInteractive.mockResolvedValue({ externalId: 'external-interactive' });
  adapter.sendTemplate.mockResolvedValue({ externalId: 'external-template' });
});

describe('entrega outbound', () => {
  it('envia template pelo adapter e persiste o id retornado pelo provedor', async () => {
    findUnique.mockResolvedValue(
      message({
        type: MessageType.TEMPLATE,
        content: null,
        payload: {
          template: { name: 'retomar_atendimento', language: 'pt_BR', variables: ['Maria'] },
        },
      }),
    );

    await processOutboundMessage('message-1');

    expect(adapter.sendTemplate).toHaveBeenCalledOnce();
    expect(adapter.sendTemplate).toHaveBeenCalledWith({
      to: '5531999999999',
      name: 'retomar_atendimento',
      language: 'pt_BR',
      variables: ['Maria'],
    });
    expect(statusUpdates(MessageStatus.SENT)).toHaveLength(1);
    expect(statusUpdates(MessageStatus.SENT)[0]?.[0]).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({ externalId: 'external-template' }),
      }),
    );
  });

  it('envia menu interativo e preserva a mensagem respondida', async () => {
    findUnique.mockResolvedValue(
      message({
        type: MessageType.INTERACTIVE,
        content: null,
        replyTo: { externalId: 'wamid.original' },
        payload: {
          interactive: {
            body: 'Como podemos ajudar?',
            buttons: [{ id: 'vendas', title: 'Vendas' }],
          },
        },
      }),
    );

    await processOutboundMessage('message-1');

    expect(adapter.sendInteractive).toHaveBeenCalledWith({
      to: '5531999999999',
      body: 'Como podemos ajudar?',
      buttons: [{ id: 'vendas', title: 'Vendas' }],
      replyToExternalId: 'wamid.original',
    });
    expect(statusUpdates(MessageStatus.SENT)).toHaveLength(1);
  });

  it('propaga a referencia da resposta no envio de texto', async () => {
    findUnique.mockResolvedValue(message({ replyTo: { externalId: 'wamid.customer-message' } }));

    await processOutboundMessage('message-1');

    expect(adapter.sendText).toHaveBeenCalledWith({
      to: '5531999999999',
      text: 'Ola!',
      replyToExternalId: 'wamid.customer-message',
    });
  });

  it('marca payload de template invalido como falha sem fingir que enviou', async () => {
    findUnique.mockResolvedValue(
      message({ type: MessageType.TEMPLATE, content: null, payload: null }),
    );

    await expect(processOutboundMessage('message-1')).rejects.toThrow(
      'Mensagem de template sem payload valido',
    );

    expect(adapter.sendTemplate).not.toHaveBeenCalled();
    expect(statusUpdates(MessageStatus.SENT)).toHaveLength(0);
    expect(statusUpdates(MessageStatus.FAILED)).toHaveLength(1);
  });

  it('cancela mensagem pendente quando o cliente pediu opt-out antes da entrega', async () => {
    findUnique.mockResolvedValue(
      message({
        conversation: {
          ...message().conversation,
          contact: { ...message().conversation.contact, optedOutAt: new Date() },
        },
      }),
    );

    await processOutboundMessage('message-1');

    expect(getAdapter).not.toHaveBeenCalled();
    expect(statusUpdates(MessageStatus.FAILED)).toHaveLength(1);
    expect(statusUpdates(MessageStatus.SENT)).toHaveLength(0);
  });

  it('permite somente a confirmacao explicitamente registrada depois do opt-out', async () => {
    findUnique.mockResolvedValue(
      message({
        allowOptedOutDelivery: true,
        conversation: {
          ...message().conversation,
          contact: { ...message().conversation.contact, optedOutAt: new Date() },
        },
      }),
    );

    await processOutboundMessage('message-1');

    expect(adapter.sendText).toHaveBeenCalledOnce();
    expect(statusUpdates(MessageStatus.SENT)).toHaveLength(1);
  });
});
