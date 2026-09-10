import type { FastifyPluginAsync } from 'fastify';
import {
  MessageSenderType,
  MessageType,
  Permission,
  Room,
  paginationSchema,
  sendMessageSchema,
} from '@crm/shared';
import { prisma } from '../../db/prisma.js';
import { NotFoundError } from '../../lib/errors.js';
import { createOutboundMessage } from './outbox.js';
import { messageInclude, toMessageDTO } from '../conversations/serializer.js';
import { publishRealtime } from '../../realtime/bus.js';
import { assertConversationAccess } from '../conversations/access.js';

function conversationSubject(req: { user: { id: string; orgId: string; role: string; departments: { id: string }[] } }) {
  return {
    id: req.user.id,
    orgId: req.user.orgId,
    role: req.user.role,
    departmentIds: req.user.departments.map((department) => department.id),
  };
}

export const messageRoutes: FastifyPluginAsync = async (app) => {
  // Histórico de mensagens de uma conversa
  app.get<{ Params: { conversationId: string } }>(
    '/conversations/:conversationId/messages',
    async (req, reply) => {
      req.authorize(Permission.CONVERSATION_VIEW_OWN);
      const query = paginationSchema.parse(req.query);
      const limit = Math.min(query.limit ?? 50, 100);

      const access = await assertConversationAccess(
        conversationSubject(req),
        req.params.conversationId,
        'view',
      );
      const conversation = await prisma.conversation.findUnique({ where: { id: access.id } });
      if (!conversation) throw new NotFoundError('Conversa');

      // Zera contador de não lidas quando o atendente abre as mensagens
      if (conversation.unreadCount > 0 && conversation.assignedUserId === req.user.id) {
        await prisma.conversation.update({
          where: { id: conversation.id },
          data: { unreadCount: 0 },
        });
      }

      const messages = await prisma.message.findMany({
        where: { conversationId: conversation.id },
        include: messageInclude,
        orderBy: { createdAt: 'desc' },
        take: limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });

      const hasMore = messages.length > limit;
      const page = hasMore ? messages.slice(0, limit) : messages;

      // Inverte para entregar em ordem cronológica (mais antiga -> mais nova)
      const chronological = [...page].reverse();

      return reply.send({
        items: chronological.map(toMessageDTO),
        nextCursor: hasMore ? page.at(-1)?.id ?? null : null,
      });
    },
  );

  // Envio de nova mensagem ou nota interna privada
  app.post<{ Params: { conversationId: string } }>(
    '/conversations/:conversationId/messages',
    async (req, reply) => {
      req.authorize(Permission.CONVERSATION_REPLY);
      const input = sendMessageSchema.parse(req.body);

      await assertConversationAccess(conversationSubject(req), req.params.conversationId, 'reply');

      if (input.mediaId) {
        const media = await prisma.mediaAsset.findFirst({
          where: { id: input.mediaId, orgId: req.user.orgId },
          select: { id: true },
        });
        if (!media) throw new NotFoundError('Arquivo de midia');
      }

      if (input.replyToMessageId) {
        const replyTo = await prisma.message.findFirst({
          where: { id: input.replyToMessageId, conversationId: req.params.conversationId },
          select: { id: true },
        });
        if (!replyTo) throw new NotFoundError('Mensagem respondida');
      }

      const result = await createOutboundMessage({
        conversationId: req.params.conversationId,
        type: input.type as MessageType,
        content: input.content,
        mediaId: input.mediaId,
        replyToMessageId: input.replyToMessageId,
        senderType: MessageSenderType.AGENT,
        senderUserId: req.user.id,
        isPrivate: input.isPrivate,
        clientMessageId: input.clientMessageId,
        bypassWindowCheck: Boolean(input.template),
      });

      return reply.code(201).send(result);
    },
  );

  // Emissão de digitação (typing indicator)
  app.post<{ Params: { conversationId: string }; Body: { isTyping: boolean } }>(
    '/conversations/:conversationId/typing',
    async (req, reply) => {
      req.authorize(Permission.CONVERSATION_REPLY);
      await assertConversationAccess(conversationSubject(req), req.params.conversationId, 'reply');
      const { isTyping } = req.body;
      const room = Room.conversation(req.params.conversationId);

      if (isTyping) {
        await publishRealtime(room, 'typing:start', {
          conversationId: req.params.conversationId,
          userId: req.user.id,
          userName: req.user.name,
        });
      } else {
        await publishRealtime(room, 'typing:stop', {
          conversationId: req.params.conversationId,
          userId: req.user.id,
        });
      }

      return reply.send({ ok: true });
    },
  );
};
