import { env } from '../../env.js';
import { logger } from '../../lib/logger.js';
import { ProviderError } from '../../lib/errors.js';

/**
 * Provedor de IA plugavel - priorizando custo ZERO.
 *
 * A descoberta que simplifica tudo: Ollama, LM Studio, Groq, Google Gemini e
 * OpenRouter expoem o MESMO formato de API do OpenAI (`/chat/completions`).
 * Entao um unico caminho de codigo atende todos - o que muda e a URL base, a
 * chave e o nome do modelo.
 *
 * Isso significa que trocar de provedor e mudar UMA variavel no .env, sem
 * tocar em codigo. E significa que a Anthropic (unico formato diferente) fica
 * isolada no seu proprio ramo, sem contaminar o resto.
 *
 * Opcoes gratuitas, da mais para a menos privada:
 *
 *  | Provedor    | Custo    | Onde roda        | Observacao                    |
 *  |-------------|----------|------------------|-------------------------------|
 *  | ollama      | R$ 0     | Sua maquina      | Privado, offline, sem limite  |
 *  | lmstudio    | R$ 0     | Sua maquina      | Igual ao Ollama, com interface|
 *  | groq        | R$ 0*    | Nuvem            | Rapido; limite diario         |
 *  | google      | R$ 0*    | Nuvem            | Gemini; limite por minuto     |
 *  | openrouter  | R$ 0*    | Nuvem            | Modelos com sufixo ":free"    |
 *  | openai      | Pago     | Nuvem            |                               |
 *  | anthropic   | Pago     | Nuvem            |                               |
 *
 *  (*) Camada gratuita com limite de uso. Sem cartao de credito.
 */

export interface AiMessageInput {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type AiProviderName =
  | 'ollama'
  | 'lmstudio'
  | 'groq'
  | 'google'
  | 'openrouter'
  | 'openai'
  | 'anthropic';

const PROVIDER_NAMES: AiProviderName[] = [
  'ollama',
  'lmstudio',
  'groq',
  'google',
  'openrouter',
  'openai',
  'anthropic',
];

export interface AiCompletionOptions {
  provider?: AiProviderName;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  /** Timeout proprio: modelo local em maquina modesta demora mais. */
  timeoutMs?: number;
}

export interface AiCompletionResult {
  content: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  costUsd: number;
  latencyMs: number;
  /** true quando nao houve custo (modelo local ou camada gratuita). */
  free: boolean;
}

interface ProviderProfile {
  /** URL base no formato OpenAI (terminando em /v1). */
  baseUrl: string;
  apiKey: string;
  chatModel: string;
  analysisModel: string;
  /** Roda na propria maquina: sem custo e sem limite de requisicoes. */
  local: boolean;
  /** Camada gratuita da nuvem: sem custo, mas com limite. */
  freeTier: boolean;
}

function profileFor(provider: AiProviderName): ProviderProfile {
  switch (provider) {
    case 'ollama':
      return {
        baseUrl: env.OLLAMA_BASE_URL.replace(/\/+$/, ''),
        // O Ollama ignora a chave, mas o cliente HTTP exige algo nao vazio.
        apiKey: 'ollama',
        chatModel: env.OLLAMA_CHAT_MODEL,
        analysisModel: env.OLLAMA_ANALYSIS_MODEL || env.OLLAMA_CHAT_MODEL,
        local: true,
        freeTier: true,
      };

    case 'lmstudio':
      return {
        baseUrl: env.LMSTUDIO_BASE_URL.replace(/\/+$/, ''),
        apiKey: 'lm-studio',
        chatModel: env.LMSTUDIO_CHAT_MODEL,
        analysisModel: env.LMSTUDIO_CHAT_MODEL,
        local: true,
        freeTier: true,
      };

    case 'groq':
      return {
        baseUrl: 'https://api.groq.com/openai/v1',
        apiKey: env.GROQ_API_KEY,
        chatModel: env.GROQ_CHAT_MODEL,
        analysisModel: env.GROQ_ANALYSIS_MODEL || env.GROQ_CHAT_MODEL,
        local: false,
        freeTier: true,
      };

    case 'google':
      return {
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        apiKey: env.GOOGLE_API_KEY,
        chatModel: env.GOOGLE_CHAT_MODEL,
        analysisModel: env.GOOGLE_ANALYSIS_MODEL || env.GOOGLE_CHAT_MODEL,
        local: false,
        freeTier: true,
      };

    case 'openrouter':
      return {
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: env.OPENROUTER_API_KEY,
        chatModel: env.OPENROUTER_CHAT_MODEL,
        analysisModel: env.OPENROUTER_CHAT_MODEL,
        local: false,
        // Gratuito apenas nos modelos com sufixo ":free".
        freeTier: env.OPENROUTER_CHAT_MODEL.endsWith(':free'),
      };

    case 'openai':
      return {
        baseUrl: 'https://api.openai.com/v1',
        apiKey: env.OPENAI_API_KEY,
        chatModel: env.OPENAI_CHAT_MODEL,
        analysisModel: env.OPENAI_ANALYSIS_MODEL || env.OPENAI_CHAT_MODEL,
        local: false,
        freeTier: false,
      };

    case 'anthropic':
      return {
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: env.ANTHROPIC_API_KEY,
        chatModel: env.ANTHROPIC_CHAT_MODEL,
        analysisModel: env.ANTHROPIC_ANALYSIS_MODEL || env.ANTHROPIC_CHAT_MODEL,
        local: false,
        freeTier: false,
      };
  }
}

/**
 * Preco por MILHAO de tokens em USD, apenas dos provedores pagos.
 * Provedor local ou camada gratuita custa zero e nem consulta esta tabela.
 */
const PRICE_PER_MILLION: Record<string, { input: number; output: number }> = {
  // Anthropic
  'claude-opus-5': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  // OpenAI
  'gpt-4.1': { input: 2, output: 8 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
};

function estimateCostUsd(
  profile: ProviderProfile,
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  if (profile.local || profile.freeTier) return 0;

  const price = PRICE_PER_MILLION[model];
  if (!price) return 0;

  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

/**
 * Modelos pequenos as vezes devolvem lixo em volta da resposta: blocos de
 * raciocinio, cercas de markdown, rotulos de papel. Limpamos antes de mandar
 * para o cliente - ninguem no WhatsApp deveria ver "<think>".
 */
function sanitizeReply(raw: string): string {
  return raw
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\|[^|]*\|>/g, '')
    .replace(/^\s*```(?:\w+)?\s*\n?/, '')
    .replace(/\n?```\s*$/, '')
    .replace(/^\s*(?:assistant|atendente|resposta)\s*:\s*/i, '')
    .trim();
}

/** true quando a IA foi desligada por configuracao. */
export function isAiDisabled(): boolean {
  return !env.AI_ENABLED || env.AI_PROVIDER === 'disabled';
}

export async function generateCompletion(
  messages: AiMessageInput[],
  options: AiCompletionOptions = {},
): Promise<AiCompletionResult> {
  // `AI_PROVIDER=disabled` nao tem perfil. Sem esta guarda, `profileFor`
  // cairia fora do switch e devolveria `undefined` - o tipo nao pega isso
  // porque o valor vem de configuracao, nao do codigo.
  const provider = options.provider ?? (env.AI_PROVIDER as AiProviderName);
  if (isAiDisabled() || !PROVIDER_NAMES.includes(provider)) {
    throw new ProviderError(
      String(provider),
      'A IA esta desligada. Defina AI_PROVIDER=ollama no .env para usar modelo local gratuito.',
      { retryable: false },
    );
  }

  const profile = profileFor(provider);
  const model = options.model ?? profile.chatModel;

  if (!profile.apiKey) {
    throw new ProviderError(
      provider,
      `Provedor "${provider}" sem credencial configurada. Defina a chave no .env ` +
        'ou use AI_PROVIDER=ollama para rodar local sem chave.',
      { retryable: false },
    );
  }

  const startedAt = Date.now();

  if (provider === 'anthropic') {
    return completeWithAnthropic(messages, { ...options, model }, profile, startedAt);
  }

  return completeWithOpenAiCompatible(
    messages,
    { ...options, model },
    profile,
    provider,
    startedAt,
  );
}

interface OpenAiCompatibleResponse {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
  error?: { message?: string; code?: string };
}

/**
 * Caminho unico para Ollama, LM Studio, Groq, Gemini, OpenRouter e OpenAI.
 * Todos falam o mesmo dialeto - por isso um codigo so.
 */
async function completeWithOpenAiCompatible(
  messages: AiMessageInput[],
  options: AiCompletionOptions & { model: string },
  profile: ProviderProfile,
  provider: AiProviderName,
  startedAt: number,
): Promise<AiCompletionResult> {
  const body: Record<string, unknown> = {
    model: options.model,
    messages: messages.map((message) => ({ role: message.role, content: message.content })),
    temperature: options.temperature ?? env.AI_TEMPERATURE,
    max_tokens: options.maxTokens ?? env.AI_MAX_OUTPUT_TOKENS,
    stream: false,
  };

  // Modelo local roda na CPU/GPU da casa: precisa de MUITO mais paciencia que
  // uma API de nuvem. 3 minutos cobre um 7B numa maquina modesta.
  const timeoutMs = options.timeoutMs ?? (profile.local ? 180_000 : 45_000);

  let response: Response;
  try {
    response = await fetch(`${profile.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${profile.apiKey}`,
        ...(provider === 'openrouter'
          ? { 'HTTP-Referer': env.PUBLIC_API_URL, 'X-Title': 'CRM Central Pneus' }
          : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === 'TimeoutError';

    // Diagnostico util: a causa numero um de falha com Ollama e o servico
    // simplesmente nao estar rodando.
    const hint = profile.local
      ? ` Verifique se o servidor local esta ativo em ${profile.baseUrl} (rode "ollama serve").`
      : '';

    throw new ProviderError(
      provider,
      isTimeout
        ? `O modelo demorou mais de ${Math.round(timeoutMs / 1000)}s para responder.${hint}`
        : `Falha de conexao com o provedor de IA.${hint}`,
      { retryable: true, cause: error },
    );
  }

  const payload = (await response.json().catch(() => null)) as OpenAiCompatibleResponse | null;

  if (!response.ok) {
    const message = payload?.error?.message ?? `HTTP ${response.status}`;

    // 429 na camada gratuita e esperado: a fila tenta de novo mais tarde.
    const retryable = response.status === 429 || response.status >= 500;

    throw new ProviderError(provider, `Provedor de IA recusou a requisicao: ${message}`, {
      statusCode: response.status,
      retryable,
    });
  }

  const content = sanitizeReply(payload?.choices?.[0]?.message?.content ?? '');
  const inputTokens = payload?.usage?.prompt_tokens ?? 0;
  const outputTokens = payload?.usage?.completion_tokens ?? 0;

  return {
    content,
    provider,
    model: options.model,
    inputTokens,
    outputTokens,
    cachedTokens: payload?.usage?.prompt_tokens_details?.cached_tokens ?? 0,
    costUsd: estimateCostUsd(profile, options.model, inputTokens, outputTokens),
    latencyMs: Date.now() - startedAt,
    free: profile.local || profile.freeTier,
  };
}

/**
 * Ramo da Anthropic (Claude).
 *
 * Fica separado porque a Anthropic e a unica que NAO fala o dialeto do
 * OpenAI: o prompt de sistema vai num campo proprio, nao como mensagem.
 *
 * Opcional e pago - so entra em uso se voce definir AI_PROVIDER=anthropic.
 * O import e dinamico justamente para que o SDK nunca seja carregado quando
 * a operacao roda com modelo local.
 */
async function completeWithAnthropic(
  messages: AiMessageInput[],
  options: AiCompletionOptions & { model: string },
  profile: ProviderProfile,
  startedAt: number,
): Promise<AiCompletionResult> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: profile.apiKey });

  // A Anthropic separa o system do historico; juntamos os blocos de sistema.
  const systemPrompt = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n');

  const turns = messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role as 'user' | 'assistant',
      content: message.content,
    }));

  try {
    const response = await client.messages.create({
      model: options.model,
      max_tokens: options.maxTokens ?? env.AI_MAX_OUTPUT_TOKENS,
      // O prompt da persona e estavel entre conversas: marcar para cache
      // corta a maior parte do custo de entrada.
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      messages: turns,
      // Resposta de atendimento precisa ser rapida; esforco baixo basta e
      // gasta menos. Manter o raciocinio ligado (padrao) evita os defeitos
      // conhecidos de desliga-lo.
      output_config: { effort: 'low' },
    });

    // Recusa por politica de seguranca: nao ha texto para enviar. Devolvemos
    // vazio e o servico decide transferir para um humano.
    if (response.stop_reason === 'refusal') {
      logger.warn(
        { model: options.model, category: response.stop_details?.category },
        'Claude recusou a requisicao por politica de seguranca',
      );
      return {
        content: '',
        provider: 'anthropic',
        model: options.model,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cachedTokens: response.usage.cache_read_input_tokens ?? 0,
        costUsd: 0,
        latencyMs: Date.now() - startedAt,
        free: false,
      };
    }

    const content = sanitizeReply(
      response.content
        .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
        .map((block) => block.text)
        .join('\n'),
    );

    return {
      content,
      provider: 'anthropic',
      model: options.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cachedTokens: response.usage.cache_read_input_tokens ?? 0,
      costUsd: estimateCostUsd(
        profile,
        options.model,
        response.usage.input_tokens,
        response.usage.output_tokens,
      ),
      latencyMs: Date.now() - startedAt,
      free: false,
    };
  } catch (error) {
    logger.error({ err: error, model: options.model }, 'Falha na chamada a Anthropic');
    throw new ProviderError('anthropic', 'Falha ao processar com Claude', {
      cause: error,
      retryable: true,
    });
  }
}

/**
 * Testa se o provedor configurado responde.
 * Usado no painel de configuracao da IA e no health check.
 */
export async function checkAiProvider(): Promise<{
  ok: boolean;
  provider: string;
  model: string;
  local: boolean;
  free: boolean;
  latencyMs: number;
  detail: string;
}> {
  const provider = env.AI_PROVIDER as AiProviderName;

  // Mesma guarda de `generateCompletion`: sem ela o health check derruba a
  // rota inteira quando a IA esta desligada de proposito.
  if (isAiDisabled() || !PROVIDER_NAMES.includes(provider)) {
    return {
      ok: false,
      provider: 'disabled',
      model: '-',
      local: false,
      free: true,
      latencyMs: 0,
      detail: 'IA desligada em AI_PROVIDER',
    };
  }

  const profile = profileFor(provider);
  const startedAt = Date.now();

  try {
    const result = await generateCompletion(
      [
        { role: 'system', content: 'Responda apenas com a palavra OK.' },
        { role: 'user', content: 'teste' },
      ],
      { maxTokens: 16, temperature: 0, timeoutMs: profile.local ? 120_000 : 20_000 },
    );

    return {
      ok: result.content.length > 0,
      provider,
      model: result.model,
      local: profile.local,
      free: profile.local || profile.freeTier,
      latencyMs: result.latencyMs,
      detail: result.content ? 'Provedor respondendo normalmente' : 'Resposta vazia do modelo',
    };
  } catch (error) {
    return {
      ok: false,
      provider,
      model: profile.chatModel,
      local: profile.local,
      free: profile.local || profile.freeTier,
      latencyMs: Date.now() - startedAt,
      detail: error instanceof Error ? error.message : 'Falha desconhecida',
    };
  }
}

/** Descreve o provedor ativo para exibir no painel do admin. */
export function describeActiveProvider(): {
  provider: string;
  chatModel: string;
  local: boolean;
  free: boolean;
  configured: boolean;
} {
  const provider = env.AI_PROVIDER as AiProviderName;
  if (isAiDisabled() || !PROVIDER_NAMES.includes(provider)) {
    return { provider: 'disabled', chatModel: '-', local: false, free: true, configured: false };
  }

  const profile = profileFor(provider);

  return {
    provider,
    chatModel: profile.chatModel,
    local: profile.local,
    free: profile.local || profile.freeTier,
    configured: Boolean(profile.apiKey),
  };
}

/** true quando o provedor tem credencial (ou nao precisa de uma, como o local). */
export function isProviderConfigured(provider: AiProviderName): boolean {
  if (!PROVIDER_NAMES.includes(provider)) return false;
  return Boolean(profileFor(provider).apiKey);
}

/**
 * Reconcilia o provedor pedido pela persona com o que realmente existe.
 *
 * A persona fica no banco e pode ter sido gravada apontando para um provedor
 * que ninguem configurou - foi exatamente o que aconteceu com uma persona
 * salva como "anthropic" numa instalacao que roda Ollama local. Sem esta
 * checagem, TODA conversa morria com "sem credencial" e ia para a fila humana,
 * como se a IA nao existisse.
 *
 * Regra: a preferencia da persona vale enquanto for utilizavel; senao caimos
 * para o provedor do .env. E quando trocamos de provedor, o modelo da persona
 * tambem e descartado - um nome de modelo da Anthropic nao existe no Ollama.
 */
export function resolvePersonaProvider(
  preferredProvider?: string | null,
  preferredModel?: string | null,
): { provider?: AiProviderName; model?: string } {
  const wanted = (preferredProvider ?? '').trim() as AiProviderName;

  if (wanted && isProviderConfigured(wanted)) {
    return { provider: wanted, ...(preferredModel ? { model: preferredModel } : {}) };
  }

  if (wanted) {
    logger.warn(
      { personaProvider: wanted, fallback: env.AI_PROVIDER },
      'Persona aponta para um provedor de IA sem credencial; usando o do .env',
    );
  }

  // Sem provider/model: `generateCompletion` usa o que estiver no .env.
  return {};
}
