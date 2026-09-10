import { UserRole } from '@crm/shared';
import type { Prisma } from '../../db/prisma.js';
import { prisma } from '../../db/prisma.js';
import { ForbiddenError, NotFoundError } from '../../lib/errors.js';

/**
 * Fronteira unica de autorizacao para conversas.
 *
 * Permissoes de papel dizem se uma pessoa PODE executar uma acao. Este modulo
 * confere a outra metade, igualmente importante: se ela pode executar a acao
 * NESTA conversa. IDs CUID sao identificadores, nunca credenciais.
 */
export interface ConversationAccessSubject {
  id: string;
  orgId: string;
  role: UserRole | string;
  departmentIds: string[];
}

export interface ConversationAccessRecord {
  id: string;
  orgId: string;
  departmentId: string | null;
  assignedUserId: string | null;
}

export type ConversationAccessAction = 'view' | 'reply' | 'manage' | 'claim';

export const conversationAccessSelect = {
  id: true,
  orgId: true,
  departmentId: true,
  assignedUserId: true,
} satisfies Prisma.ConversationSelect;

function isGlobalManager(role: ConversationAccessSubject['role']): boolean {
  return role === UserRole.ADMIN || role === UserRole.OWNER;
}

function isDepartmentMember(subject: ConversationAccessSubject, conversation: ConversationAccessRecord): boolean {
  return Boolean(
    conversation.departmentId && subject.departmentIds.includes(conversation.departmentId),
  );
}

/** Retorna se o sujeito pode acessar a conversa para uma acao especifica. */
export function canAccessConversation(
  subject: ConversationAccessSubject,
  conversation: ConversationAccessRecord,
  action: ConversationAccessAction,
): boolean {
  if (conversation.orgId !== subject.orgId) return false;
  if (isGlobalManager(subject.role)) return true;

  const inDepartment = isDepartmentMember(subject, conversation);
  const isAssignee = conversation.assignedUserId === subject.id;
  const isUnassignedDepartmentQueue = conversation.assignedUserId === null && inDepartment;
  const isSupervisor = subject.role === UserRole.SUPERVISOR;

  if (action === 'view') {
    return isAssignee || isUnassignedDepartmentQueue || (isSupervisor && inDepartment);
  }

  if (action === 'claim') {
    return isUnassignedDepartmentQueue || (isSupervisor && inDepartment);
  }

  // Responder, transferir, encerrar ou editar exige ser o responsavel. Um
  // supervisor pode intervir apenas dentro de um setor ao qual pertence.
  return isAssignee || (isSupervisor && inDepartment);
}

/** Filtro Prisma que limita a listagem a conversas visiveis pelo sujeito. */
export function conversationVisibilityWhere(
  subject: ConversationAccessSubject,
): Prisma.ConversationWhereInput {
  if (isGlobalManager(subject.role)) return {};

  if (subject.role === UserRole.SUPERVISOR) {
    return { departmentId: { in: subject.departmentIds } };
  }

  return {
    OR: [
      { assignedUserId: subject.id },
      { assignedUserId: null, departmentId: { in: subject.departmentIds } },
    ],
  };
}

/** Busca e valida uma conversa para evitar IDOR em rotas e eventos Socket.IO. */
export async function assertConversationAccess(
  subject: ConversationAccessSubject,
  conversationId: string,
  action: ConversationAccessAction,
): Promise<ConversationAccessRecord> {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, orgId: subject.orgId },
    select: conversationAccessSelect,
  });

  if (!conversation) throw new NotFoundError('Conversa');
  if (!canAccessConversation(subject, conversation, action)) {
    throw new ForbiddenError('Voce nao tem acesso a esta conversa', 'CONVERSATION_ACCESS_DENIED');
  }

  return conversation;
}
