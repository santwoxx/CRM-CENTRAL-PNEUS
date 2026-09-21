import { prisma } from '../../db/prisma.js';
import { ValidationError } from '../../lib/errors.js';

function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}

/** Impede criar relacoes entre registros de empresas diferentes. */
export async function assertUsersBelongToOrg(userIds: string[], orgId: string): Promise<void> {
  const ids = unique(userIds);
  if (ids.length === 0) return;

  const count = await prisma.user.count({
    where: { id: { in: ids }, orgId, deletedAt: null },
  });
  if (count !== ids.length) {
    throw new ValidationError('Um ou mais usuarios nao pertencem a esta organizacao', [
      { path: 'memberIds', message: 'Usuario inexistente ou de outra organizacao' },
    ]);
  }
}

/** Impede vincular um usuario a setores de outra empresa. */
export async function assertDepartmentsBelongToOrg(
  departmentIds: string[],
  orgId: string,
): Promise<void> {
  const ids = unique(departmentIds);
  if (ids.length === 0) return;

  const count = await prisma.department.count({ where: { id: { in: ids }, orgId } });
  if (count !== ids.length) {
    throw new ValidationError('Um ou mais setores nao pertencem a esta organizacao', [
      { path: 'departmentIds', message: 'Setor inexistente ou de outra organizacao' },
    ]);
  }
}
