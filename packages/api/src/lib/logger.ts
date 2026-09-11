import { pino, type Logger } from 'pino';
import { env, isProduction } from '../env.js';

/**
 * Logger da aplicacao.
 *
 * A lista de `redact` nao e decorativa: um token de acesso do WhatsApp que
 * vaza para o log e um token comprometido. Todo campo sensivel conhecido
 * entra aqui.
 */
export const logger: Logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'crm-api', role: env.ROLE },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-hub-signature-256"]',
      'req.headers.apikey',
      'password',
      'passwordHash',
      'currentPassword',
      'newPassword',
      'refreshToken',
      'accessToken',
      'credentials',
      'credentialsEncrypted',
      '*.password',
      '*.accessToken',
      '*.apiKey',
      '*.api_key',
      '*.authorization',
      // Dado pessoal: log costuma ir para servico de terceiro e ficar meses
      // guardado. Telefone e e-mail de cliente nao precisam estar la para o
      // log cumprir sua funcao - o id do contato identifica sem expor.
      'phone',
      'telefone',
      '*.phone',
      'contact.phone',
      'identity.email',
      'ANTHROPIC_API_KEY',
      'OPENAI_API_KEY',
      'WHATSAPP_ACCESS_TOKEN',
    ],
    censor: '[REDACTED]',
  },
  ...(isProduction
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss.l',
            ignore: 'pid,hostname,service,role',
            singleLine: false,
          },
        },
      }),
});

/** Logger filho com contexto fixo, para nao repetir os mesmos campos. */
export function childLogger(bindings: Record<string, unknown>): Logger {
  return logger.child(bindings);
}
