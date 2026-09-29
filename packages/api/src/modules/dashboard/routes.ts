import type { FastifyPluginAsync } from 'fastify';
import { Permission } from '@crm/shared';
import { getDashboardMetrics, getLiveConversations } from './service.js';
import { getPresenceSnapshot } from '../routing/presence.js';

export const dashboardRoutes: FastifyPluginAsync = async (app) => {
  // Métricas operacionais em tempo real
  app.get('/metrics', async (req, reply) => {
    req.authorize(Permission.DASHBOARD_VIEW);
    const metrics = await getDashboardMetrics(req.user.orgId);
    return reply.send(metrics);
  });

  // Conversas em andamento. Mostra o que ESTE usuario pode ver: tudo para o
  // administrador, apenas os setores dele para o supervisor.
  app.get('/live', async (req, reply) => {
    req.authorize(Permission.CONVERSATION_SPECTATE, Permission.CONVERSATION_VIEW_ALL);
    const conversations = await getLiveConversations({
      id: req.user.id,
      orgId: req.user.orgId,
      role: req.user.role,
      departmentIds: req.user.departments.map((departamento) => departamento.id),
    });
    return reply.send(conversations);
  });

  // Status de presença de todos os atendentes em tempo real
  app.get('/presence', async (req, reply) => {
    req.authorize(Permission.USER_VIEW);
    const presence = await getPresenceSnapshot(req.user.orgId);
    return reply.send(presence);
  });
};
