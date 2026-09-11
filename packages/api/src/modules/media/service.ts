import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { prisma } from '../../db/prisma.js';
import { AppError, NotFoundError } from '../../lib/errors.js';
import { TAMANHO_MAXIMO_BYTES, sanitizarNomeArquivo, validarMimeType } from './seguranca.js';
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
  // Tipo declarado pelo remetente: conferido contra a lista de permitidos
  // ANTES de qualquer byte ir para o disco.
  const mimeType = validarMimeType(input.mimeType);
  const fileName = sanitizarNomeArquivo(input.fileName);

  // O arquivo e lido em memoria para calcular o SHA-256. Por isso o teto e
  // aplicado DURANTE a leitura: sem ele, alguns uploads grandes simultaneos
  // derrubam o processo por falta de memoria - negacao de servico barata.
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of input.stream) {
    const parte = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += parte.length;

    if (total > TAMANHO_MAXIMO_BYTES) {
      throw new AppError(
        `Arquivo maior que o limite de ${Math.round(TAMANHO_MAXIMO_BYTES / 1024 / 1024)} MB`,
        { statusCode: 413, code: 'FILE_TOO_LARGE' },
      );
    }

    chunks.push(parte);
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

  // O nome sanitizado entra so como sufixo legivel; o caminho e definido
  // por orgId e hash, que o remetente nao controla.
  const storageKey = `${input.orgId}/${Date.now()}-${hash.slice(0, 12)}_${fileName ?? 'arquivo'}`;
  await storage.write(storageKey, Readable.from(buffer));

  const asset = await prisma.mediaAsset.create({
    data: {
      orgId: input.orgId,
      storageKey,
      mimeType,
      fileName,
      size: buffer.length,
      sha256: hash,
      externalId: input.externalId ?? null,
    },
  });

  return asset;
}

/**
 * Busca um arquivo SEMPRE dentro da organizacao de quem pede.
 *
 * Sem o `orgId` no filtro, um id vazado permitiria ler o arquivo de outra
 * empresa. Id nao e credencial.
 */
export async function getMediaAsset(id: string, orgId: string) {
  const asset = await prisma.mediaAsset.findFirst({ where: { id, orgId } });
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
