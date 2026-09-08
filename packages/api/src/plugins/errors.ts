import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { ZodError } from 'zod';
import { isAppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { isProduction } from '../env.js';

export const errorsPlugin: FastifyPluginAsync = fp(async (fastify) => {
  fastify.setErrorHandler((error, request, reply) => {
    // 1. Erro de validação do Zod
    if (error instanceof ZodError) {
      const details = error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      }));
      return reply.code(422).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Dados invalidos no payload ou parametros',
          details,
          requestId: request.id,
        },
      });
    }

    // 2. Erros de domínio da aplicação (AppError)
    if (isAppError(error)) {
      return reply.code(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
          requestId: request.id,
        },
      });
    }

    // 3. Erros do próprio Fastify (ex: 404, bad JSON, payload too large)
    const fastifyError = error as { statusCode?: number; code?: string; message?: string };
    if (fastifyError.statusCode && fastifyError.statusCode < 500) {
      return reply.code(fastifyError.statusCode).send({
        error: {
          code: fastifyError.code || 'BAD_REQUEST',
          message: fastifyError.message || 'Requisicao invalida',
          requestId: request.id,
        },
      });
    }

    // 4. Erros não tratados (500)
    logger.error(
      {
        err: error,
        requestId: request.id,
        url: request.url,
        method: request.method,
      },
      'Erro inesperado na requisicao HTTP',
    );

    const errorMessage = error instanceof Error ? error.message : String(error);

    return reply.code(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: isProduction
          ? 'Ocorreu um erro interno no servidor. Tente novamente em instantes.'
          : errorMessage,
        requestId: request.id,
      },
    });
  });
});
