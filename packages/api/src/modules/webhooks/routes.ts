import type { FastifyPluginAsync } from 'fastify';
import { ChannelType } from '@crm/shared';
import { prisma } from '../../db/prisma.js';
import { NotFoundError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { safeCompare, verifyMetaSignature } from '../../lib/crypto.js';
import { getChannelCredentials } from '../../channels/registry.js';
import { ingestWebhook } from '../messages/inbound.js';
import { env } from '../../env.js';

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

    // O token nunca entra no log: ele e uma credencial compartilhada e o log
    // costuma ser acessivel por mais pessoas que a configuracao do canal.
    logger.warn({ channelId }, 'Falha na verificacao do webhook do WhatsApp Cloud: token incorreto');
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

    if (!creds?.appSecret) {
      logger.error({ channelId }, 'Webhook da Meta sem App Secret configurado');
      return reply.code(503).send({
        error: {
          code: 'WEBHOOK_NOT_CONFIGURED',
          message: 'Canal sem App Secret para validar o webhook',
        },
      });
    }

    // Falha fechada: aceitar um evento sem HMAC permitiria que qualquer
    // pessoa que descobrisse o channelId injetasse mensagens no atendimento.
    // A Meta assina exatamente os bytes recebidos, preservados pelo parser
    // acima; reserializar req.body muda espacos/ordem e invalida a assinatura.
    if (!webhookMetaAutentico(req.rawWebhookBody, signature, creds.appSecret)) {
      logger.warn(
        { channelId, hasSignature: Boolean(signature), hasRawBody: Boolean(req.rawWebhookBody) },
        'Assinatura HMAC invalida no webhook da Meta',
      );
      return reply.code(401).send({
        error: { code: 'INVALID_WEBHOOK_SIGNATURE', message: 'Assinatura invalida' },
      });
    }

    // Ingestão imediata e gravação no banco
    const result = await ingestWebhook(channel.id, ChannelType.WHATSAPP_CLOUD, req.body);
    return reply.code(200).send({ ok: true, ...result });
  });

  // 3. Recebimento de eventos da Evolution API (POST)
  app.post<{ Params: { channelId: string } }>('/evolution/:channelId', async (req, reply) => {
    const { channelId } = req.params;

    // A Evolution nao assina o corpo como a Meta. Sem um segredo, qualquer um
    // que descobrisse o channelId injetaria mensagens de "cliente" - e cada
    // uma dispara resposta da IA, que e paga, sem limite de taxa, porque
    // webhooks sao isentos dele. Falha fechada, como no webhook da Meta.
    if (!env.EVOLUTION_WEBHOOK_SECRET) {
      logger.error({ channelId }, 'Webhook da Evolution sem EVOLUTION_WEBHOOK_SECRET configurado');
      return reply.code(503).send({
        error: {
          code: 'WEBHOOK_NOT_CONFIGURED',
          message: 'Defina EVOLUTION_WEBHOOK_SECRET para receber mensagens da Evolution',
        },
      });
    }

    // Autentica antes de ir ao banco: spam nao gera consulta e a resposta
    // nao revela se o canal existe.
    const tokenRecebido =
      (req.headers['x-webhook-token'] as string | undefined) ??
      (req.query as { token?: string } | undefined)?.token;

    if (!webhookEvolutionAutentico(tokenRecebido, env.EVOLUTION_WEBHOOK_SECRET)) {
      logger.warn({ channelId, temToken: Boolean(tokenRecebido) }, 'Token invalido no webhook da Evolution');
      return reply.code(401).send({
        error: { code: 'INVALID_WEBHOOK_TOKEN', message: 'Token invalido' },
      });
    }

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

/** Exportada para testar a fronteira criptografica sem banco nem provedor. */
export function webhookMetaAutentico(
  rawBody: Buffer | undefined,
  signature: string | undefined,
  appSecret: string,
): boolean {
  return Boolean(rawBody && verifyMetaSignature(rawBody, signature, appSecret));
}

/**
 * Confere o token do webhook da Evolution em tempo constante.
 * Exportada para testar a fronteira sem banco nem provedor.
 */
export function webhookEvolutionAutentico(recebido: string | undefined, segredo: string): boolean {
  if (!segredo || !recebido) return false;
  return safeCompare(recebido, segredo);
}
