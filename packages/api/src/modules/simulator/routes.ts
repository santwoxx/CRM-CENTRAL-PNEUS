import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { env } from '../../env.js';
import { ForbiddenError } from '../../lib/errors.js';
import { simulateInboundMessage } from './service.js';

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
  text: z.string().trim().min(1).max(2000),
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
    });

    return reply.send(result);
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
