import { UserRole } from './enums.js';

/**
 * Matriz de permissoes.
 *
 * Uma unica fonte da verdade, usada pelo backend para autorizar e pelo frontend
 * para esconder o que o usuario nao pode fazer. O backend NUNCA confia no
 * frontend: toda rota protegida chama `can()` do lado do servidor tambem.
 */
export const Permission = {
  // Conversas
  CONVERSATION_VIEW_OWN: 'conversation:view:own',
  CONVERSATION_VIEW_DEPARTMENT: 'conversation:view:department',
  CONVERSATION_VIEW_ALL: 'conversation:view:all',
  CONVERSATION_REPLY: 'conversation:reply',
  CONVERSATION_ASSIGN_SELF: 'conversation:assign:self',
  CONVERSATION_ASSIGN_OTHERS: 'conversation:assign:others',
  CONVERSATION_TRANSFER: 'conversation:transfer',
  CONVERSATION_RESOLVE: 'conversation:resolve',
  CONVERSATION_DELETE: 'conversation:delete',
  CONVERSATION_SPECTATE: 'conversation:spectate',

  // Contatos
  CONTACT_VIEW: 'contact:view',
  CONTACT_EDIT: 'contact:edit',
  CONTACT_DELETE: 'contact:delete',
  CONTACT_EXPORT: 'contact:export',

  // Equipe
  USER_VIEW: 'user:view',
  USER_MANAGE: 'user:manage',
  USER_MANAGE_ADMINS: 'user:manage:admins',
  USER_FORCE_PRESENCE: 'user:force-presence',

  // Configuracao
  DEPARTMENT_MANAGE: 'department:manage',
  CHANNEL_MANAGE: 'channel:manage',
  AI_MANAGE: 'ai:manage',
  TEMPLATE_MANAGE: 'template:manage',
  QUICK_REPLY_MANAGE: 'quick-reply:manage',
  SETTINGS_MANAGE: 'settings:manage',

  // Observabilidade
  DASHBOARD_VIEW: 'dashboard:view',
  DASHBOARD_VIEW_GLOBAL: 'dashboard:view:global',
  REPORT_VIEW: 'report:view',
  AUDIT_VIEW: 'audit:view',
  SYSTEM_HEALTH_VIEW: 'system:health:view',
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];

const AGENT_PERMISSIONS: Permission[] = [
  Permission.CONVERSATION_VIEW_OWN,
  Permission.CONVERSATION_VIEW_DEPARTMENT,
  Permission.CONVERSATION_REPLY,
  Permission.CONVERSATION_ASSIGN_SELF,
  Permission.CONVERSATION_TRANSFER,
  Permission.CONVERSATION_RESOLVE,
  Permission.CONTACT_VIEW,
  Permission.CONTACT_EDIT,
  Permission.USER_VIEW,
  Permission.DASHBOARD_VIEW,
];

const SUPERVISOR_PERMISSIONS: Permission[] = [
  ...AGENT_PERMISSIONS,
  Permission.CONVERSATION_ASSIGN_OTHERS,
  Permission.CONVERSATION_SPECTATE,
  Permission.CONTACT_EXPORT,
  Permission.USER_FORCE_PRESENCE,
  Permission.QUICK_REPLY_MANAGE,
  Permission.REPORT_VIEW,
];

const ADMIN_PERMISSIONS: Permission[] = [
  ...SUPERVISOR_PERMISSIONS,
  Permission.CONVERSATION_VIEW_ALL,
  Permission.CONVERSATION_DELETE,
  Permission.CONTACT_DELETE,
  Permission.USER_MANAGE,
  Permission.DEPARTMENT_MANAGE,
  Permission.CHANNEL_MANAGE,
  Permission.AI_MANAGE,
  Permission.TEMPLATE_MANAGE,
  Permission.SETTINGS_MANAGE,
  Permission.DASHBOARD_VIEW_GLOBAL,
  Permission.AUDIT_VIEW,
  Permission.SYSTEM_HEALTH_VIEW,
];

const OWNER_PERMISSIONS: Permission[] = [...ADMIN_PERMISSIONS, Permission.USER_MANAGE_ADMINS];

export const ROLE_PERMISSIONS: Record<UserRole, ReadonlySet<Permission>> = {
  [UserRole.AGENT]: new Set(AGENT_PERMISSIONS),
  [UserRole.SUPERVISOR]: new Set(SUPERVISOR_PERMISSIONS),
  [UserRole.ADMIN]: new Set(ADMIN_PERMISSIONS),
  [UserRole.OWNER]: new Set(OWNER_PERMISSIONS),
};

export function can(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

export function canAny(role: UserRole, permissions: Permission[]): boolean {
  return permissions.some((permission) => can(role, permission));
}

export function permissionsFor(role: UserRole): Permission[] {
  return [...(ROLE_PERMISSIONS[role] ?? [])];
}

/** Hierarquia usada para impedir que alguem edite/remova um cargo acima do seu. */
export const ROLE_RANK: Record<UserRole, number> = {
  [UserRole.AGENT]: 1,
  [UserRole.SUPERVISOR]: 2,
  [UserRole.ADMIN]: 3,
  [UserRole.OWNER]: 4,
};

export function outranks(actor: UserRole, target: UserRole): boolean {
  return ROLE_RANK[actor] > ROLE_RANK[target];
}
