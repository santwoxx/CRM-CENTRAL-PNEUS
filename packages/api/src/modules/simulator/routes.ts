import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { MessageType } from '@crm/shared';
import { env } from '../../env.js';
import { ForbiddenError } from '../../lib/errors.js';
import {
  getSimulatedConversation,
  resetSimulatedContact,
  simulateInboundMessage,
} from './service.js';

/**
 * Rotas do simulador.
 *
 * Exigem login (o plugin de auth cuida disso) e podem ser desligadas por
 * configuracao. Em producao com WhatsApp real ligado, desligue: elas criam
 * conversas de verdade no banco.
 */

const simulateSchema = z.object({
  phone: z.string().trim().min(8).max(20),
  name: z.string().trim().max(120).optional(),
  // Vazio e valido para midia: um audio nao tem legenda.
  text: z.string().trim().max(2000).default(''),
  type: z
    .enum(['TEXT', 'AUDIO', 'IMAGE', 'VIDEO', 'DOCUMENT'])
    .default('TEXT'),
});

export const simulatorRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', async () => {
    if (!env.SIMULATOR_ENABLED) {
      throw new ForbiddenError('Simulador desativado (SIMULATOR_ENABLED=false)', 'SIMULATOR_OFF');
    }
  });

  // Envia uma mensagem como se fosse o cliente no WhatsApp.
  app.post('/message', async (req, reply) => {
    const input = simulateSchema.parse(req.body);

    const result = await simulateInboundMessage({
      orgId: req.user.orgId,
      phone: input.phone,
      name: input.name,
      text: input.text,
      type: input.type as MessageType,
    });

    return reply.send(result);
  });

  // A conversa como o cliente a veria no celular dele.
  app.get('/conversation', async (req, reply) => {
    const query = req.query as { phone?: string };
    const view = await getSimulatedConversation(req.user.orgId, query.phone ?? '');
    return reply.send(view);
  });

  // Zera o contato para recomecar a demonstracao do zero.
  app.post('/reset', async (req, reply) => {
    const body = req.body as { phone?: string };
    const removed = await resetSimulatedContact(req.user.orgId, body?.phone ?? '');
    return reply.send({ removed });
  });

  // Roteiro pronto para demonstrar o sistema em 4 mensagens.
  app.get('/roteiro', async (_req, reply) =>
    reply.send({
      titulo: 'Roteiro de demonstracao',
      passos: [
        {
          texto: 'Bom dia! Vocês têm pneu 205/55 R16?',
          esperado: 'A IA identifica a medida e responde com preço e estoque reais do catálogo.',
        },
        {
          texto: 'Quero um jogo, quanto fica?',
          esperado: 'Calcula o total das 4 unidades a partir do preço do banco.',
        },
        {
          texto: 'Quero falar com um vendedor',
          esperado: 'Transfere para a fila de Vendas e distribui para um atendente online.',
        },
        {
          texto: 'Meu pneu está com uma bolha na lateral',
          esperado: 'Reconhece caso de segurança e encaminha direto para a Oficina.',
        },
      ],
    }),
  );
};
