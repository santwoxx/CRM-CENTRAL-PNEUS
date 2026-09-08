import { UserRole, permissionsFor, type AuthenticatedUser } from '@crm/shared';
import { prisma } from '../../db/prisma.js';
import { hashPassword, randomToken, verifyPassword } from '../../lib/crypto.js';
import { ForbiddenError, UnauthorizedError, ValidationError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { recordAudit } from '../audit/service.js';
import { env } from '../../env.js';
import { verifyGoogleIdToken } from './firebase.js';
import {
  REFRESH_TTL_MS,
  createRefreshToken,
  hashRefreshToken,
  signAccessToken,
} from './tokens.js';

/**
 * Regras de autenticacao.
 *
 * Duas preocupacoes guiam este arquivo:
 *  1. Nao revelar quais e-mails existem (mesma resposta e mesmo tempo de
 *     resposta para usuario inexistente e senha errada).
 *  2. Nao deixar forca bruta viavel (bloqueio progressivo por tentativa).
 */

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60_000;

/** Hash descartavel: faz o caminho "usuario nao existe" custar o mesmo tempo. */
const DUMMY_HASH_PROMISE = hashPassword('senha-inexistente-para-igualar-o-tempo');

export interface AuthContext {
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: AuthenticatedUser;
}

export async function login(
  email: string,
  password: string,
  context: AuthContext = {},
): Promise<AuthResult> {
  const user = await prisma.user.findFirst({
    where: { email: email.toLowerCase(), deletedAt: null },
    include: {
      organization: { select: { id: true, name: true } },
      departments: {
        include: { department: { select: { id: true, name: true, color: true } } },
      },
    },
  });

  if (!user) {
    await verifyPassword(password, await DUMMY_HASH_PROMISE);
    throw new UnauthorizedError('E-mail ou senha incorretos', 'INVALID_CREDENTIALS');
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
    throw new ForbiddenError(
      `Conta bloqueada por tentativas incorretas. Tente novamente em ${minutes} min.`,
      'ACCOUNT_LOCKED',
    );
  }

  const passwordMatches = await verifyPassword(password, user.passwordHash);

  if (!passwordMatches) {
    await registerFailedAttempt(user.id, user.failedLoginAttempts);
    throw new UnauthorizedError('E-mail ou senha incorretos', 'INVALID_CREDENTIALS');
  }

  // Verificado DEPOIS da senha: quem erra a senha nao descobre que a conta existe.
  if (!user.isActive) {
    throw new ForbiddenError('Usuario desativado. Fale com o administrador.', 'USER_INACTIVE');
  }

  const session = await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    const { token, hash } = createRefreshToken();
    const created = await tx.session.create({
      data: {
        userId: user.id,
        refreshTokenHash: hash,
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent?.slice(0, 500) ?? null,
      },
    });

    return { id: created.id, token };
  });

  await recordAudit({
    orgId: user.orgId,
    userId: user.id,
    action: 'auth.login',
    entity: 'User',
    entityId: user.id,
    ipAddress: context.ipAddress ?? null,
    userAgent: context.userAgent ?? null,
  });

  const accessToken = await signAccessToken({
    sub: user.id,
    orgId: user.orgId,
    role: user.role as UserRole,
    sid: session.id,
  });

  return {
    accessToken,
    refreshToken: session.token,
    expiresIn: 15 * 60,
    user: toAuthenticatedUser(user),
  };
}

async function registerFailedAttempt(userId: string, currentAttempts: number): Promise<void> {
  const attempts = currentAttempts + 1;
  const shouldLock = attempts >= MAX_FAILED_ATTEMPTS;

  await prisma.user.update({
    where: { id: userId },
    data: {
      failedLoginAttempts: attempts,
      lockedUntil: shouldLock ? new Date(Date.now() + LOCK_DURATION_MS) : null,
    },
  });

  if (shouldLock) {
    logger.warn({ userId, attempts }, 'Conta bloqueada por tentativas de login incorretas');
  }
}

/**
 * Rotaciona o refresh token.
 *
 * O token antigo e revogado no mesmo instante em que o novo nasce. Se um token
 * ja revogado for apresentado, tratamos como roubo de sessao e derrubamos
 * TODAS as sessoes do usuario - e o comportamento correto quando um refresh
 * token vaza.
 */
export async function refresh(rawToken: string, context: AuthContext = {}): Promise<AuthResult> {
  const hash = hashRefreshToken(rawToken);

  const session = await prisma.session.findUnique({
    where: { refreshTokenHash: hash },
    include: {
      user: {
        include: {
          organization: { select: { id: true, name: true } },
          departments: {
            include: { department: { select: { id: true, name: true, color: true } } },
          },
        },
      },
    },
  });

  if (!session) {
    throw new UnauthorizedError('Sessao invalida', 'INVALID_REFRESH_TOKEN');
  }

  if (session.revokedAt) {
    logger.error(
      { userId: session.userId, sessionId: session.id },
      'Refresh token ja revogado foi reapresentado: derrubando todas as sessoes',
    );
    await prisma.session.updateMany({
      where: { userId: session.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw new UnauthorizedError('Sessao invalidada por seguranca', 'REFRESH_TOKEN_REUSED');
  }

  if (session.expiresAt <= new Date()) {
    throw new UnauthorizedError('Sessao expirada', 'REFRESH_TOKEN_EXPIRED');
  }

  if (!session.user.isActive || session.user.deletedAt) {
    throw new ForbiddenError('Usuario desativado', 'USER_INACTIVE');
  }

  const rotated = await prisma.$transaction(async (tx) => {
    await tx.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });

    const { token, hash: nextHash } = createRefreshToken();
    const created = await tx.session.create({
      data: {
        userId: session.userId,
        refreshTokenHash: nextHash,
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
        ipAddress: context.ipAddress ?? session.ipAddress,
        userAgent: context.userAgent?.slice(0, 500) ?? session.userAgent,
      },
    });

    return { id: created.id, token };
  });

  const accessToken = await signAccessToken({
    sub: session.user.id,
    orgId: session.user.orgId,
    role: session.user.role as UserRole,
    sid: rotated.id,
  });

  return {
    accessToken,
    refreshToken: rotated.token,
    expiresIn: 15 * 60,
    user: toAuthenticatedUser(session.user),
  };
}

export async function logout(rawToken: string): Promise<void> {
  const hash = hashRefreshToken(rawToken);
  await prisma.session.updateMany({
    where: { refreshTokenHash: hash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Derruba todas as sessoes. Usado ao trocar senha e ao desativar usuario. */
export async function revokeAllSessions(userId: string): Promise<number> {
  const result = await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  context: AuthContext = {},
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new UnauthorizedError();

  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new ValidationError('Senha atual incorreta', [
      { path: 'currentPassword', message: 'Senha atual incorreta' },
    ]);
  }

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(newPassword) },
  });

  // Trocar a senha derruba as outras sessoes: e o que o usuario espera quando
  // troca a senha por suspeitar de acesso indevido.
  await revokeAllSessions(userId);

  await recordAudit({
    orgId: user.orgId,
    userId,
    action: 'auth.password_changed',
    entity: 'User',
    entityId: userId,
    ipAddress: context.ipAddress ?? null,
    userAgent: context.userAgent ?? null,
  });
}

/** Confere se a sessao do access token continua valida (usado no WebSocket). */
export async function isSessionActive(sessionId: string): Promise<boolean> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { revokedAt: true, expiresAt: true },
  });
  return Boolean(session && !session.revokedAt && session.expiresAt > new Date());
}

type UserWithRelations = {
  id: string;
  orgId: string;
  name: string;
  email: string;
  role: string;
  avatarUrl: string | null;
  presence: string;
  isActive: boolean;
  maxConcurrentChats: number;
  presenceChangedAt: Date | null;
  lastSeenAt: Date | null;
  createdAt: Date;
  organization: { id: string; name: string };
  departments: {
    isSupervisor: boolean;
    department: { id: string; name: string; color: string };
  }[];
};

export function toAuthenticatedUser(user: UserWithRelations): AuthenticatedUser {
  const role = user.role as UserRole;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role,
    avatarUrl: user.avatarUrl,
    presence: user.presence as AuthenticatedUser['presence'],
    isActive: user.isActive,
    maxConcurrentChats: user.maxConcurrentChats,
    departments: user.departments.map((membership) => ({
      id: membership.department.id,
      name: membership.department.name,
      color: membership.department.color,
      isSupervisor: membership.isSupervisor,
    })),
    presenceChangedAt: user.presenceChangedAt?.toISOString() ?? null,
    lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    orgId: user.orgId,
    orgName: user.organization.name,
    permissions: permissionsFor(role),
  };
}

/**
 * Login com a conta Google.
 *
 * A decisao de seguranca central esta aqui: um token do Google valido prova
 * QUEM a pessoa e, mas nao diz que ela pode entrar neste CRM. Por padrao,
 * so entra quem o administrador ja cadastrou - o Google apenas substitui a
 * senha. Sem essa regra, qualquer pessoa do planeta com uma conta Google
 * teria acesso ao painel de atendimento.
 *
 * `GOOGLE_AUTO_PROVISION=true` afrouxa isso e cria o usuario como atendente
 * no primeiro acesso. Serve para testes internos; em producao deve ficar
 * desligado.
 */
export async function loginWithGoogle(
  idToken: string,
  context: AuthContext = {},
): Promise<AuthResult> {
  const identity = await verifyGoogleIdToken(idToken);

  const userInclude = {
    organization: { select: { id: true, name: true } },
    departments: {
      include: { department: { select: { id: true, name: true, color: true } } },
    },
  } as const;

  // Procura primeiro pelo UID (imutavel) e so depois pelo e-mail, que e o
  // caso de quem foi cadastrado pelo admin e esta entrando pela primeira vez.
  let user = await prisma.user.findFirst({
    where: { firebaseUid: identity.uid, deletedAt: null },
    include: userInclude,
  });

  if (!user) {
    user = await prisma.user.findFirst({
      where: { email: identity.email, deletedAt: null },
      include: userInclude,
    });

    if (user) {
      // Primeiro login social de um usuario ja cadastrado: amarramos o UID.
      await prisma.user.update({
        where: { id: user.id },
        data: {
          firebaseUid: identity.uid,
          ...(user.avatarUrl ? {} : { avatarUrl: identity.pictureUrl }),
        },
      });
    }
  }

  if (!user) {
    if (!env.GOOGLE_AUTO_PROVISION) {
      throw new ForbiddenError(
        `O e-mail ${identity.email} nao esta cadastrado. Peca ao administrador para criar seu acesso.`,
        'USER_NOT_PROVISIONED',
      );
    }

    const organization = await prisma.organization.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!organization) {
      throw new ForbiddenError('Nenhuma organizacao configurada', 'NO_ORGANIZATION');
    }

    const created = await prisma.user.create({
      data: {
        orgId: organization.id,
        name: identity.name ?? identity.email.split('@')[0] ?? 'Usuario',
        email: identity.email,
        // Senha impossivel de adivinhar: quem entra pelo Google nao usa senha,
        // mas o campo e obrigatorio e nao pode ficar previsivel.
        passwordHash: await hashPassword(randomToken(32)),
        role: UserRole.AGENT,
        firebaseUid: identity.uid,
        avatarUrl: identity.pictureUrl,
      },
      select: { id: true },
    });

    user = await prisma.user.findUniqueOrThrow({
      where: { id: created.id },
      include: userInclude,
    });

    logger.info({ userId: user.id, email: identity.email }, 'Usuario criado via login Google');
  }

  if (!user.isActive) {
    throw new ForbiddenError('Usuario desativado. Fale com o administrador.', 'USER_INACTIVE');
  }

  const session = await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user!.id },
      data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    const { token, hash } = createRefreshToken();
    const created = await tx.session.create({
      data: {
        userId: user!.id,
        refreshTokenHash: hash,
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent?.slice(0, 500) ?? null,
      },
    });

    return { id: created.id, token };
  });

  await recordAudit({
    orgId: user.orgId,
    userId: user.id,
    action: 'auth.login.google',
    entity: 'User',
    entityId: user.id,
    ipAddress: context.ipAddress ?? null,
    userAgent: context.userAgent ?? null,
  });

  const accessToken = await signAccessToken({
    sub: user.id,
    orgId: user.orgId,
    role: user.role as UserRole,
    sid: session.id,
  });

  return {
    accessToken,
    refreshToken: session.token,
    expiresIn: 15 * 60,
    user: toAuthenticatedUser(user),
  };
}
