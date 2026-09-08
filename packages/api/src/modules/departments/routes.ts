import type { FastifyPluginAsync } from 'fastify';
import { Permission, RoutingStrategy, createDepartmentSchema, updateDepartmentSchema } from '@crm/shared';
import { createDepartment, deleteDepartment, listDepartments, updateDepartment } from './service.js';

export const departmentRoutes: FastifyPluginAsync = async (app) => {
  // Listar setores
  app.get('/', async (req, reply) => {
    const departments = await listDepartments(req.user.orgId);
    return reply.send(departments);
  });

  // Criar setor
  app.post('/', async (req, reply) => {
    req.authorize(Permission.DEPARTMENT_MANAGE);
    const input = createDepartmentSchema.parse(req.body);

    const created = await createDepartment({
      orgId: req.user.orgId,
      name: input.name,
      description: input.description,
      color: input.color,
      menuLabel: input.menuLabel,
      showInMenu: input.showInMenu,
      order: input.order,
      routingStrategy: input.routingStrategy as RoutingStrategy | undefined,
      aiEnabled: input.aiEnabled,
      offlineMessage: input.offlineMessage,
      closingMessage: input.closingMessage,
      businessHours: input.businessHours,
      memberIds: input.memberIds,
    });

    return reply.code(201).send(created);
  });

  // Atualizar setor
  app.put<{ Params: { id: string } }>('/:id', async (req, reply) => {
    req.authorize(Permission.DEPARTMENT_MANAGE);
    const input = updateDepartmentSchema.parse(req.body);

    const updated = await updateDepartment(req.params.id, req.user.orgId, {
      name: input.name,
      description: input.description,
      color: input.color,
      menuLabel: input.menuLabel,
      showInMenu: input.showInMenu,
      order: input.order,
      isActive: input.isActive,
      routingStrategy: input.routingStrategy as RoutingStrategy | undefined,
      aiEnabled: input.aiEnabled,
      offlineMessage: input.offlineMessage,
      closingMessage: input.closingMessage,
      businessHours: input.businessHours,
      memberIds: input.memberIds,
    });

    return reply.send(updated);
  });

  // Desativar setor
  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    req.authorize(Permission.DEPARTMENT_MANAGE);
    await deleteDepartment(req.params.id, req.user.orgId);
    return reply.send({ ok: true });
  });
};
