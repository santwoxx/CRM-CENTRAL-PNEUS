import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Com camada gratuita, a cota acaba no meio do dia e sem aviso. Sem cadeia de
 * provedores, a conversa em andamento morre e o cliente fica sem resposta.
 * Estes testes garantem que o proximo da fila assume - e que ele NAO assume
 * quando o erro seria o mesmo em qualquer provedor.
 */

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

vi.mock('../env.js', () => ({
  env: {
    // Campos que o logger le na inicializacao do modulo.
    LOG_LEVEL: 'silent',
    ROLE: 'api',
    NODE_ENV: 'test',
    AI_ENABLED: true,
    AI_PROVIDER: 'groq',
    AI_PROVIDER_CHAIN: 'groq,openai,ollama',
    AI_TEMPERATURE: 0.4,
    AI_MAX_OUTPUT_TOKENS: 220,
    GROQ_API_KEY: 'chave-groq',
    GROQ_CHAT_MODEL: 'llama-3.3-70b-versatile',
    GROQ_ANALYSIS_MODEL: '',
    OPENAI_API_KEY: 'chave-openai',
    OPENAI_CHAT_MODEL: 'gpt-4.1-mini',
    OPENAI_ANALYSIS_MODEL: '',
    OLLAMA_BASE_URL: 'http://localhost:11434/v1',
    OLLAMA_CHAT_MODEL: 'qwen2.5:7b-instruct',
    OLLAMA_ANALYSIS_MODEL: '',
    LMSTUDIO_BASE_URL: '', LMSTUDIO_CHAT_MODEL: '',
    GOOGLE_API_KEY: '', GOOGLE_CHAT_MODEL: '', GOOGLE_ANALYSIS_MODEL: '',
    OPENROUTER_API_KEY: '', OPENROUTER_CHAT_MODEL: '',
    ANTHROPIC_API_KEY: '', ANTHROPIC_CHAT_MODEL: '', ANTHROPIC_ANALYSIS_MODEL: '',
    PUBLIC_API_URL: 'http://localhost:3333',
  },
  isProduction: false,
}));

const { generateCompletion } = await import('../modules/ai/provider.js');

const MENSAGENS = [{ role: 'user' as const, content: 'oi' }];

function resposta(texto: string) {
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { content: texto } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }),
    text: async () => '',
  };
}

function falha(status: number, mensagem: string) {
  return {
    ok: false,
    status,
    json: async () => ({ error: { message: mensagem } }),
    text: async () => JSON.stringify({ error: { message: mensagem } }),
  };
}

beforeEach(() => fetchMock.mockReset());

describe('cadeia de provedores de IA', () => {
  it('usa o primeiro quando ele responde', async () => {
    fetchMock.mockResolvedValueOnce(resposta('tudo certo'));

    const r = await generateCompletion(MENSAGENS);

    expect(r.provider).toBe('groq');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('passa para o pago quando a cota gratuita estoura', async () => {
    fetchMock
      .mockResolvedValueOnce(falha(429, 'rate limit exceeded'))
      .mockResolvedValueOnce(resposta('respondido pelo reserva'));

    const r = await generateCompletion(MENSAGENS);

    expect(r.provider).toBe('openai');
    expect(r.content).toBe('respondido pelo reserva');
  });

  it('passa adiante quando o credito acaba', async () => {
    fetchMock
      .mockResolvedValueOnce(falha(429, 'quota'))
      .mockResolvedValueOnce(falha(402, 'insufficient credits'))
      .mockResolvedValueOnce(resposta('local assumiu'));

    const r = await generateCompletion(MENSAGENS);

    expect(r.provider).toBe('ollama');
    expect(r.free).toBe(true);
  });

  it('passa adiante quando a chave e recusada', async () => {
    fetchMock
      .mockResolvedValueOnce(falha(401, 'invalid api key'))
      .mockResolvedValueOnce(resposta('reserva'));

    expect((await generateCompletion(MENSAGENS)).provider).toBe('openai');
  });

  it('desiste quando todos falham, sem mascarar o erro', async () => {
    fetchMock
      .mockResolvedValueOnce(falha(429, 'a'))
      .mockResolvedValueOnce(falha(429, 'b'))
      .mockResolvedValueOnce(falha(429, 'c'));

    await expect(generateCompletion(MENSAGENS)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('nao gasta a cota do proximo quando o erro seria o mesmo em todos', async () => {
    // 400 e requisicao malformada: trocar de provedor nao conserta nada.
    fetchMock.mockResolvedValueOnce(falha(400, 'invalid request'));

    await expect(generateCompletion(MENSAGENS)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
