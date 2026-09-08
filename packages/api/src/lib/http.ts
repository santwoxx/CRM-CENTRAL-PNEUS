import { ProviderError } from './errors.js';
import { logger } from './logger.js';

/**
 * Cliente HTTP para provedores externos.
 *
 * O ponto central e a CLASSIFICACAO do erro. A fila precisa saber a diferenca
 * entre "a Meta esta fora do ar" (tente de novo) e "esse numero nao existe"
 * (nao adianta insistir). Sem isso, ou perdemos mensagens que dariam certo na
 * segunda tentativa, ou entupimos a fila repetindo o que nunca vai funcionar.
 */

export interface HttpRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  provider: string;
  /** Nao registra o corpo no log (payloads com dado pessoal). */
  quiet?: boolean;
}

const DEFAULT_TIMEOUT_MS = 20_000;

/** 4xx que NUNCA vao dar certo repetindo. */
const PERMANENT_STATUS = new Set([400, 401, 403, 404, 405, 410, 422]);

export async function requestJson<T = unknown>(
  url: string,
  options: HttpRequestOptions,
): Promise<T> {
  const method = options.method ?? 'GET';
  const startedAt = Date.now();

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Accept: 'application/json',
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    // Timeout e falha de rede sao sempre transitorios.
    const isTimeout = error instanceof Error && error.name === 'TimeoutError';
    throw new ProviderError(
      options.provider,
      isTimeout ? 'Tempo limite excedido ao falar com o provedor' : 'Falha de rede com o provedor',
      { retryable: true, cause: error, statusCode: 504 },
    );
  }

  const durationMs = Date.now() - startedAt;
  const text = await response.text();

  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!response.ok) {
    const detail = extractProviderError(parsed);
    const retryable = !PERMANENT_STATUS.has(response.status);

    logger.warn(
      {
        provider: options.provider,
        url: redactUrl(url),
        status: response.status,
        durationMs,
        providerCode: detail.code,
        message: detail.message,
      },
      'Provedor respondeu com erro',
    );

    throw new ProviderError(options.provider, detail.message, {
      statusCode: response.status,
      providerCode: detail.code,
      retryable,
    });
  }

  logger.debug(
    { provider: options.provider, url: redactUrl(url), status: response.status, durationMs },
    'Chamada ao provedor concluida',
  );

  return parsed as T;
}

/** Baixa bytes (midia). Mesma classificacao de erro do JSON. */
export async function requestBuffer(
  url: string,
  options: Omit<HttpRequestOptions, 'body'>,
): Promise<{ buffer: Buffer; mimeType: string; size: number }> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: options.headers,
      signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
    });
  } catch (error) {
    throw new ProviderError(options.provider, 'Falha de rede ao baixar midia', {
      retryable: true,
      cause: error,
    });
  }

  if (!response.ok) {
    throw new ProviderError(options.provider, `Falha ao baixar midia (${response.status})`, {
      statusCode: response.status,
      retryable: !PERMANENT_STATUS.has(response.status),
    });
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  return {
    buffer,
    mimeType: response.headers.get('content-type')?.split(';')[0]?.trim() ?? 'application/octet-stream',
    size: buffer.byteLength,
  };
}

/** Extrai codigo e mensagem dos formatos de erro conhecidos. */
function extractProviderError(payload: unknown): { code: string | null; message: string } {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;

    // Formato da Meta: { error: { message, code, error_subcode, error_data } }
    const metaError = record.error as Record<string, unknown> | undefined;
    if (metaError && typeof metaError === 'object') {
      const details = (metaError.error_data as Record<string, unknown> | undefined)?.details;
      return {
        code: metaError.code !== undefined ? String(metaError.code) : null,
        message:
          (typeof details === 'string' ? details : null) ??
          (typeof metaError.message === 'string' ? metaError.message : 'Erro do provedor'),
      };
    }

    // Formato da Evolution: { message, status } ou { response: { message } }
    if (typeof record.message === 'string') {
      return { code: record.status ? String(record.status) : null, message: record.message };
    }
  }

  if (typeof payload === 'string' && payload.trim()) {
    return { code: null, message: payload.slice(0, 300) };
  }

  return { code: null, message: 'Erro desconhecido do provedor' };
}

/** Tira tokens que costumam viajar na query string antes de logar a URL. */
function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    for (const key of ['access_token', 'apikey', 'token', 'key']) {
      if (parsed.searchParams.has(key)) parsed.searchParams.set(key, '[REDACTED]');
    }
    return parsed.toString();
  } catch {
    return url;
  }
}
