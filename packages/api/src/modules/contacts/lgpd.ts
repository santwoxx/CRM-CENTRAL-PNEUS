import { prisma } from '../../db/prisma.js';
import { logger } from '../../lib/logger.js';
import { NotFoundError } from '../../lib/errors.js';
import { storage } from '../media/storage.js';
import { recordAudit } from '../audit/service.js';

/**
 * Direito de eliminacao (LGPD, art. 18, VI).
 *
 * Quando o cliente pede para apagar os dados dele, a loja tem obrigacao legal
 * de apagar - e nao existia nenhum caminho para isso no sistema.
 *
 * O banco ja apaga em cascata: removendo o contato vao junto as conversas,
 * as mensagens e os eventos. O que a cascata NAO alcanca sao os arquivos no
 * disco (a foto do pneu, o audio que o cliente mandou). Eles ficariam la
 * depois do "apagado", que e exatamente o que a lei nao admite.
 *
 * A trilha de auditoria registra que a exclusao aconteceu, com quem pediu e
 * quantos registros sairam - mas NUNCA o nome ou o telefone. Guardar o dado
 * pessoal no registro da exclusao anularia a propria exclusao.
 */

export interface ResultadoExclusao {
  conversas: number;
  mensagens: number;
  arquivos: number;
}

export async function apagarDadosDoContato(
  orgId: string,
  contactId: string,
  ator: { userId: string; ipAddress?: string | null },
): Promise<ResultadoExclusao> {
  const contato = await prisma.contact.findFirst({
    where: { id: contactId, orgId },
    select: { id: true },
  });
  if (!contato) throw new NotFoundError('Contato');

  const conversas = await prisma.conversation.findMany({
    where: { contactId, orgId },
    select: { id: true },
  });
  const idsConversas = conversas.map((c) => c.id);

  // As midias sao buscadas ANTES da exclusao: depois da cascata nao ha mais
  // como saber quais arquivos pertenciam a este cliente.
  const midias =
    idsConversas.length > 0
      ? await prisma.message.findMany({
          where: { conversationId: { in: idsConversas }, mediaId: { not: null } },
          select: { media: { select: { id: true, storageKey: true } } },
        })
      : [];

  const chaves = new Map<string, string>();
  for (const linha of midias) {
    if (linha.media) chaves.set(linha.media.id, linha.media.storageKey);
  }

  const mensagens =
    idsConversas.length > 0
      ? await prisma.message.count({ where: { conversationId: { in: idsConversas } } })
      : 0;

  // Cascata: contato -> conversas -> mensagens e eventos.
  await prisma.contact.delete({ where: { id: contactId } });

  if (chaves.size > 0) {
    await prisma.mediaAsset.deleteMany({ where: { id: { in: [...chaves.keys()] } } });
  }

  let arquivos = 0;
  for (const chave of chaves.values()) {
    try {
      await storage.delete(chave);
      arquivos += 1;
    } catch (erro) {
      // Um arquivo que ja nao existe nao pode impedir o resto da exclusao,
      // mas precisa ficar registrado: e dado pessoal que pode ter sobrado.
      logger.error({ err: erro, chave }, 'Falha ao apagar arquivo de midia do cliente');
    }
  }

  await recordAudit({
    orgId,
    userId: ator.userId,
    action: 'contact.erased',
    entity: 'contact',
    entityId: contactId,
    after: { conversas: idsConversas.length, mensagens, arquivos },
    ipAddress: ator.ipAddress ?? null,
  });

  logger.info(
    { contactId, conversas: idsConversas.length, mensagens, arquivos },
    'Dados do cliente apagados a pedido',
  );

  return { conversas: idsConversas.length, mensagens, arquivos };
}
