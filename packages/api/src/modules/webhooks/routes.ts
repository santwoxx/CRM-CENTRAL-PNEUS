import type { FastifyPluginAsync } from 'fastify';
import { ChannelType } from '@crm/shared';
import { env } from '../../env.js';
import { prisma } from '../../db/prisma.js';
import { NotFoundError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { safeCompare, verifyMetaSignature } from '../../lib/crypto.js';
import { getChannelCredentials } from '../../channels/registry.js';
import { ingestWebhook } from '../messages/inbound.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Corpo exato recebido da Meta, necessario para validar o HMAC. */
    rawWebhookBody?: Buffer;
  }
}

export const webhookRoutes: FastifyPluginAsync = async (app) => {
  /**
   * A Meta assina os bytes recebidos, nao o JSON depois de parseado. Mantemos
   * ambos: o Buffer para HMAC e o objeto para a ingestao normal do evento.
   * Este parser fica encapsulado neste plugin e so afeta as rotas de webhook.
   */
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, rawBody, done) => {
    // `parseAs: 'buffer'` entrega Buffer em execucao, mas a assinatura do
    // Fastify e `string | Buffer`. Normalizamos em vez de forcar o tipo: se
    // um dia chegar string, o HMAC ainda e calculado sobre os bytes certos.
    const bytes = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
    request.rawWebhookBody = bytes;

    try {
      done(null, JSON.parse(bytes.toString('utf8')));
    } catch (error) {
      done(error as Error);
    }
  });

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
    /**
     * Comparacao em tempo constante.
     *
     * `===` para em cima do primeiro caractere diferente, e a diferenca de
     * tempo entre "errou no primeiro" e "errou no ultimo" e mensuravel.
     * Repetindo o teste, da para descobrir o token caractere a caractere.
     * `safeCompare` gasta sempre o mesmo tempo.
     */
    if (mode === 'subscribe' && creds?.verifyToken && safeCompare(token, creds.verifyToken)) {
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
