import { LifecycleStage, phoneVariants, normalizePhone } from '@crm/shared';
import { prisma, Prisma } from '../../db/prisma.js';
import { logger } from '../../lib/logger.js';

/**
 * Resolucao de contato a partir de uma mensagem recebida.
 *
 * Esta funcao decide se quem mandou mensagem e alguem novo ou um cliente que
 * ja existe. Errar aqui parte o historico do cliente em dois cadastros - e o
 * atendente perde justamente o contexto que faz o atendimento ser bom.
 *
 * A busca acontece em tres niveis, do mais confiavel para o menos:
 *   1. Identidade exata no canal (channelId + externalId). Nao ha ambiguidade.
 *   2. Telefone em qualquer variante conhecida (com e sem o nono digito).
 *   3. Nada encontrado: cria o contato.
 */

export interface ResolveContactInput {
  orgId: string;
  channelId: string;
  /** wa_id / chat_id do provedor. */
  externalId: string;
  phone: string | null;
  pushName: string | null;
  raw?: unknown;
}

export interface ResolvedContact {
  id: string;
  isNew: boolean;
  isReturning: boolean;
  preferredAgentId: string | null;
  lastDepartmentId: string | null;
  isBlocked: boolean;
}

export async function resolveContact(input: ResolveContactInput): Promise<ResolvedContact> {
  const phone = input.phone ? normalizePhone(input.phone) : null;

  // 1. Identidade ja registrada neste canal.
  const identity = await prisma.contactIdentity.findUnique({
    where: { channelId_externalId: { channelId: input.channelId, externalId: input.externalId } },
    select: {
      contact: {
        select: {
          id: true,
          preferredAgentId: true,
          lastDepartmentId: true,
          isBlocked: true,
          pushName: true,
          name: true,
          phone: true,
          _count: { select: { conversations: true } },
        },
      },
    },
  });

  if (identity) {
    const contact = identity.contact;
    await refreshContact(contact.id, {
      pushName: input.pushName,
      currentPushName: contact.pushName,
      currentName: contact.name,
      phone: phone && !contact.phone ? phone : null,
    });

    return {
      id: contact.id,
      isNew: false,
      isReturning: contact._count.conversations > 0,
      preferredAgentId: contact.preferredAgentId,
      lastDepartmentId: contact.lastDepartmentId,
      isBlocked: contact.isBlocked,
    };
  }

  // 2. Mesmo telefone em outra variante (o WhatsApp entrega numeros antigos
  //    sem o nono digito; ver `phoneVariants`).
  if (phone) {
    const existing = await prisma.contact.findFirst({
      where: { orgId: input.orgId, phone: { in: phoneVariants(phone) } },
      select: {
        id: true,
        preferredAgentId: true,
        lastDepartmentId: true,
        isBlocked: true,
        pushName: true,
        name: true,
        _count: { select: { conversations: true } },
      },
    });

    if (existing) {
      // Registra a identidade para as proximas mensagens caírem no caso 1.
      await linkIdentity(existing.id, input);
      await refreshContact(existing.id, {
        pushName: input.pushName,
        currentPushName: existing.pushName,
        currentName: existing.name,
        phone: null,
      });

      return {
        id: existing.id,
        isNew: false,
        isReturning: existing._count.conversations > 0,
        preferredAgentId: existing.preferredAgentId,
        lastDepartmentId: existing.lastDepartmentId,
        isBlocked: existing.isBlocked,
      };
    }
  }

  // 3. Contato novo.
  return createContact(input, phone);
}

async function createContact(
  input: ResolveContactInput,
  phone: string | null,
): Promise<ResolvedContact> {
  const now = new Date();

  try {
    const contact = await prisma.contact.create({
      data: {
        orgId: input.orgId,
        name: input.pushName ?? null,
        pushName: input.pushName ?? null,
        phone,
        lifecycleStage: LifecycleStage.LEAD,
        firstContactAt: now,
        lastContactAt: now,
        identities: {
          create: {
            channelId: input.channelId,
            externalId: input.externalId,
            raw: (input.raw ?? undefined) as never,
          },
        },
      },
      select: { id: true },
    });

    logger.info({ contactId: contact.id, phone }, 'Contato criado');

    return {
      id: contact.id,
      isNew: true,
      isReturning: false,
      preferredAgentId: null,
      lastDepartmentId: null,
      isBlocked: false,
    };
  } catch (error) {
    // Corrida: duas mensagens do mesmo numero novo chegando ao mesmo tempo.
    // A restricao unica de (orgId, phone) barra a segunda; buscamos a primeira.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const existing = phone
        ? await prisma.contact.findFirst({
            where: { orgId: input.orgId, phone },
            select: {
              id: true,
              preferredAgentId: true,
              lastDepartmentId: true,
              isBlocked: true,
            },
          })
        : null;

      if (existing) {
        await linkIdentity(existing.id, input);
        return {
          id: existing.id,
          isNew: false,
          isReturning: false,
          preferredAgentId: existing.preferredAgentId,
          lastDepartmentId: existing.lastDepartmentId,
          isBlocked: existing.isBlocked,
        };
      }
    }

    throw error;
  }
}

async function linkIdentity(contactId: string, input: ResolveContactInput): Promise<void> {
  await prisma.contactIdentity
    .create({
      data: {
        contactId,
        channelId: input.channelId,
        externalId: input.externalId,
        raw: (input.raw ?? undefined) as never,
      },
    })
    .catch((error) => {
      // Outra requisicao pode ter criado a mesma identidade: isso e esperado.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return;
      throw error;
    });
}

/**
 * Atualiza o que muda a cada mensagem.
 *
 * O `pushName` (nome que o cliente configurou no WhatsApp) so sobrescreve o
 * campo `name` se ninguem tiver editado o nome manualmente - o cadastro feito
 * pela equipe vale mais do que o apelido do WhatsApp.
 */
async function refreshContact(
  contactId: string,
  input: {
    pushName: string | null;
    currentPushName: string | null;
    currentName: string | null;
    phone: string | null;
  },
): Promise<void> {
  const data: Prisma.ContactUpdateInput = { lastContactAt: new Date() };

  if (input.pushName && input.pushName !== input.currentPushName) {
    data.pushName = input.pushName;
    // Nome ainda nao personalizado pela equipe: acompanha o pushName.
    if (!input.currentName || input.currentName === input.currentPushName) {
      data.name = input.pushName;
    }
  }

  if (input.phone) data.phone = input.phone;

  await prisma.contact.update({ where: { id: contactId }, data });
}
