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

// --- Protecao contra SSRF --------------------------------------------------

/**
 * Faixas de IP que um servidor nunca deve buscar a pedido de terceiros.
 *
 * O ataque: parte das URLs que baixamos vem do payload de um webhook, ou seja,
 * de fora. Se aceitassemos qualquer endereco, bastaria mandar uma mensagem
 * apontando para 169.254.169.254 (metadados da nuvem) ou para um servico
 * interno da rede, e o nosso servidor faria a requisicao POR ELES - com a
 * credencial e a posicao de rede dele. Isso e SSRF.
 */
const FAIXAS_PRIVADAS = [
  /^127\./, /^10\./, /^192\.168\./, /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
];

/**
 * Converte um IPv4 mapeado em IPv6 para a forma decimal.
 *
 * Aceita "::ffff:127.0.0.1" e tambem "::ffff:7f00:1", que e como o construtor
 * de URL do Node reescreve o mesmo endereco. Sem tratar a forma hexadecimal,
 * a barreira contra rede interna seria contornada com um endereco equivalente.
 */
function normalizarIpv4Mapeado(host: string): string | null {
  const decimal = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(host);
  if (decimal?.[1]) return decimal[1];

  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(host);
  if (!hex) return null;

  const alto = Number.parseInt(hex[1] as string, 16);
  const baixo = Number.parseInt(hex[2] as string, 16);

  return [alto >> 8, alto & 0xff, baixo >> 8, baixo & 0xff].join('.');
}

function ehHostPrivado(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) return true;
  // IPv6: loopback, link-local e enderecos unicos locais.
  if (host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) {
    return true;
  }
  // IPv4 mapeado em IPv6 contorna a checagem ingenua. E preciso normalizar
  // as DUAS formas: o Node reescreve "::ffff:127.0.0.1" como "::ffff:7f00:1",
  // entao procurar pelo decimal sozinho nao encontraria nada.
  const alvo = normalizarIpv4Mapeado(host) ?? host;

  return FAIXAS_PRIVADAS.some((faixa) => faixa.test(alvo));
}

/**
 * Valida uma URL vinda de fonte nao confiavel antes de busca-la.
 *
 * Recusa esquema que nao seja HTTPS e qualquer endereco de rede interna.
 * `allowHttp` existe apenas para o provedor de IA local (localhost), que e
 * configurado por quem administra e nao por um remetente qualquer.
 */
export function assertUrlExterna(bruta: string, options: { allowHttp?: boolean } = {}): URL {
  let url: URL;
  try {
    url = new URL(bruta);
  } catch {
    throw new ProviderError('url', 'URL invalida', { retryable: false, statusCode: 400 });
  }

  const esquemas = options.allowHttp ? ['http:', 'https:'] : ['https:'];
  if (!esquemas.includes(url.protocol)) {
    throw new ProviderError('url', `Esquema nao permitido: ${url.protocol}`, {
      retryable: false,
      statusCode: 400,
    });
  }

  if (ehHostPrivado(url.hostname)) {
    logger.warn({ host: url.hostname }, 'Bloqueado acesso a endereco de rede interna (SSRF)');
    throw new ProviderError('url', 'Endereco de rede interna nao permitido', {
      retryable: false,
      statusCode: 400,
    });
  }

  return url;
}
