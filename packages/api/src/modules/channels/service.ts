import { ChannelStatus, ChannelType } from '@crm/shared';
import { prisma } from '../../db/prisma.js';
import { encryptJson, decryptJson } from '../../lib/crypto.js';
import { NotFoundError } from '../../lib/errors.js';
import { getAdapter, invalidateAdapter } from '../../channels/registry.js';
import { emitChannelStatus } from '../../realtime/emitter.js';

export interface CreateChannelInput {
  orgId: string;
  type: ChannelType;
  name: string;
  isDefault?: boolean;
  credentials: Record<string, string>;
}

export async function listChannels(orgId: string) {
  const channels = await prisma.channel.findMany({
    where: { orgId },
    orderBy: { createdAt: 'asc' },
  });

  return channels.map((c) => {
    const creds = decryptJson<Record<string, string>>(c.credentialsEncrypted);
    return {
      id: c.id,
      type: c.type as ChannelType,
      name: c.name,
      identifier: c.identifier,
      isActive: c.isActive,
      isDefault: c.isDefault,
      status: c.status as ChannelStatus,
      statusDetail: c.statusDetail,
      lastHealthCheckAt: c.lastHealthCheckAt?.toISOString() ?? null,
      configuredFields: creds ? Object.keys(creds) : [],
    };
  });
}

export async function createChannel(input: CreateChannelInput) {
  const credentialsEncrypted = encryptJson(input.credentials);
  const identifier = input.credentials.phoneNumberId || input.credentials.instance || null;

  const channel = await prisma.channel.create({
    data: {
      orgId: input.orgId,
      type: input.type,
      name: input.name,
      identifier,
      isDefault: input.isDefault ?? false,
      credentialsEncrypted,
      status: ChannelStatus.PENDING,
    },
  });

  return channel;
}

export async function updateChannel(
  id: string,
  orgId: string,
  input: {
    name?: string;
    isActive?: boolean;
    isDefault?: boolean;
    credentials?: Record<string, string>;
  },
) {
  const channel = await prisma.channel.findFirst({ where: { id, orgId } });
  if (!channel) throw new NotFoundError('Canal');

  let credentialsEncrypted: string | undefined = undefined;
  let identifier: string | undefined = undefined;

  if (input.credentials) {
    credentialsEncrypted = encryptJson(input.credentials);
    identifier = input.credentials.phoneNumberId || input.credentials.instance || undefined;
  }

  const updated = await prisma.channel.update({
    where: { id },
    data: {
      name: input.name,
      isActive: input.isActive,
      isDefault: input.isDefault,
      credentialsEncrypted,
      identifier,
    },
  });

  invalidateAdapter(id);
  return updated;
}

export async function checkChannelHealth(id: string, orgId: string) {
  const channel = await prisma.channel.findFirst({ where: { id, orgId } });
  if (!channel) throw new NotFoundError('Canal');

  try {
    const adapter = await getAdapter(id);
    const health = await adapter.healthCheck();

    const newStatus = health.ok ? ChannelStatus.CONNECTED : ChannelStatus.ERROR;
    await prisma.channel.update({
      where: { id },
      data: {
        status: newStatus,
        statusDetail: health.detail ?? null,
        pairingCode: health.qrCode ?? null,
        lastHealthCheckAt: new Date(),
      },
    });

    await emitChannelStatus(orgId, {
      channelId: id,
      status: newStatus,
      detail: health.detail ?? null,
      qrCode: health.qrCode ?? null,
    });

    return { ok: health.ok, status: newStatus, detail: health.detail, qrCode: health.qrCode };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await prisma.channel.update({
      where: { id },
      data: {
        status: ChannelStatus.ERROR,
        statusDetail: reason,
        lastHealthCheckAt: new Date(),
      },
    });

    await emitChannelStatus(orgId, {
      channelId: id,
      status: ChannelStatus.ERROR,
      detail: reason,
    });

    return { ok: false, status: ChannelStatus.ERROR, detail: reason };
  }
}
