import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  session: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
  $transaction: vi.fn(),
}));

const tokenMocks = vi.hoisted(() => ({
  createRefreshToken: vi.fn(() => ({ token: 'next-raw-token', hash: 'next-hash' })),
  hashRefreshToken: vi.fn(() => 'old-hash'),
  signAccessToken: vi.fn(async ({ sid }: { sid: string }) => `access-for-${sid}`),
}));

vi.mock('../db/prisma.js', () => ({ prisma: db }));
vi.mock('../modules/auth/tokens.js', () => ({
  ...tokenMocks,
  REFRESH_TTL_MS: 30 * 24 * 60 * 60 * 1_000,
}));
vi.mock('../lib/crypto.js', () => ({
  hashPassword: vi.fn(async () => 'hash'),
  randomToken: vi.fn(() => 'random'),
  verifyPassword: vi.fn(),
}));
vi.mock('../modules/audit/service.js', () => ({ recordAudit: vi.fn() }));
vi.mock('../modules/auth/firebase.js', () => ({ verifyGoogleIdToken: vi.fn() }));

import { refresh } from '../modules/auth/service.js';

const context = { ipAddress: '203.0.113.8', userAgent: 'Browser CRM' };
const user = {
  id: 'user-1',
  orgId: 'org-1',
  name: 'Ana',
  email: 'ana@example.com',
  role: 'ADMIN',
  avatarUrl: null,
  presence: 'ONLINE',
  isActive: true,
  maxConcurrentChats: 5,
  presenceChangedAt: null,
  lastSeenAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  deletedAt: null,
  organization: { id: 'org-1', name: 'Central' },
  departments: [],
};

const baseSession = {
  id: 'old-session',
  userId: user.id,
  refreshTokenHash: 'old-hash',
  ipAddress: context.ipAddress,
  userAgent: context.userAgent,
  expiresAt: new Date(Date.now() + 60_000),
  createdAt: new Date(),
  lastUsedAt: new Date(),
  user,
};

beforeEach(() => {
  vi.clearAllMocks();
  db.session.updateMany.mockResolvedValue({ count: 1 });
});

describe('rotacao atomica do refresh token', () => {
  it('liga o novo token ao anterior depois de conquistar a rotacao', async () => {
    db.session.findUnique.mockResolvedValue({ ...baseSession, revokedAt: null });
    const txSession = {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn().mockResolvedValue({ id: 'next-session' }),
    };
    db.$transaction.mockImplementation(async (operation: (tx: unknown) => unknown) =>
      operation({ session: txSession }),
    );

    const result = await refresh('old-raw-token', context);

    expect(txSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        refreshTokenHash: 'next-hash',
        rotatedFromId: 'old-session',
      }),
    });
    expect(result.refreshToken).toBe('next-raw-token');
    expect(result.accessToken).toBe('access-for-next-session');
  });

  it('reaproveita o sucessor para uma segunda aba dentro da janela', async () => {
    db.session.findUnique
      .mockResolvedValueOnce({
        ...baseSession,
        revokedAt: new Date(Date.now() - 1_000),
      })
      .mockResolvedValueOnce({
        id: 'next-session',
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: null,
      });

    const result = await refresh('old-raw-token', context);

    expect(result.accessToken).toBe('access-for-next-session');
    expect(result.refreshToken).toBeUndefined();
    expect(db.session.updateMany).not.toHaveBeenCalled();
  });

  it('mantem a deteccao de replay fora da janela de concorrencia', async () => {
    db.session.findUnique.mockResolvedValue({
      ...baseSession,
      revokedAt: new Date(Date.now() - 11_000),
    });

    await expect(refresh('old-raw-token', context)).rejects.toMatchObject({
      code: 'REFRESH_TOKEN_REUSED',
    });
    expect(db.session.updateMany).toHaveBeenCalledWith({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
