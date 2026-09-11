import { ChannelType, MessageType } from '@crm/shared';
import { ProviderError } from '../../lib/errors.js';
import { assertUrlExterna, requestBuffer, requestJson } from '../../lib/http.js';
import { logger } from '../../lib/logger.js';
import type {
  ChannelAdapter,
  DownloadedMedia,
  HealthResult,
  NormalizedMedia,
  SendInteractiveParams,
  SendMediaParams,
  SendResult,
  SendTemplateParams,
  SendTextParams,
  WhatsAppCloudCredentials,
} from '../types.js';

/**
 * WhatsApp Cloud API (oficial, da Meta).
 *
 * Este e o canal principal. Vale registrar por que ele resolve o problema do
 * "limite de 4 atendentes": esse limite e do APLICATIVO WhatsApp Business,
 * que conta dispositivos pareados. A Cloud API nao pareia dispositivo - o CRM
 * e o unico cliente do numero, e quantos atendentes trabalham dentro dele e
 * problema nosso, nao da Meta. Por isso nao ha teto de atendentes aqui.
 */

const GRAPH_HOST = 'https://graph.facebook.com';

/** Limites da Meta que precisamos respeitar ao montar o payload. */
const LIMITS = {
  bodyText: 4096,
  buttonTitle: 20,
  buttons: 3,
  listRowTitle: 24,
  listRowDescription: 72,
  listRows: 10,
  listButtonLabel: 20,
  header: 60,
  footer: 60,
} as const;

function truncate(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}\u2026`;
}

export class WhatsAppCloudAdapter implements ChannelAdapter {
  readonly type = ChannelType.WHATSAPP_CLOUD;

  constructor(
    readonly channelId: string,
    private readonly credentials: WhatsAppCloudCredentials,
  ) {
    if (!credentials.accessToken || !credentials.phoneNumberId) {
      throw new ProviderError('whatsapp-cloud', 'Canal sem accessToken ou phoneNumberId', {
        retryable: false,
        statusCode: 500,
      });
    }
  }

  private get version(): string {
    return this.credentials.graphVersion ?? 'v21.0';
  }

  private get messagesUrl(): string {
    return `${GRAPH_HOST}/${this.version}/${this.credentials.phoneNumberId}/messages`;
  }

  private get authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.credentials.accessToken}` };
  }

  private async post(body: Record<string, unknown>): Promise<SendResult> {
    const response = await requestJson<{
      messages?: { id: string }[];
      contacts?: { wa_id: string }[];
    }>(this.messagesUrl, {
      method: 'POST',
      provider: 'whatsapp-cloud',
      headers: this.authHeaders,
      body: { messaging_product: 'whatsapp', recipient_type: 'individual', ...body },
    });

    const externalId = response.messages?.[0]?.id;
    if (!externalId) {
      // Sem id nao ha como casar o callback de status: tratamos como falha.
      throw new ProviderError('whatsapp-cloud', 'Provedor nao devolveu o id da mensagem', {
        retryable: true,
      });
    }

    return { externalId, raw: response };
  }

  async sendText(params: SendTextParams): Promise<SendResult> {
    return this.post({
      to: params.to,
      type: 'text',
      ...(params.replyToExternalId ? { context: { message_id: params.replyToExternalId } } : {}),
      text: { preview_url: true, body: truncate(params.text, LIMITS.bodyText) },
    });
  }

  async sendMedia(params: SendMediaParams): Promise<SendResult> {
    // A Meta exige upload previo: primeiro sobem os bytes, depois manda o id.
    const mediaId = await this.uploadMedia(params.buffer, params.mimeType, params.fileName);
    const kind = mediaKind(params.mimeType);

    const payload: Record<string, unknown> = { id: mediaId };
    // Documento e imagem/video aceitam legenda; audio nao.
    if (params.caption && kind !== 'audio') {
      payload.caption = truncate(params.caption, 1024);
    }
    if (kind === 'document' && params.fileName) {
      payload.filename = params.fileName;
    }

    return this.post({
      to: params.to,
      type: kind,
      ...(params.replyToExternalId ? { context: { message_id: params.replyToExternalId } } : {}),
      [kind]: payload,
    });
  }

  async sendInteractive(params: SendInteractiveParams): Promise<SendResult> {
    const base: Record<string, unknown> = {
      body: { text: truncate(params.body, 1024) },
      ...(params.header ? { header: { type: 'text', text: truncate(params.header, LIMITS.header) } } : {}),
      ...(params.footer ? { footer: { text: truncate(params.footer, LIMITS.footer) } } : {}),
    };

    let interactive: Record<string, unknown>;

    if (params.list) {
      interactive = {
        ...base,
        type: 'list',
        action: {
          button: truncate(params.list.buttonLabel, LIMITS.listButtonLabel),
          sections: params.list.sections.map((section) => ({
            title: truncate(section.title, 24),
            rows: section.rows.slice(0, LIMITS.listRows).map((row) => ({
              id: row.id,
              title: truncate(row.title, LIMITS.listRowTitle),
              ...(row.description
                ? { description: truncate(row.description, LIMITS.listRowDescription) }
                : {}),
            })),
          })),
        },
      };
    } else {
      const buttons = (params.buttons ?? []).slice(0, LIMITS.buttons);
      if (buttons.length === 0) {
        throw new ProviderError('whatsapp-cloud', 'Mensagem interativa sem botoes', {
          retryable: false,
        });
      }
      interactive = {
        ...base,
        type: 'button',
        action: {
          buttons: buttons.map((button) => ({
            type: 'reply',
            reply: { id: button.id, title: truncate(button.title, LIMITS.buttonTitle) },
          })),
        },
      };
    }

    return this.post({ to: params.to, type: 'interactive', interactive });
  }

  async sendTemplate(params: SendTemplateParams): Promise<SendResult> {
    return this.post({
      to: params.to,
      type: 'template',
      template: {
        name: params.name,
        language: { code: params.language },
        ...(params.variables.length > 0
          ? {
              components: [
                {
                  type: 'body',
                  parameters: params.variables.map((value) => ({ type: 'text', text: value })),
                },
              ],
            }
          : {}),
      },
    });
  }

  async markAsRead(externalMessageId: string): Promise<void> {
    try {
      await requestJson(this.messagesUrl, {
        method: 'POST',
        provider: 'whatsapp-cloud',
        headers: this.authHeaders,
        body: {
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: externalMessageId,
        },
      });
    } catch (error) {
      // Os tiques azuis sao cortesia: falhar aqui nao pode quebrar nada.
      logger.debug({ err: error, externalMessageId }, 'Falha ao marcar mensagem como lida');
    }
  }

  /** Sobe os bytes para a Meta e devolve o id da midia. */
  private async uploadMedia(
    buffer: Buffer,
    mimeType: string,
    fileName?: string | null,
  ): Promise<string> {
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', mimeType);
    form.append(
      'file',
      new Blob([new Uint8Array(buffer)], { type: mimeType }),
      fileName ?? 'arquivo',
    );

    let response: Response;
    try {
      response = await fetch(`${GRAPH_HOST}/${this.version}/${this.credentials.phoneNumberId}/media`, {
        method: 'POST',
        headers: this.authHeaders,
        body: form,
        signal: AbortSignal.timeout(120_000),
      });
    } catch (error) {
      throw new ProviderError('whatsapp-cloud', 'Falha de rede ao subir a midia', {
        retryable: true,
        cause: error,
      });
    }

    const payload = (await response.json().catch(() => null)) as { id?: string; error?: unknown } | null;

    if (!response.ok || !payload?.id) {
      throw new ProviderError('whatsapp-cloud', 'A Meta recusou o upload da midia', {
        statusCode: response.status,
        retryable: response.status >= 500 || response.status === 429,
      });
    }

    return payload.id;
  }

  /**
   * Baixa uma midia recebida. Sao duas etapas: primeiro pedimos a URL
   * temporaria, depois buscamos os bytes - e a URL exige o mesmo Bearer token.
   */
  async downloadMedia(media: NormalizedMedia): Promise<DownloadedMedia> {
    const metadata = await requestJson<{
      url?: string;
      mime_type?: string;
      file_size?: number;
    }>(`${GRAPH_HOST}/${this.version}/${media.externalId}`, {
      provider: 'whatsapp-cloud',
      headers: this.authHeaders,
    });

    if (!metadata.url) {
      throw new ProviderError('whatsapp-cloud', 'Midia sem URL de download', { retryable: false });
    }

    // A URL vem da resposta da Meta e nao do cliente, mas conferir custa nada
    // e impede que uma resposta adulterada nos redirecione para a rede interna.
    assertUrlExterna(metadata.url);

    const file = await requestBuffer(metadata.url, {
      provider: 'whatsapp-cloud',
      headers: this.authHeaders,
    });

    return {
      buffer: file.buffer,
      mimeType: metadata.mime_type ?? media.mimeType ?? file.mimeType,
      fileName: media.fileName ?? null,
      size: metadata.file_size ?? file.size,
    };
  }

  async healthCheck(): Promise<HealthResult> {
    try {
      const info = await requestJson<{
        display_phone_number?: string;
        verified_name?: string;
        quality_rating?: string;
        throughput?: { level?: string };
      }>(
        `${GRAPH_HOST}/${this.version}/${this.credentials.phoneNumberId}` +
          '?fields=display_phone_number,verified_name,quality_rating,throughput',
        { provider: 'whatsapp-cloud', headers: this.authHeaders, timeoutMs: 10_000 },
      );

      const quality = info.quality_rating ?? 'UNKNOWN';
      // Qualidade em queda antecede restricao de envio pela Meta: avisamos.
      const degraded = quality === 'RED' || quality === 'YELLOW';

      return {
        ok: !degraded,
        detail: `${info.verified_name ?? 'numero'} (${info.display_phone_number ?? '-'}) - qualidade ${quality}`,
      };
    } catch (error) {
      return {
        ok: false,
        detail: error instanceof Error ? error.message : 'Falha na verificacao',
      };
    }
  }
}

/** Mapeia o mime type para o tipo que a Meta espera no payload. */
function mediaKind(mimeType: string): 'image' | 'audio' | 'video' | 'document' {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  return 'document';
}

/** Converte o tipo interno de mensagem para o do provedor. */
export function toWhatsAppType(type: MessageType): string {
  switch (type) {
    case MessageType.IMAGE:
      return 'image';
    case MessageType.AUDIO:
      return 'audio';
    case MessageType.VIDEO:
      return 'video';
    case MessageType.DOCUMENT:
      return 'document';
    case MessageType.TEMPLATE:
      return 'template';
    case MessageType.INTERACTIVE:
      return 'interactive';
    default:
      return 'text';
  }
}
