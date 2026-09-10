import type { FastifyPluginAsync } from 'fastify';
import {
  ConversationPriority,
  Permission,
  assignConversationSchema,
  listConversationsSchema,
  resolveConversationSchema,
  transferConversationSchema,
  updateConversationSchema,
} from '@crm/shared';
import { prisma } from '../../db/prisma.js';
import { NotFoundError } from '../../lib/errors.js';
import {
  assignConversation,
  getConversation,
  listConversations,
  resolve,
  toggleAiControlled,
  transfer,
  deleteConversation,
} from './service.js';
import { conversationInclude, toConversationSummary } from './serializer.js';
import { emitConversationUpdated } from '../../realtime/emitter.js';
import { assertConversationAccess } from './access.js';

export const conversationRoutes: FastifyPluginAsync = async (app) => {
  // Listar conversas com filtros
  app.get('/', async (req, reply) => {
    req.authorize(Permission.CONVERSATION_VIEW_OWN);
    const query = listConversationsSchema.parse(req.query);

    const result = await listConversations(
      req.user.orgId,
      {
        id: req.user.id,
        // `orgId` faz parte do sujeito: `canAccessConversation` compara a
        // organizacao antes de tudo. Sem ele a comparacao era contra
        // undefined e NENHUMA conversa passava no filtro.
        orgId: req.user.orgId,
        role: req.user.role,
        departmentIds: req.user.departments.map((d) => d.id),
      },
      query,
    );

    return reply.send(result);
  });

  // Detalhes da conversa
  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    req.authorize(Permission.CONVERSATION_VIEW_OWN);
    const conversation = await getConversation(req.params.id, {
      id: req.user.id,
      orgId: req.user.orgId,
      role: req.user.role,
      departmentIds: req.user.departments.map((department) => department.id),
    });
    return reply.send(conversation);
  });

  // Atribuir conversa (assumir para si ou designar atendente)
  app.post<{ Params: { id: string } }>('/:id/assign', async (req, reply) => {
    const input = assignConversationSchema.parse(req.body);
    const isAssigningSelf = input.userId === req.user.id;

    if (isAssigningSelf) {
      req.authorize(Permission.CONVERSATION_ASSIGN_SELF);
      await assertConversationAccess(
        {
          id: req.user.id,
          orgId: req.user.orgId,
          role: req.user.role,
          departmentIds: req.user.departments.map((department) => department.id),
        },
        req.params.id,
        'claim',
      );
    } else {
      req.authorize(Permission.CONVERSATION_ASSIGN_OTHERS);
      await assertConversationAccess(
        {
          id: req.user.id,
          orgId: req.user.orgId,
          role: req.user.role,
          departmentIds: req.user.departments.map((department) => department.id),
        },
        req.params.id,
        'manage',
      );
    }

    const result = await assignConversation(req.params.id, input.userId, req.user.id);
    return reply.send(result);
  });

  // Transferir conversa para outro atendente ou setor
  app.post<{ Params: { id: string } }>('/:id/transfer', async (req, reply) => {
    req.authorize(Permission.CONVERSATION_TRANSFER);
    await assertConversationAccess(
      {
        id: req.user.id,
        orgId: req.user.orgId,
        role: req.user.role,
        departmentIds: req.user.departments.map((department) => department.id),
      },
      req.params.id,
      'manage',
    );
    const input = transferConversationSchema.parse(req.body);

    const result = await transfer(req.params.id, req.user.id, {
      departmentId: input.departmentId,
      userId: input.userId,
      note: input.note,
    });

    return reply.send(result);
  });

  // Finalizar conversa
  app.post<{ Params: { id: string } }>('/:id/resolve', async (req, reply) => {
    req.authorize(Permission.CONVERSATION_RESOLVE);
    await assertConversationAccess(
      {
        id: req.user.id,
        orgId: req.user.orgId,
        role: req.user.role,
        departmentIds: req.user.departments.map((department) => department.id),
      },
      req.params.id,
      'manage',
    );
    const input = resolveConversationSchema.parse(req.body);

    const result = await resolve(
      req.params.id,
      req.user.orgId,
      req.user.id,
      input.sendClosingMessage,
    );

    return reply.send(result);
  });

  /**
   * Excluir a conversa e todo o historico dela.
   *
   * `CONVERSATION_DELETE` pertence apenas a ADMIN e OWNER (ver a matriz em
   * @crm/shared). Atendente e supervisor recebem 403 - a operacao e
   * irreversivel e apaga mensagens que sao registro do atendimento.
   */
  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    req.authorize(Permission.CONVERSATION_DELETE);
    await assertConversationAccess(
      {
        id: req.user.id,
        orgId: req.user.orgId,
        role: req.user.role,
        departmentIds: req.user.departments.map((department) => department.id),
      },
      req.params.id,
      'manage',
    );
    const result = await deleteConversation(req.params.id, req.user.orgId, req.user.id);
    return reply.send(result);
  });

  // Alternar controle da IA (ligar ou desligar robô na conversa)
  app.put<{ Params: { id: string }; Body: { aiControlled: boolean } }>('/:id/ai', async (req, reply) => {
    req.authorize(Permission.CONVERSATION_REPLY);
    await assertConversationAccess(
      {
        id: req.user.id,
        orgId: req.user.orgId,
        role: req.user.role,
        departmentIds: req.user.departments.map((department) => department.id),
      },
      req.params.id,
      'reply',
    );
    const { aiControlled } = req.body;
    const result = await toggleAiControlled(req.params.id, req.user.orgId, aiControlled);
    return reply.send(result);
  });

  // Atualizar propriedades da conversa (prioridade, tags, assunto)
  app.put<{ Params: { id: string } }>('/:id', async (req, reply) => {
    req.authorize(Permission.CONVERSATION_REPLY);
    await assertConversationAccess(
      {
        id: req.user.id,
        orgId: req.user.orgId,
        role: req.user.role,
        departmentIds: req.user.departments.map((department) => department.id),
      },
      req.params.id,
      'reply',
    );
    const input = updateConversationSchema.parse(req.body);

    const conversation = await prisma.conversation.findFirst({
      where: { id: req.params.id, orgId: req.user.orgId },
    });
    if (!conversation) throw new NotFoundError('Conversa');

    const updated = await prisma.conversation.update({
      where: { id: req.params.id },
      data: {
        priority: input.priority as ConversationPriority | undefined,
        subject: input.subject,
        tags: input.tags,
        aiControlled: input.aiControlled,
      },
      include: conversationInclude,
    });

    const summary = toConversationSummary(updated);
    await emitConversationUpdated(req.user.orgId, summary);
    return reply.send(summary);
  });
};
