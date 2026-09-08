import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { prisma } from '../../db/prisma.js';
import { NotFoundError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { storage } from './storage.js';
import { getAdapter } from '../../channels/registry.js';

export interface SaveMediaInput {
  orgId: string;
  stream: Readable;
  mimeType: string;
  fileName?: string;
  externalId?: string;
}

export async function saveMediaAsset(input: SaveMediaInput) {
  // Coleta stream em buffer para calcular SHA256 e salvar
  const chunks: Buffer[] = [];
  for await (const chunk of input.stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const buffer = Buffer.concat(chunks);
  const hash = createHash('sha256').update(buffer).digest('hex');

  // Deduplicação: se já existe esse arquivo exatamente igual na organização
  const existing = await prisma.mediaAsset.findFirst({
    where: { orgId: input.orgId, sha256: hash },
  });

  if (existing) {
    return existing;
  }

  const storageKey = `${input.orgId}/${Date.now()}-${hash.slice(0, 12)}_${input.fileName || 'file'}`;
  await storage.write(storageKey, Readable.from(buffer));

  const asset = await prisma.mediaAsset.create({
    data: {
      orgId: input.orgId,
      storageKey,
      mimeType: input.mimeType,
      fileName: input.fileName ?? null,
      size: buffer.length,
      sha256: hash,
      externalId: input.externalId ?? null,
    },
  });

  return asset;
}

export async function getMediaAsset(id: string) {
  const asset = await prisma.mediaAsset.findUnique({ where: { id } });
  if (!asset) throw new NotFoundError('Arquivo de mídia');
  return asset;
}

/**
 * Baixa uma mídia recebida do WhatsApp/Evolution e salva como MediaAsset.
 */
export async function downloadAndSaveMedia(params: {
  messageId: string;
  channelId: string;
  externalMediaId: string;
  mimeType?: string;
  fileName?: string;
}) {
  const message = await prisma.message.findUnique({
    where: { id: params.messageId },
    select: { id: true, orgId: true, mediaId: true },
  });

  if (!message || message.mediaId) return;

  try {
    const adapter = await getAdapter(params.channelId);
    if (!adapter.downloadMedia) {
      logger.warn({ channelId: params.channelId }, 'Adaptador nao implementa downloadMedia');
      return;
    }

    const downloaded = await adapter.downloadMedia({
      externalId: params.externalMediaId,
      mimeType: params.mimeType || 'application/octet-stream',
      fileName: params.fileName,
    });

    const asset = await saveMediaAsset({
      orgId: message.orgId,
      stream: Readable.from(downloaded.buffer),
      mimeType: downloaded.mimeType,
      fileName: downloaded.fileName || params.fileName,
      externalId: params.externalMediaId,
    });

    await prisma.message.update({
      where: { id: message.id },
      data: { mediaId: asset.id },
    });

    logger.info({ messageId: message.id, assetId: asset.id }, 'Midia baixada e vinculada com sucesso');
  } catch (error) {
    logger.error({ err: error, messageId: message.id }, 'Falha ao baixar midia do canal');
  }
}
