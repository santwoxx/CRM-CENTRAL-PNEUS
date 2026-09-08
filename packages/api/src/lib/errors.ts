/**
 * Erros da aplicacao.
 *
 * Todo erro esperado vira um `AppError` com codigo estavel. O handler global
 * converte em resposta HTTP; qualquer coisa que NAO seja AppError e tratada
 * como falha inesperada: vira 500, e logada inteira e nunca expoe detalhe
 * interno para o cliente.
 */

export type ErrorDetail = { path: string; message: string };

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: ErrorDetail[];
  /** true = tentar de novo pode dar certo (usado pelas filas). */
  readonly retryable: boolean;

  constructor(
    message: string,
    options: {
      statusCode?: number;
      code?: string;
      details?: ErrorDetail[];
      retryable?: boolean;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.statusCode = options.statusCode ?? 500;
    this.code = options.code ?? 'INTERNAL_ERROR';
    this.details = options.details;
    this.retryable = options.retryable ?? false;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Dados invalidos', details?: ErrorDetail[]) {
    super(message, { statusCode: 422, code: 'VALIDATION_ERROR', details });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Nao autenticado', code = 'UNAUTHORIZED') {
    super(message, { statusCode: 401, code });
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Voce nao tem permissao para isso', code = 'FORBIDDEN') {
    super(message, { statusCode: 403, code });
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Recurso') {
    super(`${resource} nao encontrado`, { statusCode: 404, code: 'NOT_FOUND' });
  }
}

export class ConflictError extends AppError {
  constructor(message: string, code = 'CONFLICT') {
    super(message, { statusCode: 409, code });
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Muitas requisicoes. Tente em instantes.') {
    super(message, { statusCode: 429, code: 'RATE_LIMITED', retryable: true });
  }
}

/** Falha ao falar com um provedor externo (Meta, Evolution, IA). */
export class ProviderError extends AppError {
  readonly provider: string;
  readonly providerCode: string | null;

  constructor(
    provider: string,
    message: string,
    options: { statusCode?: number; providerCode?: string | null; retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, {
      statusCode: options.statusCode ?? 502,
      code: 'PROVIDER_ERROR',
      retryable: options.retryable ?? true,
      cause: options.cause,
    });
    this.provider = provider;
    this.providerCode = options.providerCode ?? null;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** Extrai uma mensagem legivel de qualquer coisa lancada. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/** Decide se vale a pena a fila tentar de novo. */
export function isRetryable(error: unknown): boolean {
  if (isAppError(error)) return error.retryable;
  // Erros de rede/socket sao transitorios por natureza.
  const code = (error as { code?: string } | null)?.code;
  return (
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNREFUSED' ||
    code === 'EAI_AGAIN' ||
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    code === 'UND_ERR_SOCKET'
  );
}
