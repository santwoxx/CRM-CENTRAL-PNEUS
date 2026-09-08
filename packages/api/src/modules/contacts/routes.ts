import type { FastifyPluginAsync } from 'fastify';
import { LifecycleStage, Permission, listContactsSchema, updateContactSchema } from '@crm/shared';
import { getContact, listContacts, updateContact } from './service.js';

export const contactRoutes: FastifyPluginAsync = async (app) => {
  // Listar contatos
  app.get('/', async (req, reply) => {
    req.authorize(Permission.CONTACT_VIEW);
    const query = listContactsSchema.parse(req.query);

    const result = await listContacts({
      orgId: req.user.orgId,
      search: query.search,
      tag: query.tag,
      lifecycleStage: query.lifecycleStage as LifecycleStage | undefined,
      limit: query.limit,
      cursor: query.cursor,
    });

    return reply.send(result);
  });

  // Detalhes do contato
  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    req.authorize(Permission.CONTACT_VIEW);
    const contact = await getContact(req.params.id, req.user.orgId);
    return reply.send(contact);
  });

  // Atualizar contato
  app.put<{ Params: { id: string } }>('/:id', async (req, reply) => {
    req.authorize(Permission.CONTACT_EDIT);
    const input = updateContactSchema.parse(req.body);

    const updated = await updateContact(req.params.id, req.user.orgId, {
      name: input.name,
      email: input.email,
      document: input.document,
      tags: input.tags,
      notes: input.notes,
      lifecycleStage: input.lifecycleStage as LifecycleStage | undefined,
      customFields: input.customFields,
      isBlocked: input.isBlocked,
      preferredAgentId: input.preferredAgentId,
    });

    return reply.send(updated);
  });
};
