import type { FastifyPluginAsync } from 'fastify';
import { Permission } from '@crm/shared';
import { z } from 'zod';
import { listAudit } from './service.js';

/**
 * Leitura da trilha de auditoria.
 *
 * A trilha era gravada e nao tinha como ser lida: `listAudit` existia sem
 * nenhuma rota chamando. Registro que ninguem consegue consultar responde a
 * pergunta "quem mudou isso?" com silencio.
 */

const consultaSchema = z.object({
  entity: z.string().max(40).optional(),
  entityId: z.string().max(60).optional(),
  userId: z.string().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().max(60).optional(),
});

export const auditRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', async (req, reply) => {
    req.authorize(Permission.AUDIT_VIEW);
    const filtros = consultaSchema.parse(req.query);
    const resultado = await listAudit(req.user.orgId, filtros);
    return reply.send(resultado);
  });
};
