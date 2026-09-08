import type { FastifyPluginAsync } from 'fastify';
import { ChannelType, Permission, createChannelSchema, updateChannelSchema } from '@crm/shared';
import { checkChannelHealth, createChannel, listChannels, updateChannel } from './service.js';

export const channelRoutes: FastifyPluginAsync = async (app) => {
  // Listar canais configurados
  app.get('/', async (req, reply) => {
    req.authorize(Permission.CHANNEL_MANAGE);
    const channels = await listChannels(req.user.orgId);
    return reply.send(channels);
  });

  // Criar canal
  app.post('/', async (req, reply) => {
    req.authorize(Permission.CHANNEL_MANAGE);
    const input = createChannelSchema.parse(req.body);

    const channel = await createChannel({
      orgId: req.user.orgId,
      type: input.type as ChannelType,
      name: input.name,
      isDefault: input.isDefault,
      credentials: input.credentials,
    });

    return reply.code(201).send(channel);
  });

  // Atualizar canal
  app.put<{ Params: { id: string } }>('/:id', async (req, reply) => {
    req.authorize(Permission.CHANNEL_MANAGE);
    const input = updateChannelSchema.parse(req.body);

    const updated = await updateChannel(req.params.id, req.user.orgId, {
      name: input.name,
      isActive: input.isActive,
      isDefault: input.isDefault,
      credentials: input.credentials,
    });

    return reply.send(updated);
  });

  // Testar conexão / obter QR code
  app.post<{ Params: { id: string } }>('/:id/test', async (req, reply) => {
    req.authorize(Permission.CHANNEL_MANAGE);
    const result = await checkChannelHealth(req.params.id, req.user.orgId);
    return reply.send(result);
  });
};
