import type { FastifyPluginAsync } from 'fastify';
import {
  AgentPresence,
  Permission,
  UserRole,
  createUserSchema,
  setPresenceSchema,
  updateUserSchema,
} from '@crm/shared';
import { createUser, deleteUser, listUsers, updateUser } from './service.js';
import { setPresence } from '../routing/presence.js';

export const userRoutes: FastifyPluginAsync = async (app) => {
  // Listagem de atendentes e membros da equipe
  app.get('/', async (req, reply) => {
    req.authorize(Permission.USER_VIEW);
    const users = await listUsers(req.user.orgId);
    return reply.send(users);
  });

  // Cadastro de novo atendente
  app.post('/', async (req, reply) => {
    req.authorize(Permission.USER_MANAGE);
    const input = createUserSchema.parse(req.body);

    const created = await createUser({
      orgId: req.user.orgId,
      name: input.name,
      email: input.email,
      password: input.password,
      role: input.role as UserRole | undefined,
      maxConcurrentChats: input.maxConcurrentChats,
      departmentIds: input.departmentIds,
    });

    return reply.code(201).send(created);
  });

  // Atualização de dados do atendente
  app.put<{ Params: { id: string } }>('/:id', async (req, reply) => {
    req.authorize(Permission.USER_MANAGE);
    const input = updateUserSchema.parse(req.body);

    const updated = await updateUser(req.params.id, req.user.orgId, {
      name: input.name,
      role: input.role as UserRole | undefined,
      maxConcurrentChats: input.maxConcurrentChats,
      isActive: input.isActive,
      departmentIds: input.departmentIds,
    });

    return reply.send(updated);
  });

  // Remoção (soft delete)
  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    req.authorize(Permission.USER_MANAGE);
    await deleteUser(req.params.id, req.user.orgId);
    return reply.send({ ok: true });
  });

  // Forçar status de presença pelo Admin / Supervisor
  app.put<{ Params: { id: string } }>('/:id/presence', async (req, reply) => {
    req.authorize(Permission.USER_FORCE_PRESENCE);
    const input = setPresenceSchema.parse(req.body);

    const updated = await setPresence(req.params.id, input.presence as AgentPresence, { automatic: false });
    return reply.send(updated);
  });
};
