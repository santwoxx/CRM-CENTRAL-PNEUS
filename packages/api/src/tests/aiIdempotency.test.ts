import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationStatus } from '@crm/shared';

const findReply = vi.fn();
const findConversation = vi.fn();
const createUsage = vi.fn();
const updateConversation = vi.fn();
const queueAiMessage = vi.fn();
const generateCompletion = vi.fn();

vi.mock('../env.js', () => ({ env: { AI_ENABLED: true } }));
vi.mock('../db/prisma.js', () => ({
  prisma: {
    message: { findFirst: (...args: unknown[]) => findReply(...args) },
    conversation: {
      findUnique: (...args: unknown[]) => findConversation(...args),
      update: (...args: unknown[]) => updateConversation(...args),
    },
    aiUsage: {
      create: (...args: unknown[]) => createUsage(...args),
      // Consulta do teto mensal de gasto: sem gasto no mes.
      aggregate: vi.fn(async () => ({ _sum: { costUsd: 0 } })),
    },
    department: { findFirst: vi.fn() },
  },
}));
vi.mock('../lib/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../modules/messages/outbox.js', () => ({
  queueAiMessage: (...args: unknown[]) => queueAiMessage(...args),
  queueSystemMessage: vi.fn(),
}));
vi.mock('../modules/routing/router.js', () => ({ routeConversation: vi.fn() }));
vi.mock('../modules/ai/provider.js', () => ({
  resolvePersonaProvider: vi.fn(() => ({ provider: 'OPENAI', model: 'test-model' })),
  generateCompletion: (...args: unknown[]) => generateCompletion(...args),
}));
vi.mock('../modules/ai/persona.js', () => ({
  getActivePersona: vi.fn(async () => ({
    systemPrompt: 'Ajude o cliente.',
    maxTurnsBeforeHandoff: 10,
    provider: 'OPENAI',
    model: 'test-model',
    temperature: 0,
    maxTokens: 100,
  })),
}));
vi.mock('../modules/ai/evaluator.js', () => ({
  evaluateFastTriggers: vi.fn(() => null),
  evaluateLeadWarmth: vi.fn(() => ({
    summary: 'Cliente colhendo informações iniciais.',
    score: 10,
    isWarm: false,
  })),
}));
vi.mock('../modules/ai/skills/index.js', () => ({
  buildShopContext: vi.fn(async () => ({
    contextBlock: '',
    readyForHandoff: false,
    intent: 'OTHER',
    facts: {},
  })),
}));

const { generateAiReply } = await import('../modules/ai/service.js');

beforeEach(() => {
  vi.clearAllMocks();
  findReply.mockResolvedValue(null);
  findConversation.mockResolvedValue({
    id: 'conversation-1',
    orgId: 'org-1',
    contactId: 'contact-1',
    channelId: 'channel-1',
    aiControlled: true,
    status: ConversationStatus.BOT,
    aiTurnCount: 0,
    metadata: {},
    contact: { name: 'Maria', pushName: null },
    channel: {},
    department: null,
    messages: [{ senderType: 'CONTACT', direction: 'INBOUND', content: 'Ola' }],
  });
  generateCompletion.mockResolvedValue({
    content: 'Como posso ajudar?',
    provider: 'OPENAI',
    model: 'test-model',
    inputTokens: 10,
    outputTokens: 5,
    cachedTokens: 0,
    costUsd: 0,
    latencyMs: 20,
  });
  queueAiMessage.mockResolvedValue({ messageId: 'reply-1', duplicated: false });
  createUsage.mockResolvedValue({});
  updateConversation.mockResolvedValue({});
});

describe('idempotencia da resposta da IA', () => {
  it('nao chama o modelo novamente quando o trigger ja tem resposta', async () => {
    findReply.mockResolvedValue({ id: 'reply-existing' });

    const result = await generateAiReply('conversation-1', 'trigger-1');

    expect(findReply).toHaveBeenCalledWith({
      where: {
        conversationId: 'conversation-1',
        clientMessageId: 'ai-reply:trigger-1',
      },
      select: { id: true },
    });
    expect(generateCompletion).not.toHaveBeenCalled();
    expect(queueAiMessage).not.toHaveBeenCalled();
    expect(result).toEqual({ replied: true, handoff: false });
  });

  it('grava a resposta com chave deterministica baseada no trigger', async () => {
    await generateAiReply('conversation-1', 'trigger-2');

    expect(queueAiMessage).toHaveBeenCalledWith('conversation-1', 'Como posso ajudar?', {
      clientMessageId: 'ai-reply:trigger-2',
    });
    expect(createUsage).toHaveBeenCalledOnce();
    expect(updateConversation).toHaveBeenCalledOnce();
  });
});
