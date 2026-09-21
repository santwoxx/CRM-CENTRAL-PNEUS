import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  userCount: vi.fn(),
  departmentCount: vi.fn(),
}));

vi.mock('../db/prisma.js', () => ({
  prisma: {
    user: { count: mocks.userCount },
    department: { count: mocks.departmentCount },
  },
}));

const { assertDepartmentsBelongToOrg, assertUsersBelongToOrg } = await import(
  '../modules/tenancy/guards.js'
);

beforeEach(() => vi.clearAllMocks());

describe('isolamento entre organizacoes', () => {
  it('aceita somente usuarios encontrados dentro da organizacao', async () => {
    mocks.userCount.mockResolvedValueOnce(2);
    await expect(assertUsersBelongToOrg(['u1', 'u1', 'u2'], 'org-1')).resolves.toBeUndefined();

    expect(mocks.userCount).toHaveBeenCalledWith({
      where: { id: { in: ['u1', 'u2'] }, orgId: 'org-1', deletedAt: null },
    });
  });

  it('recusa usuario de outra organizacao', async () => {
    mocks.userCount.mockResolvedValueOnce(0);
    await expect(assertUsersBelongToOrg(['usuario-externo'], 'org-1')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('recusa setor de outra organizacao', async () => {
    mocks.departmentCount.mockResolvedValueOnce(0);
    await expect(
      assertDepartmentsBelongToOrg(['setor-externo'], 'org-1'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
