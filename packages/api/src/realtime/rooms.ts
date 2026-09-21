import { Room, UserRole, type SocketData } from '@crm/shared';

export interface ConversationScope {
  orgId: string;
  conversationId: string;
  departmentId: string | null;
  assignedUserId: string | null;
  /** Atendente anterior, para a interface remover a conversa que ele perdeu. */
  previousUserId?: string | null;
}

/**
 * Salas autorizadas a receber dados de uma conversa.
 *
 * Esta e a representacao em salas da regra de `canAccessConversation`:
 * administradores veem toda a organizacao; supervisores veem apenas seus
 * setores; atendentes veem a fila do setor enquanto ela esta sem dono e,
 * depois da atribuicao, somente o responsavel recebe os dados completos.
 *
 * A sala da conversa fica reservada para digitacao. Inclui-la aqui manteria
 * acesso para quem abriu a conversa antes de ela ser transferida.
 */
export function conversationRooms(scope: ConversationScope): string[] {
  const rooms = [Room.orgAdmin(scope.orgId)];

  if (scope.assignedUserId) {
    rooms.push(Room.user(scope.assignedUserId));
    if (scope.departmentId) rooms.push(Room.departmentSupervisor(scope.departmentId));
  } else if (scope.departmentId) {
    rooms.push(Room.department(scope.departmentId));
  }

  // O destinatario anterior recebe o evento somente para conseguir retirar a
  // conversa da interface. O dispatcher troca o payload completo por
  // `conversation:removed` caso ele ja nao tenha permissao de leitura.
  if (scope.previousUserId) rooms.push(Room.user(scope.previousUserId));

  return [...new Set(rooms)];
}

/** Salas derivadas da identidade atual do usuario. */
export function baseRealtimeRooms(identity: SocketData): Set<string> {
  const rooms = new Set<string>([
    Room.user(identity.userId),
    Room.presence(identity.orgId),
  ]);

  for (const departmentId of identity.departmentIds) {
    rooms.add(Room.department(departmentId));
    if (identity.role === UserRole.SUPERVISOR) {
      rooms.add(Room.departmentSupervisor(departmentId));
    }
  }

  if (identity.role === UserRole.ADMIN || identity.role === UserRole.OWNER) {
    rooms.add(Room.orgAdmin(identity.orgId));
  }

  return rooms;
}
