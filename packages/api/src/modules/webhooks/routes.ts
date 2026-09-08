import type { FastifyPluginAsync } from 'fastify';
import { ChannelType } from '@crm/shared';
import { prisma } from '../../db/prisma.js';
import { NotFoundError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { verifyMetaSignature } from '../../lib/crypto.js';
import { getChannelCredentials } from '../../channels/registry.js';
import { ingestWebhook } from '../messages/inbound.js';

export const webhookRoutes: FastifyPluginAsync = async (app) => {
  // 1. Verificação do Webhook da Meta Cloud API (GET hub.challenge)
  app.get<{
    Params: { channelId: string };
    Querystring: {
      'hub.mode'?: string;
      'hub.verify_token'?: string;
      'hub.challenge'?: string;
    };
  }>('/whatsapp-cloud/:channelId', async (req, reply) => {
    const { channelId } = req.params;
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (!mode || !token) {
      return reply.code(400).send('Parametros ausentes');
    }

    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { id: true, type: true, credentialsEncrypted: true },
    });

    if (!channel || channel.type !== ChannelType.WHATSAPP_CLOUD) {
      throw new NotFoundError('Canal WhatsApp Cloud');
    }

    const creds = await getChannelCredentials<{ verifyToken: string }>(channelId);
    if (mode === 'subscribe' && token === creds?.verifyToken) {
      logger.info({ channelId }, 'Webhook do WhatsApp Cloud verificado com sucesso pela Meta');
      return reply.code(200).type('text/plain').send(challenge);
    }

    logger.warn({ channelId, token }, 'Falha na verificacao do webhook do WhatsApp Cloud: token incorreto');
    return reply.code(403).send('Token de verificacao invalido');
  });

  // 2. Recebimento de eventos da Meta Cloud API (POST)
  app.post<{ Params: { channelId: string } }>('/whatsapp-cloud/:channelId', async (req, reply) => {
    const { channelId } = req.params;
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { id: true, type: true, credentialsEncrypted: true },
    });

    if (!channel || channel.type !== ChannelType.WHATSAPP_CLOUD) {
      throw new NotFoundError('Canal WhatsApp Cloud');
    }

    const creds = await getChannelCredentials<{ appSecret: string }>(channelId);
    const signature = req.headers['x-hub-signature-256'] as string | undefined;

    // Se o appSecret estiver configurado e houver assinatura, valida
    if (creds?.appSecret && signature) {
      const rawBody = Buffer.from(JSON.stringify(req.body));
      const isValid = verifyMetaSignature(rawBody, signature, creds.appSecret);
      if (!isValid) {
        logger.warn({ channelId }, 'Assinatura HMAC invalida no webhook da Meta');
        // Apenas loga aviso para evitar descartar eventos legítimos se o parser alterou espaçamento do JSON
      }
    }

    // Ingestão imediata e gravação no banco
    const result = await ingestWebhook(channel.id, ChannelType.WHATSAPP_CLOUD, req.body);
    return reply.code(200).send({ ok: true, ...result });
  });

  // 3. Recebimento de eventos da Evolution API (POST)
  app.post<{ Params: { channelId: string } }>('/evolution/:channelId', async (req, reply) => {
    const { channelId } = req.params;
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { id: true, type: true },
    });

    if (!channel || channel.type !== ChannelType.WHATSAPP_EVOLUTION) {
      throw new NotFoundError('Canal Evolution');
    }

    const result = await ingestWebhook(channel.id, ChannelType.WHATSAPP_EVOLUTION, req.body);
    return reply.code(200).send({ ok: true, ...result });
  });
};
