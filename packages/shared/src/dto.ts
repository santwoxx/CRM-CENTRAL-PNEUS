import { z } from 'zod';
import {
  AgentPresence,
  ChannelType,
  ConversationPriority,
  ConversationStatus,
  LifecycleStage,
  MessageType,
  RoutingStrategy,
  UserRole,
} from './enums.js';
import { normalizePhone } from './phone.js';

/**
 * Schemas de entrada da API.
 *
 * Ficam no pacote compartilhado para que o formulario do frontend valide com
 * exatamente a mesma regra que o backend aplica - sem chance de divergir.
 */

const enumOf = <T extends Record<string, string>>(obj: T) =>
  z.enum(Object.values(obj) as [string, ...string[]]);

export const cuidSchema = z.string().min(20).max(40);

export const paginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const phoneSchema = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const normalized = normalizePhone(value);
    if (!normalized) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Telefone invalido' });
      return z.NEVER;
    }
    return normalized;
  });

// --- Autenticacao ---------------------------------------------------------

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('E-mail invalido'),
  password: z.string().min(1, 'Informe a senha'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({ refreshToken: z.string().min(1) });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z
      .string()
      .min(10, 'A senha precisa de pelo menos 10 caracteres')
      .regex(/[a-z]/, 'Inclua ao menos uma letra minuscula')
      .regex(/[A-Z]/, 'Inclua ao menos uma letra maiuscula')
      .regex(/\d/, 'Inclua ao menos um numero'),
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: 'A nova senha precisa ser diferente da atual',
    path: ['newPassword'],
  });

// --- Equipe ---------------------------------------------------------------

export const createUserSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  // A mesma exigencia da troca de senha. Antes, criar usuario aceitava dez
  // letras iguais enquanto trocar exigia complexidade: a porta de entrada
  // era mais fraca que a de manutencao.
  password: z
    .string()
    .min(10, 'A senha precisa de pelo menos 10 caracteres')
    .max(200)
    .regex(/[a-z]/, 'Inclua ao menos uma letra minuscula')
    .regex(/[A-Z]/, 'Inclua ao menos uma letra maiuscula')
    .regex(/\d/, 'Inclua ao menos um numero'),
  role: enumOf(UserRole).default(UserRole.AGENT),
  maxConcurrentChats: z.number().int().min(1).max(50).default(5),
  departmentIds: z.array(cuidSchema).default([]),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = createUserSchema
  .omit({ password: true })
  .partial()
  .extend({ isActive: z.boolean().optional() });

export const setPresenceSchema = z.object({
  presence: enumOf(AgentPresence),
});

// --- Setores --------------------------------------------------------------

export const createDepartmentSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).nullish(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Use uma cor hexadecimal, ex.: #2563eb')
    .default('#2563eb'),
  menuLabel: z.string().trim().max(24, 'O WhatsApp corta rotulos acima de 24 caracteres').nullish(),
  showInMenu: z.boolean().default(true),
  order: z.number().int().min(0).max(999).default(0),
  routingStrategy: enumOf(RoutingStrategy).default(RoutingStrategy.LEAST_BUSY),
  aiEnabled: z.boolean().default(true),
  offlineMessage: z.string().trim().max(1000).nullish(),
  closingMessage: z.string().trim().max(1000).nullish(),
  businessHours: z
    .array(
      z.object({
        weekday: z.number().int().min(0).max(6),
        start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      }),
    )
    .nullish(),
  memberIds: z.array(cuidSchema).default([]),
});
export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;

export const updateDepartmentSchema = createDepartmentSchema
  .partial()
  .extend({ isActive: z.boolean().optional() });

// --- Contatos -------------------------------------------------------------

export const createContactSchema = z.object({
  name: z.string().trim().min(1).max(160),
  phone: phoneSchema,
  email: z.string().trim().toLowerCase().email().nullish(),
  document: z.string().trim().max(20).nullish(),
  tags: z.array(z.string().trim().min(1).max(30)).max(30).default([]),
  notes: z.string().trim().max(5000).nullish(),
  lifecycleStage: enumOf(LifecycleStage).default(LifecycleStage.LEAD),
  customFields: z.record(z.unknown()).default({}),
  preferredAgentId: cuidSchema.nullish(),
});

export const updateContactSchema = createContactSchema.partial().extend({
  isBlocked: z.boolean().optional(),
});

export const listContactsSchema = paginationSchema.extend({
  search: z.string().trim().max(120).optional(),
  tag: z.string().trim().optional(),
  lifecycleStage: enumOf(LifecycleStage).optional(),
});

// --- Conversas ------------------------------------------------------------

export const listConversationsSchema = paginationSchema.extend({
  status: z
    .union([enumOf(ConversationStatus), z.array(enumOf(ConversationStatus))])
    .optional()
    .transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v])),
  departmentId: cuidSchema.optional(),
  assignedUserId: z.union([cuidSchema, z.literal('me'), z.literal('unassigned')]).optional(),
  channelId: cuidSchema.optional(),
  search: z.string().trim().max(120).optional(),
  tag: z.string().trim().optional(),
  onlyUnread: z.coerce.boolean().optional(),
  sort: z.enum(['recent', 'oldest', 'priority']).default('recent'),
});
export type ListConversationsQuery = z.infer<typeof listConversationsSchema>;

export const sendMessageSchema = z
  .object({
    type: enumOf(MessageType).default(MessageType.TEXT),
    content: z.string().trim().max(4096).optional(),
    /** Id do upload previamente enviado para /uploads. */
    mediaId: cuidSchema.optional(),
    fileName: z.string().trim().max(255).optional(),
    replyToMessageId: cuidSchema.optional(),
    /** Nota interna: fica no historico mas nao vai para o cliente. */
    isPrivate: z.boolean().default(false),
    /** Chave de idempotencia gerada pelo cliente; impede envio duplicado. */
    clientMessageId: z.string().trim().min(8).max(64).optional(),
    /** Template aprovado, obrigatorio fora da janela de 24h. */
    template: z
      .object({
        name: z.string().min(1),
        language: z.string().min(2).max(10).default('pt_BR'),
        variables: z.array(z.string()).default([]),
      })
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (data.type === MessageType.TEXT && !data.content?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['content'],
        message: 'Mensagem de texto nao pode ser vazia',
      });
    }

    const mediaTypes: string[] = [
      MessageType.IMAGE,
      MessageType.AUDIO,
      MessageType.VIDEO,
      MessageType.DOCUMENT,
    ];
    if (mediaTypes.includes(data.type) && !data.mediaId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['mediaId'],
        message: 'Envie o arquivo antes de mandar a mensagem',
      });
    }

    if (data.type === MessageType.TEMPLATE && !data.template) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['template'],
        message: 'Informe o template aprovado',
      });
    }

    if (data.isPrivate && data.type !== MessageType.TEXT) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['isPrivate'],
        message: 'Nota interna aceita apenas texto',
      });
    }
  });
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const assignConversationSchema = z.object({
  /** `null` devolve a conversa para a fila. */
  userId: cuidSchema.nullable(),
  departmentId: cuidSchema.nullish(),
  reason: z.string().trim().max(500).optional(),
});

export const transferConversationSchema = z
  .object({
    departmentId: cuidSchema.nullish(),
    userId: cuidSchema.nullish(),
    note: z.string().trim().max(1000).optional(),
  })
  .refine((data) => Boolean(data.departmentId ?? data.userId), {
    message: 'Escolha um setor ou um atendente de destino',
  });

export const updateConversationSchema = z.object({
  priority: enumOf(ConversationPriority).optional(),
  subject: z.string().trim().max(200).nullish(),
  tags: z.array(z.string().trim().min(1).max(30)).max(30).optional(),
  aiControlled: z.boolean().optional(),
});

export const resolveConversationSchema = z.object({
  note: z.string().trim().max(1000).optional(),
  sendClosingMessage: z.boolean().default(true),
});

// --- Canais ---------------------------------------------------------------

export const createChannelSchema = z.object({
  type: enumOf(ChannelType),
  name: z.string().trim().min(2).max(80),
  isDefault: z.boolean().default(false),
  credentials: z.record(z.string()).default({}),
});

export const updateChannelSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  isActive: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  credentials: z.record(z.string()).optional(),
});

// --- IA -------------------------------------------------------------------

export const updateAiPersonaSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  systemPrompt: z.string().trim().min(20).max(20000).optional(),
  greeting: z.string().trim().max(1000).nullish(),
  provider: z.enum(['anthropic', 'openai']).optional(),
  model: z.string().trim().min(3).max(80).optional(),
  temperature: z.number().min(0).max(1).optional(),
  maxTurnsBeforeHandoff: z.number().int().min(1).max(50).optional(),
  /** Perguntas que a IA precisa responder antes de considerar o lead aquecido. */
  qualificationGoals: z.array(z.string().trim().min(3).max(200)).max(20).optional(),
  isActive: z.boolean().optional(),
});

export const quickReplySchema = z.object({
  shortcut: z
    .string()
    .trim()
    .min(2)
    .max(30)
    .regex(/^[a-z0-9-]+$/, 'Use apenas letras minusculas, numeros e hifen'),
  content: z.string().trim().min(1).max(4096),
  departmentId: cuidSchema.nullish(),
});

// --- Relatorios -----------------------------------------------------------

export const dateRangeSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  departmentId: cuidSchema.optional(),
  userId: cuidSchema.optional(),
});
