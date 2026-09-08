import type { FastifyPluginAsync } from 'fastify';
import { Permission, updateAiPersonaSchema } from '@crm/shared';
import { prisma } from '../../db/prisma.js';
import { getActivePersona } from './persona.js';

export const aiRoutes: FastifyPluginAsync = async (app) => {
  // Retorna a persona ativa e estatísticas de uso
  app.get('/persona', async (req, reply) => {
    req.authorize(Permission.AI_MANAGE);
    const persona = await getActivePersona(req.user.orgId);
    return reply.send(persona);
  });

  // Atualiza as configurações da IA (Prompt, Modelo, Temperatura, Metas)
  app.put('/persona', async (req, reply) => {
    req.authorize(Permission.AI_MANAGE);
    const input = updateAiPersonaSchema.parse(req.body);

    const existing = await prisma.aiPersona.findFirst({
      where: { orgId: req.user.orgId },
    });

    const data = {
      name: input.name ?? 'Atendente Virtual Central Pneus',
      systemPrompt: input.systemPrompt,
      greeting: input.greeting,
      provider: input.provider,
      model: input.model,
      temperature: input.temperature,
      maxTurnsBeforeHandoff: input.maxTurnsBeforeHandoff,
      qualificationGoals: input.qualificationGoals ? (input.qualificationGoals as never) : undefined,
      isActive: input.isActive,
    };

    const updated = existing
      ? await prisma.aiPersona.update({
          where: { id: existing.id },
          data,
        })
      : await prisma.aiPersona.create({
          data: {
            orgId: req.user.orgId,
            ...data,
            systemPrompt: data.systemPrompt ?? 'Prompt da Central Pneus',
          },
        });

    return reply.send(updated);
  });

  // Métricas de consumo da IA (Tokens e Custo USD)
  app.get('/usage', async (req, reply) => {
    req.authorize(Permission.AI_MANAGE);

    const [totalUsage, usageByModel] = await Promise.all([
      prisma.aiUsage.aggregate({
        where: { orgId: req.user.orgId },
        _sum: { inputTokens: true, outputTokens: true, costUsd: true },
        _count: { _all: true },
      }),
      prisma.aiUsage.groupBy({
        by: ['model', 'provider'],
        where: { orgId: req.user.orgId },
        _sum: { inputTokens: true, outputTokens: true, costUsd: true },
        _count: { _all: true },
      }),
    ]);

    return reply.send({
      totalCostUsd: totalUsage._sum.costUsd ?? 0,
      totalInteractions: totalUsage._count._all,
      totalInputTokens: totalUsage._sum.inputTokens ?? 0,
      totalOutputTokens: totalUsage._sum.outputTokens ?? 0,
      breakdown: usageByModel,
    });
  });
};
