import { MessageStatus, MessageType, normalizePhone } from '@crm/shared';
import { logger } from '../../lib/logger.js';
import type { NormalizedEvent, NormalizedInboundMessage } from '../types.js';

/**
 * Traducao do webhook da Meta para o formato interno.
 *
 * Duas posturas defensivas guiam este arquivo:
 *  1. O payload da Meta muda com o tempo. Nada aqui assume que um campo
 *     existe - tudo e checado antes de ser lido.
 *  2. Um tipo de mensagem desconhecido NUNCA derruba o processamento. Ele
 *     vira UNSUPPORTED e chega ao atendente com um aviso, porque perder a
 *     mensagem de um cliente e pior do que exibi-la de forma imperfeita.
 */

interface MetaWebhookBody {
  object?: string;
  entry?: {
    id?: string;
    changes?: {
      field?: string;
      value?: MetaChangeValue;
    }[];
  }[];
}

interface MetaChangeValue {
  metadata?: { phone_number_id?: string; display_phone_number?: string };
  contacts?: { wa_id?: string; profile?: { name?: string } }[];
  messages?: MetaMessage[];
  statuses?: MetaStatus[];
}

interface MetaMessage {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  image?: MetaMedia;
  audio?: MetaMedia;
  video?: MetaMedia;
  document?: MetaMedia & { filename?: string };
  sticker?: MetaMedia;
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
  contacts?: unknown[];
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string; description?: string };
  };
  button?: { payload?: string; text?: string };
  reaction?: { message_id?: string; emoji?: string };
  context?: { id?: string; forwarded?: boolean };
  errors?: { code?: number; title?: string; message?: string }[];
}

interface MetaMedia {
  id?: string;
  mime_type?: string;
  sha256?: string;
  caption?: string;
  voice?: boolean;
}

interface MetaStatus {
  id?: string;
  status?: string;
  timestamp?: string;
  recipient_id?: string;
  errors?: { code?: number; title?: string; message?: string; error_data?: { details?: string } }[];
}

/** Converte o timestamp em segundos da Meta para Date. */
function toDate(timestamp: string | undefined): Date {
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || seconds <= 0) return new Date();
  return new Date(seconds * 1_000);
}

const STATUS_MAP: Record<string, MessageStatus> = {
  sent: MessageStatus.SENT,
  delivered: MessageStatus.DELIVERED,
  read: MessageStatus.READ,
  failed: MessageStatus.FAILED,
  // "deleted" chega quando o cliente apaga; nao mexemos no status de envio.
};

/** Extrai todos os eventos de um corpo de webhook (pode vir em lote). */
export function parseWebhook(body: unknown): NormalizedEvent[] {
  const payload = body as MetaWebhookBody;
  const events: NormalizedEvent[] = [];

  if (payload?.object !== 'whatsapp_business_account') {
    return [{ kind: 'ignored', reason: `objeto inesperado: ${payload?.object ?? 'ausente'}` }];
  }

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') {
        events.push({ kind: 'ignored', reason: `campo ${change.field ?? 'desconhecido'}` });
        continue;
      }

      const value = change.value ?? {};
      const profileName = value.contacts?.[0]?.profile?.name ?? null;

      for (const message of value.messages ?? []) {
        const parsed = parseMessage(message, profileName);
        if (parsed) events.push({ kind: 'message', message: parsed });
      }

      for (const status of value.statuses ?? []) {
        const parsed = parseStatus(status);
        if (parsed) events.push(parsed);
      }
    }
  }

  return events.length > 0 ? events : [{ kind: 'ignored', reason: 'sem eventos no payload' }];
}

function parseStatus(status: MetaStatus): NormalizedEvent | null {
  if (!status.id || !status.status) return null;

  const mapped = STATUS_MAP[status.status];
  if (!mapped) return { kind: 'ignored', reason: `status ${status.status}` };

  const failure = status.errors?.[0];

  return {
    kind: 'status',
    status: {
      externalId: status.id,
      status: mapped,
      timestamp: toDate(status.timestamp),
      error: failure
        ? {
            code: String(failure.code ?? ''),
            title: failure.title ?? 'Falha no envio',
            details: failure.error_data?.details ?? failure.message ?? null,
          }
        : null,
    },
  };
}

function parseMessage(
  message: MetaMessage,
  profileName: string | null,
): NormalizedInboundMessage | null {
  if (!message.id || !message.from) {
    logger.warn({ message }, 'Mensagem do webhook sem id ou remetente: descartada');
    return null;
  }

  const base = {
    externalId: message.id,
    from: message.from,
    phone: normalizePhone(message.from),
    pushName: profileName,
    timestamp: toDate(message.timestamp),
    replyToExternalId: message.context?.id ?? null,
  };

  switch (message.type) {
    case 'text':
      return {
        ...base,
        type: MessageType.TEXT,
        content: message.text?.body ?? '',
      };

    case 'image':
    case 'audio':
    case 'video':
    case 'document':
    case 'sticker': {
      const media = (message as Record<string, MetaMedia | undefined>)[message.type];
      if (!media?.id) {
        return { ...base, type: MessageType.UNSUPPORTED, content: '[midia sem identificador]' };
      }

      const typeMap: Record<string, MessageType> = {
        image: MessageType.IMAGE,
        audio: MessageType.AUDIO,
        video: MessageType.VIDEO,
        document: MessageType.DOCUMENT,
        sticker: MessageType.STICKER,
      };

      return {
        ...base,
        type: typeMap[message.type] ?? MessageType.UNSUPPORTED,
        content: media.caption ?? null,
        media: {
          externalId: media.id,
          mimeType: media.mime_type ?? 'application/octet-stream',
          fileName: message.document?.filename ?? null,
          sha256: media.sha256 ?? null,
          caption: media.caption ?? null,
        },
        payload: media.voice ? { voice: true } : null,
      };
    }

    case 'location':
      return {
        ...base,
        type: MessageType.LOCATION,
        content: message.location?.name ?? message.location?.address ?? 'Localizacao enviada',
        payload: {
          latitude: message.location?.latitude ?? null,
          longitude: message.location?.longitude ?? null,
          name: message.location?.name ?? null,
          address: message.location?.address ?? null,
        },
      };

    case 'contacts':
      return {
        ...base,
        type: MessageType.CONTACTS,
        content: 'Contato compartilhado',
        payload: { contacts: message.contacts ?? [] },
      };

    /**
     * Resposta a um menu. `interactiveReplyId` e o que o roteamento le para
     * saber que o cliente escolheu "Falar com o Financeiro" - sem depender de
     * interpretar texto livre.
     */
    case 'interactive': {
      const reply = message.interactive?.button_reply ?? message.interactive?.list_reply;
      return {
        ...base,
        type: MessageType.INTERACTIVE,
        content: reply?.title ?? '',
        interactiveReplyId: reply?.id ?? null,
        payload: {
          interactiveType: message.interactive?.type ?? null,
          replyId: reply?.id ?? null,
          replyTitle: reply?.title ?? null,
        },
      };
    }

    // Botao de resposta rapida de um template aprovado.
    case 'button':
      return {
        ...base,
        type: MessageType.INTERACTIVE,
        content: message.button?.text ?? '',
        interactiveReplyId: message.button?.payload ?? null,
        payload: { source: 'template_button', payload: message.button?.payload ?? null },
      };

    case 'reaction':
      return {
        ...base,
        type: MessageType.REACTION,
        content: message.reaction?.emoji ?? '',
        replyToExternalId: message.reaction?.message_id ?? null,
        payload: { emoji: message.reaction?.emoji ?? null },
      };

    // A Meta avisa que nao conseguiu entregar o conteudo (ex.: tipo novo).
    case 'unsupported':
      return {
        ...base,
        type: MessageType.UNSUPPORTED,
        content: '[O cliente enviou um conteudo que o WhatsApp nao repassou]',
        payload: { errors: message.errors ?? [] },
      };

    default:
      logger.info({ type: message.type }, 'Tipo de mensagem desconhecido recebido');
      return {
        ...base,
        type: MessageType.UNSUPPORTED,
        content: `[conteudo nao suportado: ${message.type ?? 'desconhecido'}]`,
        payload: { rawType: message.type ?? null },
      };
  }
}

/**
 * Id estavel do evento, usado para deduplicar.
 *
 * Uma mensagem e um status compartilham o mesmo id no WhatsApp, por isso o
 * prefixo: sem ele, o status "entregue" seria confundido com a mensagem e
 * descartado como duplicata.
 */
export function eventExternalId(event: NormalizedEvent): string | null {
  if (event.kind === 'message') return `msg:${event.message.externalId}`;
  if (event.kind === 'status') return `status:${event.status.externalId}:${event.status.status}`;
  return null;
}
