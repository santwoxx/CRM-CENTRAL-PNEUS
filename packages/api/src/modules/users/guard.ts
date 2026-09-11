import { Permission, ROLE_RANK, UserRole, can, outranks } from '@crm/shared';
import { prisma } from '../../db/prisma.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors.js';

/**
 * Barreiras de escalonamento de privilegio.
 *
 * A permissao USER_MANAGE responde "esta pessoa administra usuarios?". Ela
 * NAO responde "ate que nivel?". Sem esta segunda pergunta, quem administra
 * usuarios administra TODOS - inclusive se promovendo.
 *
 * As regras:
 *   1. Ninguem cria nem promove alguem a um cargo igual ou acima do seu.
 *   2. Ninguem altera quem esta no mesmo nivel ou acima.
 *   3. Mexer em ADMIN ou OWNER exige USER_MANAGE_ADMINS, que so o dono tem.
 *   4. Ninguem muda o proprio cargo, nem se desativa.
 *   5. A organizacao nunca fica sem nenhum OWNER ativo.
 */

export interface Ator {
  id: string;
  orgId: string;
  role: UserRole;
}

/** Cargos cuja manipulacao exige ser dono. */
function ehCargoAdministrativo(role: UserRole): boolean {
  return role === UserRole.ADMIN || role === UserRole.OWNER;
}

/** Valida a atribuicao de um cargo a alguem. */
export function assertPodeAtribuirCargo(ator: Ator, cargoAlvo: UserRole): void {
  if (ehCargoAdministrativo(cargoAlvo) && !can(ator.role, Permission.USER_MANAGE_ADMINS)) {
    throw new ForbiddenError(
      'Apenas o dono da conta pode conceder cargo de administrador',
      'ROLE_ESCALATION_DENIED',
    );
  }

  // Igual ou acima do proprio cargo e escalonamento, mesmo sem ser admin.
  if (ROLE_RANK[cargoAlvo] >= ROLE_RANK[ator.role] && !outranks(ator.role, cargoAlvo)) {
    throw new ForbiddenError(
      'Voce nao pode conceder um cargo igual ou superior ao seu',
      'ROLE_ESCALATION_DENIED',
    );
  }
}

/** Valida a alteracao de um usuario existente. */
export async function assertPodeAlterarUsuario(
  ator: Ator,
  alvoId: string,
  mudancas: { role?: UserRole; isActive?: boolean } = {},
): Promise<void> {
  const alvo = await prisma.user.findFirst({
    where: { id: alvoId, orgId: ator.orgId },
    select: { id: true, role: true, isActive: true },
  });

  if (!alvo) throw new NotFoundError('Usuario');

  const cargoAlvo = alvo.role as UserRole;

  if (alvo.id === ator.id) {
    // Mudar o proprio cargo e a forma mais direta de escalonar.
    if (mudancas.role && mudancas.role !== cargoAlvo) {
      throw new ForbiddenError('Voce nao pode alterar o proprio cargo', 'SELF_ROLE_CHANGE_DENIED');
    }
    if (mudancas.isActive === false) {
      throw new ValidationError('Voce nao pode desativar a propria conta');
    }
  } else {
    if (ehCargoAdministrativo(cargoAlvo) && !can(ator.role, Permission.USER_MANAGE_ADMINS)) {
      throw new ForbiddenError(
        'Apenas o dono da conta pode alterar um administrador',
        'ROLE_ESCALATION_DENIED',
      );
    }

    if (!outranks(ator.role, cargoAlvo)) {
      throw new ForbiddenError(
        'Voce nao pode alterar alguem de cargo igual ou superior ao seu',
        'ROLE_ESCALATION_DENIED',
      );
    }
  }

  if (mudancas.role) assertPodeAtribuirCargo(ator, mudancas.role);

  // Deixar a organizacao sem dono trava a administracao para sempre.
  const perdeuODono =
    cargoAlvo === UserRole.OWNER &&
    ((mudancas.role && mudancas.role !== UserRole.OWNER) || mudancas.isActive === false);

  if (perdeuODono) {
    const donosAtivos = await prisma.user.count({
      where: { orgId: ator.orgId, role: UserRole.OWNER, isActive: true, deletedAt: null },
    });

    if (donosAtivos <= 1) {
      throw new ValidationError(
        'A organizacao precisa de pelo menos um dono ativo. Promova outra pessoa antes.',
      );
    }
  }
}
