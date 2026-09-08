import { ChannelStatus, ChannelType } from '@crm/shared';
import { prisma } from '../db/prisma.js';
import { decryptJson } from '../lib/crypto.js';
import { AppError, NotFoundError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { emitChannelStatus } from '../realtime/emitter.js';
import { EvolutionAdapter } from './evolution/adapter.js';
import { parseWebhook as parseEvolutionWebhook } from './evolution/mapper.js';
import { WhatsAppCloudAdapter } from './whatsapp-cloud/adapter.js';
import { WebchatAdapter } from './webchat/adapter.js';
import { parseWebhook as parseCloudWebhook } from './whatsapp-cloud/mapper.js';
import type {
  ChannelAdapter,
  EvolutionCredentials,
  NormalizedEvent,
  WhatsAppCloudCredentials,
} from './types.js';

/**
 * Registro de canais.
 *
 * Traduz uma linha da tabela `channels` num adaptador pronto para uso,
 * decifrando as credenciais no caminho. Os adaptadores ficam em cache porque
 * construi-los a cada mensagem significaria decifrar as credenciais a cada
 * mensagem - custo desnecessario num caminho quente.
 *
 * O cache expira sozinho e e invalidado explicitamente quando o admin edita
 * o canal, para uma credencial trocada valer na hora.
 */

interface CacheEntry {
  adapter: ChannelAdapter;
  expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60_000;
const cache = new Map<string, CacheEntry>();

export async function getAdapter(channelId: string): Promise<ChannelAdapter> {
  const cached = cache.get(channelId);
  if (cached && cached.expiresAt > Date.now()) return cached.adapter;

  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: {
      id: true,
      type: true,
      isActive: true,
      credentialsEncrypted: true,
    },
  });

  if (!channel) throw new NotFoundError('Canal');
  if (!channel.isActive) {
    throw new AppError('Canal desativado', { statusCode: 409, code: 'CHANNEL_INACTIVE' });
  }

  const credentials = decryptJson<Record<string, string>>(channel.credentialsEncrypted);

  // O canal interno nao tem credencial nenhuma para decifrar.
  if (channel.type === ChannelType.WEBCHAT) {
    const adapter = new WebchatAdapter(channel.id);
    cache.set(channelId, { adapter, expiresAt: Date.now() + CACHE_TTL_MS });
    return adapter;
  }

  if (!credentials) {
    throw new AppError(
      'Credenciais do canal ausentes ou ilegiveis. Reconfigure o canal.',
      { statusCode: 500, code: 'CHANNEL_CREDENTIALS_INVALID' },
    );
  }

  const adapter = buildAdapter(channel.id, channel.type as ChannelType, credentials);
  cache.set(channelId, { adapter, expiresAt: Date.now() + CACHE_TTL_MS });

  return adapter;
}

function buildAdapter(
  channelId: string,
  type: ChannelType,
  credentials: Record<string, string>,
): ChannelAdapter {
  switch (type) {
    case ChannelType.WHATSAPP_CLOUD:
      return new WhatsAppCloudAdapter(channelId, credentials as unknown as WhatsAppCloudCredentials);

    case ChannelType.WHATSAPP_EVOLUTION:
      return new EvolutionAdapter(channelId, credentials as unknown as EvolutionCredentials);

    // Canal interno: nao tem credencial nem provedor externo.
    case ChannelType.WEBCHAT:
      return new WebchatAdapter(channelId);

    default:
      throw new AppError(`Canal do tipo ${type} ainda nao tem adaptador`, {
        statusCode: 501,
        code: 'CHANNEL_NOT_IMPLEMENTED',
      });
  }
}

export function invalidateAdapter(channelId: string): void {
  cache.delete(channelId);
}

export function invalidateAllAdapters(): void {
  cache.clear();
}

/** Credenciais decifradas. Usado pelo webhook para conferir a assinatura. */
export async function getChannelCredentials<T = Record<string, string>>(
  channelId: string,
): Promise<T | null> {
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { credentialsEncrypted: true },
  });
  return channel ? decryptJson<T>(channel.credentialsEncrypted) : null;
}

/** Despacha o corpo do webhook para o tradutor do provedor certo. */
export function parseWebhookPayload(type: ChannelType, body: unknown): NormalizedEvent[] {
  switch (type) {
    case ChannelType.WHATSAPP_CLOUD:
      return parseCloudWebhook(body);
    case ChannelType.WHATSAPP_EVOLUTION:
      return parseEvolutionWebhook(body);
    default:
      return [{ kind: 'ignored', reason: `canal ${type} sem tradutor` }];
  }
}

/** Id do evento para deduplicacao. Igual para os dois provedores. */
export function eventExternalId(event: NormalizedEvent): string | null {
  if (event.kind === 'message') return `msg:${event.message.externalId}`;
  if (event.kind === 'status') return `status:${event.status.externalId}:${event.status.status}`;
  return null;
}

export async function updateChannelStatus(
  channelId: string,
  status: ChannelStatus,
  detail: string | null,
  qrCode?: string | null,
): Promise<void> {
  const channel = await prisma.channel.update({
    where: { id: channelId },
    data: {
      status,
      statusDetail: detail,
      lastHealthCheckAt: new Date(),
      ...(qrCode !== undefined ? { pairingCode: qrCode } : {}),
    },
    select: { orgId: true },
  });

  await emitChannelStatus(channel.orgId, { channelId, status, detail, qrCode: qrCode ?? null });
}

/**
 * Verifica todos os canais ativos.
 *
 * Roda periodicamente. E o que faz o admin descobrir que o token expirou pelo
 * painel, e nao pela reclamacao de um cliente sem resposta.
 */
export async function runHealthChecks(): Promise<void> {
  const channels = await prisma.channel.findMany({
    where: { isActive: true },
    select: { id: true, name: true, type: true, status: true },
  });

  for (const channel of channels) {
    try {
      const adapter = await getAdapter(channel.id);
      const health = await adapter.healthCheck();

      const nextStatus = health.ok ? ChannelStatus.CONNECTED : ChannelStatus.DISCONNECTED;

      // So grava quando muda: evita um UPDATE a cada dois minutos por canal.
      if (nextStatus !== channel.status || health.qrCode) {
        await updateChannelStatus(channel.id, nextStatus, health.detail ?? null, health.qrCode ?? null);
        logger.info(
          { channelId: channel.id, name: channel.name, status: nextStatus, detail: health.detail },
          'Status do canal atualizado',
        );
      }
    } catch (error) {
      logger.error({ err: error, channelId: channel.id }, 'Falha ao verificar canal');
      if (channel.status !== ChannelStatus.ERROR) {
        await updateChannelStatus(
          channel.id,
          ChannelStatus.ERROR,
          error instanceof Error ? error.message : 'Falha desconhecida',
        ).catch(() => undefined);
      }
    }
  }
}

/** Canal padrao da organizacao, usado quando nada especifica outro. */
export async function getDefaultChannel(orgId: string) {
  return prisma.channel.findFirst({
    where: { orgId, isActive: true },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
  });
}
