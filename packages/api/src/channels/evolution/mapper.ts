import { MessageStatus, MessageType, normalizePhone } from '@crm/shared';
import { logger } from '../../lib/logger.js';
import type { NormalizedEvent, NormalizedInboundMessage } from '../types.js';

/**
 * Traducao do webhook da Evolution API para o formato interno.
 *
 * O formato e o do proprio Baileys, bem mais cru que o da Meta: o tipo da
 * mensagem e descoberto pela CHAVE presente no objeto `message`, e nao por um
 * campo `type`. Por isso a varredura de chaves conhecidas abaixo.
 */

interface EvolutionWebhookBody {
  event?: string;
  instance?: string;
  data?: EvolutionData;
}

interface EvolutionData {
  key?: { remoteJid?: string; fromMe?: boolean; id?: string };
  pushName?: string;
  message?: Record<string, unknown>;
  messageType?: string;
  messageTimestamp?: number | string;
  /** Presente quando a instancia esta configurada para mandar midia em base64. */
  base64?: string;
  status?: string;
  keyId?: string;
  state?: string;
}

const STATUS_MAP: Record<string, MessageStatus> = {
  PENDING: MessageStatus.QUEUED,
  SERVER_ACK: MessageStatus.SENT,
  DELIVERY_ACK: MessageStatus.DELIVERED,
  READ: MessageStatus.READ,
  PLAYED: MessageStatus.READ,
  ERROR: MessageStatus.FAILED,
};

function toDate(timestamp: number | string | undefined): Date {
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || seconds <= 0) return new Date();
  return new Date(seconds * 1_000);
}

/** Extrai o numero do JID ("5531999998888@s.whatsapp.net" -> "5531999998888"). */
function jidToNumber(jid: string | undefined): string | null {
  if (!jid) return null;
  const [user] = jid.split('@');
  if (!user) return null;
  // Grupos ("...@g.us") nao sao atendimento individual: ignorados na origem.
  return /^\d+$/.test(user) ? user : null;
}

export function isGroupMessage(jid: string | undefined): boolean {
  return Boolean(jid?.endsWith('@g.us'));
}

export function parseWebhook(body: unknown): NormalizedEvent[] {
  const payload = body as EvolutionWebhookBody;
  const event = payload?.event ?? '';
  const data = payload?.data;

  if (!data) return [{ kind: 'ignored', reason: 'payload sem data' }];

  switch (event) {
    case 'messages.upsert': {
      // Mensagens que NOS enviamos voltam pelo webhook; ja estao no banco.
      if (data.key?.fromMe) return [{ kind: 'ignored', reason: 'mensagem propria' }];
      if (isGroupMessage(data.key?.remoteJid)) {
        return [{ kind: 'ignored', reason: 'mensagem de grupo' }];
      }

      const message = parseMessage(data);
      return message ? [{ kind: 'message', message }] : [{ kind: 'ignored', reason: 'sem conteudo' }];
    }

    case 'messages.update': {
      const externalId = data.keyId ?? data.key?.id;
      const mapped = data.status ? STATUS_MAP[data.status] : undefined;
      if (!externalId || !mapped) {
        return [{ kind: 'ignored', reason: `status ${data.status ?? 'desconhecido'}` }];
      }

      return [
        {
          kind: 'status',
          status: {
            externalId,
            status: mapped,
            timestamp: toDate(data.messageTimestamp),
            error:
              mapped === MessageStatus.FAILED
                ? { code: 'EVOLUTION_ERROR', title: 'Falha reportada pelo provedor', details: null }
                : null,
          },
        },
      ];
    }

    default:
      return [{ kind: 'ignored', reason: `evento ${event}` }];
  }
}

/** Cada chave conhecida do objeto `message` do Baileys e o tipo interno. */
const MEDIA_KEYS: { key: string; type: MessageType }[] = [
  { key: 'imageMessage', type: MessageType.IMAGE },
  { key: 'videoMessage', type: MessageType.VIDEO },
  { key: 'audioMessage', type: MessageType.AUDIO },
  { key: 'documentMessage', type: MessageType.DOCUMENT },
  { key: 'documentWithCaptionMessage', type: MessageType.DOCUMENT },
  { key: 'stickerMessage', type: MessageType.STICKER },
];

function parseMessage(data: EvolutionData): NormalizedInboundMessage | null {
  const externalId = data.key?.id;
  const from = jidToNumber(data.key?.remoteJid);
  if (!externalId || !from) {
    logger.warn({ key: data.key }, 'Mensagem da Evolution sem id ou remetente: descartada');
    return null;
  }

  const message = data.message ?? {};
  const base = {
    externalId,
    from,
    phone: normalizePhone(from),
    pushName: data.pushName ?? null,
    timestamp: toDate(data.messageTimestamp),
    replyToExternalId: extractQuotedId(message),
  };

  // Texto simples.
  if (typeof message.conversation === 'string') {
    return { ...base, type: MessageType.TEXT, content: message.conversation };
  }

  const extended = message.extendedTextMessage as { text?: string } | undefined;
  if (extended?.text) {
    return { ...base, type: MessageType.TEXT, content: extended.text };
  }

  // Resposta de lista ou de botao (menu enviado pelo canal oficial).
  const listReply = message.listResponseMessage as
    | { title?: string; singleSelectReply?: { selectedRowId?: string } }
    | undefined;
  if (listReply) {
    return {
      ...base,
      type: MessageType.INTERACTIVE,
      content: listReply.title ?? '',
      interactiveReplyId: listReply.singleSelectReply?.selectedRowId ?? null,
      payload: { source: 'list' },
    };
  }

  const buttonReply = message.buttonsResponseMessage as
    | { selectedButtonId?: string; selectedDisplayText?: string }
    | undefined;
  if (buttonReply) {
    return {
      ...base,
      type: MessageType.INTERACTIVE,
      content: buttonReply.selectedDisplayText ?? '',
      interactiveReplyId: buttonReply.selectedButtonId ?? null,
      payload: { source: 'button' },
    };
  }

  // Midia.
  for (const entry of MEDIA_KEYS) {
    const media = message[entry.key] as
      | {
          mimetype?: string;
          caption?: string;
          fileName?: string;
          fileLength?: number | string;
          seconds?: number;
          url?: string;
          fileSha256?: string;
        }
      | undefined;
    if (!media) continue;

    return {
      ...base,
      type: entry.type,
      content: media.caption ?? null,
      media: {
        externalId,
        mimeType: media.mimetype?.split(';')[0] ?? 'application/octet-stream',
        fileName: media.fileName ?? null,
        sha256: media.fileSha256 ?? null,
        caption: media.caption ?? null,
        size: media.fileLength ? Number(media.fileLength) : null,
        durationSeconds: media.seconds ?? null,
        // A instancia pode entregar a URL direto; senao baixamos pelo endpoint.
        directUrl: media.url ?? null,
      },
      payload: data.base64 ? { hasInlineBase64: true } : null,
    };
  }

  const location = message.locationMessage as
    | { degreesLatitude?: number; degreesLongitude?: number; name?: string; address?: string }
    | undefined;
  if (location) {
    return {
      ...base,
      type: MessageType.LOCATION,
      content: location.name ?? location.address ?? 'Localizacao enviada',
      payload: {
        latitude: location.degreesLatitude ?? null,
        longitude: location.degreesLongitude ?? null,
        name: location.name ?? null,
        address: location.address ?? null,
      },
    };
  }

  if (message.contactMessage || message.contactsArrayMessage) {
    return {
      ...base,
      type: MessageType.CONTACTS,
      content: 'Contato compartilhado',
      payload: { raw: message.contactMessage ?? message.contactsArrayMessage },
    };
  }

  const reaction = message.reactionMessage as
    | { text?: string; key?: { id?: string } }
    | undefined;
  if (reaction) {
    return {
      ...base,
      type: MessageType.REACTION,
      content: reaction.text ?? '',
      replyToExternalId: reaction.key?.id ?? null,
      payload: { emoji: reaction.text ?? null },
    };
  }

  logger.info(
    { messageType: data.messageType, keys: Object.keys(message) },
    'Tipo de mensagem desconhecido na Evolution',
  );

  return {
    ...base,
    type: MessageType.UNSUPPORTED,
    content: `[conteudo nao suportado: ${data.messageType ?? 'desconhecido'}]`,
    payload: { rawType: data.messageType ?? null },
  };
}

/** Id da mensagem citada, quando o cliente responde a uma mensagem. */
function extractQuotedId(message: Record<string, unknown>): string | null {
  for (const value of Object.values(message)) {
    if (!value || typeof value !== 'object') continue;
    const contextInfo = (value as { contextInfo?: { stanzaId?: string } }).contextInfo;
    if (contextInfo?.stanzaId) return contextInfo.stanzaId;
  }
  return null;
}

export function eventExternalId(event: NormalizedEvent): string | null {
  if (event.kind === 'message') return `msg:${event.message.externalId}`;
  if (event.kind === 'status') return `status:${event.status.externalId}:${event.status.status}`;
  return null;
}
