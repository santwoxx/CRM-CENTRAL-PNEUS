import { ChannelType } from '@crm/shared';
import { ProviderError } from '../../lib/errors.js';
import { requestBuffer, requestJson } from '../../lib/http.js';
import { logger } from '../../lib/logger.js';
import type {
  ChannelAdapter,
  DownloadedMedia,
  EvolutionCredentials,
  HealthResult,
  NormalizedMedia,
  SendInteractiveParams,
  SendMediaParams,
  SendResult,
  SendTemplateParams,
  SendTextParams,
} from '../types.js';

/**
 * WhatsApp nao-oficial via Evolution API (Baileys).
 *
 * Canal de CONTINGENCIA. Existe para o caso de o numero oficial ficar
 * indisponivel, e nao para substitui-lo. Duas coisas precisam estar claras
 * para quem for operar isto:
 *
 *  - Este metodo nao e homologado pela Meta e o numero pode ser banido.
 *  - Nao existe template aprovado nem janela de 24h aqui; em compensacao,
 *    tambem nao existe garantia de entrega nem suporte.
 *
 * Botoes e listas foram removidos pelo WhatsApp para clientes nao-oficiais,
 * entao `sendInteractive` cai para um menu numerado em texto - que funciona
 * em qualquer versao e mantem o mesmo fluxo do canal oficial.
 */
export class EvolutionAdapter implements ChannelAdapter {
  readonly type = ChannelType.WHATSAPP_EVOLUTION;

  constructor(
    readonly channelId: string,
    private readonly credentials: EvolutionCredentials,
  ) {
    if (!credentials.baseUrl || !credentials.apiKey || !credentials.instance) {
      throw new ProviderError('evolution', 'Canal sem baseUrl, apiKey ou instance', {
        retryable: false,
        statusCode: 500,
      });
    }
  }

  private url(path: string): string {
    const base = this.credentials.baseUrl.replace(/\/+$/, '');
    return `${base}${path}/${encodeURIComponent(this.credentials.instance)}`;
  }

  private get headers(): Record<string, string> {
    return { apikey: this.credentials.apiKey };
  }

  private async send(path: string, body: Record<string, unknown>): Promise<SendResult> {
    const response = await requestJson<{ key?: { id?: string } }>(this.url(path), {
      method: 'POST',
      provider: 'evolution',
      headers: this.headers,
      body,
    });

    const externalId = response.key?.id;
    if (!externalId) {
      throw new ProviderError('evolution', 'Provedor nao devolveu o id da mensagem', {
        retryable: true,
      });
    }

    return { externalId, raw: response };
  }

  /** A Evolution aceita o numero puro; o sufixo @s.whatsapp.net e opcional. */
  private recipient(to: string): string {
    return to.replace(/\D/g, '');
  }

  async sendText(params: SendTextParams): Promise<SendResult> {
    return this.send('/message/sendText', {
      number: this.recipient(params.to),
      text: params.text,
      ...(params.replyToExternalId ? { quoted: { key: { id: params.replyToExternalId } } } : {}),
    });
  }

  async sendMedia(params: SendMediaParams): Promise<SendResult> {
    const base64 = params.buffer.toString('base64');

    // Audio de voz tem endpoint proprio: pelo /sendMedia ele chega como
    // arquivo anexado em vez de mensagem de voz.
    if (params.mimeType.startsWith('audio/')) {
      return this.send('/message/sendWhatsAppAudio', {
        number: this.recipient(params.to),
        audio: base64,
      });
    }

    const mediatype = params.mimeType.startsWith('image/')
      ? 'image'
      : params.mimeType.startsWith('video/')
        ? 'video'
        : 'document';

    return this.send('/message/sendMedia', {
      number: this.recipient(params.to),
      mediatype,
      mimetype: params.mimeType,
      media: base64,
      ...(params.fileName ? { fileName: params.fileName } : {}),
      ...(params.caption ? { caption: params.caption } : {}),
    });
  }

  /**
   * Menu em texto numerado.
   *
   * O cliente responde "1", "2"... e o mapeamento numero -> id volta no
   * payload da mensagem, para o roteamento saber o que a escolha significa.
   */
  async sendInteractive(params: SendInteractiveParams): Promise<SendResult> {
    const options = params.list
      ? params.list.sections.flatMap((section) => section.rows)
      : (params.buttons ?? []).map((button) => ({ id: button.id, title: button.title }));

    const lines = [
      params.header ? `*${params.header}*` : null,
      params.body,
      '',
      ...options.map((option, index) => `*${index + 1}* - ${option.title}`),
      '',
      'Responda com o numero da opcao desejada.',
      params.footer ? `_${params.footer}_` : null,
    ].filter((line): line is string => line !== null);

    return this.sendText({ to: params.to, text: lines.join('\n') });
  }

  async sendTemplate(params: SendTemplateParams): Promise<SendResult> {
    // Nao existe template aprovado fora da API oficial. Falhamos de forma
    // explicita em vez de mandar um texto qualquer no lugar do modelo.
    throw new ProviderError(
      'evolution',
      `O canal de contingencia nao envia modelos aprovados (${params.name}). Use o canal oficial.`,
      { retryable: false, statusCode: 400 },
    );
  }

  async markAsRead(externalMessageId: string): Promise<void> {
    try {
      await requestJson(this.url('/chat/markMessageAsRead'), {
        method: 'POST',
        provider: 'evolution',
        headers: this.headers,
        body: { readMessages: [{ id: externalMessageId }] },
      });
    } catch (error) {
      logger.debug({ err: error, externalMessageId }, 'Falha ao marcar como lida (Evolution)');
    }
  }

  async downloadMedia(media: NormalizedMedia): Promise<DownloadedMedia> {
    if (media.directUrl) {
      const file = await requestBuffer(media.directUrl, {
        provider: 'evolution',
        headers: this.headers,
      });
      return {
        buffer: file.buffer,
        mimeType: media.mimeType || file.mimeType,
        fileName: media.fileName ?? null,
        size: file.size,
      };
    }

    const response = await requestJson<{ base64?: string; mimetype?: string }>(
      this.url('/chat/getBase64FromMediaMessage'),
      {
        method: 'POST',
        provider: 'evolution',
        headers: this.headers,
        body: { message: { key: { id: media.externalId } }, convertToMp4: false },
      },
    );

    if (!response.base64) {
      throw new ProviderError('evolution', 'Midia sem conteudo retornado', { retryable: false });
    }

    const buffer = Buffer.from(response.base64, 'base64');
    return {
      buffer,
      mimeType: response.mimetype ?? media.mimeType ?? 'application/octet-stream',
      fileName: media.fileName ?? null,
      size: buffer.byteLength,
    };
  }

  async healthCheck(): Promise<HealthResult> {
    try {
      const state = await requestJson<{ instance?: { state?: string } }>(
        this.url('/instance/connectionState'),
        { provider: 'evolution', headers: this.headers, timeoutMs: 8_000 },
      );

      const connectionState = state.instance?.state ?? 'unknown';
      if (connectionState === 'open') {
        return { ok: true, detail: 'Instancia conectada' };
      }

      // Desconectada: buscamos o QR Code para o admin reparear pela tela.
      const pairing = await requestJson<{ base64?: string; code?: string }>(
        this.url('/instance/connect'),
        { provider: 'evolution', headers: this.headers, timeoutMs: 8_000 },
      ).catch(() => null);

      return {
        ok: false,
        detail: `Instancia ${connectionState}. Leia o QR Code para reconectar.`,
        qrCode: pairing?.base64 ?? pairing?.code ?? null,
      };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : 'Falha na verificacao' };
    }
  }
}
