import type { ChannelType, MessageStatus, MessageType } from '@crm/shared';

/**
 * Contrato dos canais.
 *
 * Todo provedor (WhatsApp oficial, Evolution, e o que vier depois) e
 * traduzido para ESTAS estruturas. O resto da aplicacao nunca ve o formato
 * cru da Meta - trocar de provedor, ou somar um novo, nao encosta em
 * roteamento, IA nem interface.
 */

export interface NormalizedMedia {
  /** Id da midia no provedor, usado para baixar depois. */
  externalId: string;
  mimeType: string;
  fileName?: string | null;
  sha256?: string | null;
  caption?: string | null;
  size?: number | null;
  durationSeconds?: number | null;
  /** Alguns provedores entregam a URL direto, sem etapa de download. */
  directUrl?: string | null;
}

export interface NormalizedInboundMessage {
  /** Id da mensagem no provedor. Chave de deduplicacao. */
  externalId: string;
  /** Identificador do remetente no canal (wa_id, chat_id...). */
  from: string;
  phone: string | null;
  pushName: string | null;
  timestamp: Date;
  type: MessageType;
  content: string | null;
  payload?: Record<string, unknown> | null;
  media?: NormalizedMedia | null;
  replyToExternalId?: string | null;
  /**
   * Id do botao/linha que o cliente tocou no menu. E assim que sabemos que
   * ele escolheu "Falar com o Financeiro" em vez de digitar.
   */
  interactiveReplyId?: string | null;
}

export interface NormalizedStatusUpdate {
  /** Id da mensagem que mudou de status. */
  externalId: string;
  status: MessageStatus;
  timestamp: Date;
  error?: { code: string; title: string; details?: string | null } | null;
}

export type NormalizedEvent =
  | { kind: 'message'; message: NormalizedInboundMessage }
  | { kind: 'status'; status: NormalizedStatusUpdate }
  | { kind: 'ignored'; reason: string };

// --- Envio -----------------------------------------------------------------

export interface SendTextParams {
  to: string;
  text: string;
  replyToExternalId?: string | null;
}

export interface SendMediaParams {
  to: string;
  /** Conteudo do arquivo. Enviamos os bytes, nunca uma URL nossa. */
  buffer: Buffer;
  mimeType: string;
  fileName?: string | null;
  caption?: string | null;
  replyToExternalId?: string | null;
}

export interface InteractiveButton {
  /** Voltara em `interactiveReplyId` quando o cliente tocar. */
  id: string;
  title: string;
}

export interface InteractiveListSection {
  title: string;
  rows: { id: string; title: string; description?: string }[];
}

export interface SendInteractiveParams {
  to: string;
  body: string;
  header?: string | null;
  footer?: string | null;
  /** Ate 3 botoes; acima disso o WhatsApp exige lista. */
  buttons?: InteractiveButton[];
  list?: { buttonLabel: string; sections: InteractiveListSection[] };
}

export interface SendTemplateParams {
  to: string;
  name: string;
  language: string;
  variables: string[];
}

export interface SendResult {
  /** Id atribuido pelo provedor. Guardamos para casar os callbacks de status. */
  externalId: string;
  raw?: unknown;
}

export interface HealthResult {
  ok: boolean;
  detail?: string | null;
  /** QR Code, quando o canal exige pareamento manual. */
  qrCode?: string | null;
}

export interface DownloadedMedia {
  buffer: Buffer;
  mimeType: string;
  fileName?: string | null;
  size: number;
}

/**
 * Adaptador de canal.
 *
 * Toda implementacao precisa ser IDEMPOTENTE no envio quando possivel e
 * lancar `ProviderError` com `retryable` correto - e esse sinal que diz a
 * fila se vale tentar de novo ou se insistir so vai queimar tentativa.
 */
export interface ChannelAdapter {
  readonly type: ChannelType;
  readonly channelId: string;

  sendText(params: SendTextParams): Promise<SendResult>;
  sendMedia(params: SendMediaParams): Promise<SendResult>;
  sendInteractive(params: SendInteractiveParams): Promise<SendResult>;
  sendTemplate(params: SendTemplateParams): Promise<SendResult>;

  /** Marca como lida no aplicativo do cliente (os dois tiques azuis). */
  markAsRead(externalMessageId: string): Promise<void>;

  downloadMedia(media: NormalizedMedia): Promise<DownloadedMedia>;

  healthCheck(): Promise<HealthResult>;
}

/** Credenciais decifradas, no formato de cada tipo de canal. */
export interface WhatsAppCloudCredentials {
  accessToken: string;
  phoneNumberId: string;
  businessAccountId?: string;
  appSecret: string;
  verifyToken: string;
  graphVersion?: string;
}

export interface EvolutionCredentials {
  baseUrl: string;
  apiKey: string;
  instance: string;
  webhookSecret?: string;
}

export type ChannelCredentials = WhatsAppCloudCredentials | EvolutionCredentials;

export interface AdapterContext {
  channelId: string;
  orgId: string;
  type: ChannelType;
  credentials: Record<string, string>;
}
