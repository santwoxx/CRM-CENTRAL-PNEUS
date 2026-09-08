import { ChannelType } from '@crm/shared';
import { createId } from '@paralleldrive/cuid2';
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
} from '../types.js';

/**
 * Canal interno de webchat / simulacao.
 *
 * PARA QUE SERVE
 *
 * Permite exercitar o CRM inteiro - IA, skills de pneu, consulta ao catalogo,
 * fila, roteamento e tempo real - sem depender de nenhum provedor externo.
 * E o jeito de alguem avaliar o sistema sem numero de WhatsApp, sem token da
 * Meta e sem Docker.
 *
 * Tambem e a base do widget de chat no site, que usa exatamente este canal.
 *
 * O "envio" aqui nao chama ninguem de fora: a mensagem ja nasce entregue e o
 * cliente ve pelo WebSocket. Isso e correto e nao e atalho - num webchat, a
 * entrega E a exibicao na tela.
 */
export class WebchatAdapter implements ChannelAdapter {
  readonly type = ChannelType.WEBCHAT;

  constructor(readonly channelId: string) {}

  /** Id no mesmo formato dos provedores reais, para o resto do codigo nao notar diferenca. */
  private newId(): SendResult {
    return { externalId: `webchat_${createId()}` };
  }

  async sendText(_params: SendTextParams): Promise<SendResult> {
    return this.newId();
  }

  async sendMedia(_params: SendMediaParams): Promise<SendResult> {
    return this.newId();
  }

  async sendInteractive(_params: SendInteractiveParams): Promise<SendResult> {
    return this.newId();
  }

  async sendTemplate(_params: SendTemplateParams): Promise<SendResult> {
    // Nao existe janela de 24h no webchat, entao template nao faz sentido -
    // mas aceitamos para nao quebrar um fluxo que caia aqui por engano.
    return this.newId();
  }

  async markAsRead(_externalMessageId: string): Promise<void> {
    // Sem efeito: quem le e a propria tela.
  }

  async downloadMedia(_media: NormalizedMedia): Promise<DownloadedMedia> {
    throw new Error('O canal de webchat recebe a midia direto no upload, sem download.');
  }

  async healthCheck(): Promise<HealthResult> {
    // Nao depende de nada externo: se o processo esta de pe, o canal esta.
    return { ok: true, detail: 'Canal interno (webchat/simulacao)' };
  }
}
