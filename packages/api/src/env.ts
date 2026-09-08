import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

/**
 * Configuracao da aplicacao.
 *
 * Tudo e validado no boot. Se falta uma variavel obrigatoria o processo morre
 * agora, com a lista do que falta - e nao daqui a tres horas, no meio de um
 * atendimento, com um `undefined` viajando pelo codigo.
 */

// Carrega o .env da raiz do monorepo sem depender do pacote dotenv.
for (const candidate of ['.env', '../.env', '../../.env', '../../../.env']) {
  const path = resolve(process.cwd(), candidate);
  if (existsSync(path)) {
    try {
      process.loadEnvFile(path);
    } catch {
      // Arquivo ilegivel: seguimos com as variaveis que ja existirem no ambiente.
    }
    break;
  }
}

const bool = (defaultValue: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .default(defaultValue)
    .transform((value) =>
      typeof value === 'boolean' ? value : ['1', 'true', 'yes', 'on'].includes(value.toLowerCase()),
    );

const csv = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    TZ: z.string().default('America/Sao_Paulo'),

    API_PORT: z.coerce.number().int().min(1).max(65535).default(3333),
    API_HOST: z.string().default('0.0.0.0'),
    PUBLIC_API_URL: z.string().url().default('http://localhost:3333'),
    CORS_ORIGINS: csv,

    DATABASE_URL: z.string().min(1, 'DATABASE_URL e obrigatoria'),
    REDIS_URL: z.string().min(1, 'REDIS_URL e obrigatoria'),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET precisa de 32+ caracteres'),
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET precisa de 32+ caracteres'),
    JWT_ACCESS_TTL: z.string().default('15m'),
    JWT_REFRESH_TTL: z.string().default('30d'),
    CREDENTIALS_ENCRYPTION_KEY: z.string().default(''),

    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_PATH: z.string().default('./storage'),
    S3_ENDPOINT: z.string().default(''),
    S3_REGION: z.string().default('us-east-1'),
    S3_BUCKET: z.string().default(''),
    S3_ACCESS_KEY_ID: z.string().default(''),
    S3_SECRET_ACCESS_KEY: z.string().default(''),
    S3_FORCE_PATH_STYLE: bool(true),

    WHATSAPP_CLOUD_ENABLED: bool(false),
    WHATSAPP_APP_SECRET: z.string().default(''),
    WHATSAPP_VERIFY_TOKEN: z.string().default(''),
    WHATSAPP_ACCESS_TOKEN: z.string().default(''),
    WHATSAPP_PHONE_NUMBER_ID: z.string().default(''),
    WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().default(''),
    WHATSAPP_GRAPH_VERSION: z.string().default('v21.0'),

    EVOLUTION_ENABLED: bool(false),
    EVOLUTION_BASE_URL: z.string().default('http://localhost:8080'),
    EVOLUTION_API_KEY: z.string().default(''),
    EVOLUTION_INSTANCE: z.string().default('central-pneus'),
    EVOLUTION_WEBHOOK_SECRET: z.string().default(''),

    AI_ENABLED: bool(true),
    // Padrao "ollama": roda na propria maquina, sem chave e sem custo.
    AI_PROVIDER: z
      .enum(['ollama', 'lmstudio', 'groq', 'google', 'openrouter', 'openai', 'anthropic', 'disabled'])
      .default('ollama'),

    // --- Local, custo zero ---
    OLLAMA_BASE_URL: z.string().default('http://localhost:11434/v1'),
    OLLAMA_CHAT_MODEL: z.string().default('qwen2.5:7b-instruct'),
    OLLAMA_ANALYSIS_MODEL: z.string().default(''),
    LMSTUDIO_BASE_URL: z.string().default('http://localhost:1234/v1'),
    LMSTUDIO_CHAT_MODEL: z.string().default('local-model'),

    // --- Nuvem, camada gratuita ---
    GROQ_API_KEY: z.string().default(''),
    GROQ_CHAT_MODEL: z.string().default('llama-3.3-70b-versatile'),
    GROQ_ANALYSIS_MODEL: z.string().default(''),
    GOOGLE_API_KEY: z.string().default(''),
    GOOGLE_CHAT_MODEL: z.string().default('gemini-2.0-flash'),
    GOOGLE_ANALYSIS_MODEL: z.string().default(''),
    OPENROUTER_API_KEY: z.string().default(''),
    OPENROUTER_CHAT_MODEL: z.string().default('meta-llama/llama-3.3-70b-instruct:free'),

    // --- Nuvem, pago (opcional) ---
    ANTHROPIC_API_KEY: z.string().default(''),
    ANTHROPIC_CHAT_MODEL: z.string().default('claude-opus-5'),
    ANTHROPIC_ANALYSIS_MODEL: z.string().default('claude-opus-5'),
    OPENAI_API_KEY: z.string().default(''),
    OPENAI_CHAT_MODEL: z.string().default('gpt-4.1-mini'),
    OPENAI_ANALYSIS_MODEL: z.string().default('gpt-4.1'),
    AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(64).max(8192).default(800),
    AI_TEMPERATURE: z.coerce.number().min(0).max(1).default(0.4),
    AI_MAX_TURNS_BEFORE_HANDOFF: z.coerce.number().int().min(1).max(50).default(12),
    AI_MONTHLY_BUDGET_USD: z.coerce.number().min(0).default(200),

    IDLE_CONVERSATION_MINUTES: z.coerce.number().int().min(1).default(30),
    AUTO_CLOSE_MINUTES: z.coerce.number().int().min(5).default(180),
    SLA_FIRST_RESPONSE_SECONDS: z.coerce.number().int().min(30).default(180),
    QUEUE_ESCALATION_SECONDS: z.coerce.number().int().min(60).default(600),
    AGENT_AUTO_AWAY_MINUTES: z.coerce.number().int().min(1).default(10),

    CHANNEL_SEND_RATE_PER_SECOND: z.coerce.number().int().min(1).max(500).default(20),
    OUTBOX_SWEEP_INTERVAL_SECONDS: z.coerce.number().int().min(5).default(30),

    ROLE: z.enum(['api', 'worker', 'all']).default('all'),
  })
  .superRefine((data, ctx) => {
    // Em producao nao aceitamos os valores de exemplo nem chave de cifra vazia.
    if (data.NODE_ENV !== 'production') return;

    if (data.JWT_ACCESS_SECRET.includes('troque-por')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_ACCESS_SECRET'],
        message: 'Troque o segredo de exemplo antes de subir em producao',
      });
    }
    if (!data.CREDENTIALS_ENCRYPTION_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CREDENTIALS_ENCRYPTION_KEY'],
        message: 'Obrigatoria em producao: sem ela as credenciais ficam em texto claro',
      });
    }
    if (!data.PUBLIC_API_URL.startsWith('https://')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PUBLIC_API_URL'],
        message: 'A Meta so entrega webhook em HTTPS',
      });
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const problems = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  console.error(`\nConfiguracao invalida. Corrija o .env:\n\n${problems}\n`);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
