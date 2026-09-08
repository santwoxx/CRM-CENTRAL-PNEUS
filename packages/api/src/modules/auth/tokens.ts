import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import type { UserRole } from '@crm/shared';
import { env } from '../../env.js';
import { UnauthorizedError } from '../../lib/errors.js';
import { randomToken, sha256 } from '../../lib/crypto.js';

/**
 * Tokens.
 *
 * Duas naturezas diferentes de proposito:
 *  - ACCESS: JWT curto (15 min), sem consulta ao banco. Rapido.
 *  - REFRESH: token opaco e aleatorio, guardado como hash na tabela `sessions`.
 *    Como nao carrega informacao, pode ser revogado de verdade - demitir
 *    alguem tira o acesso na hora, o que um JWT longo nao permitiria.
 */

const ISSUER = 'crm-central-pneus';
const AUDIENCE = 'crm-web';

const accessSecret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);

export interface AccessTokenClaims {
  sub: string;
  orgId: string;
  role: UserRole;
  /** Id da sessao: permite invalidar o access token junto com o refresh. */
  sid: string;
}

export async function signAccessToken(claims: AccessTokenClaims): Promise<string> {
  return new SignJWT({ orgId: claims.orgId, role: claims.role, sid: claims.sid })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(env.JWT_ACCESS_TTL)
    .sign(accessSecret);
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  try {
    const { payload } = await jwtVerify(token, accessSecret, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
    });

    if (
      typeof payload.sub !== 'string' ||
      typeof payload.orgId !== 'string' ||
      typeof payload.role !== 'string' ||
      typeof payload.sid !== 'string'
    ) {
      throw new UnauthorizedError('Token malformado', 'INVALID_TOKEN');
    }

    return {
      sub: payload.sub,
      orgId: payload.orgId,
      role: payload.role as UserRole,
      sid: payload.sid,
    };
  } catch (error) {
    if (error instanceof joseErrors.JWTExpired) {
      // Codigo proprio: e o sinal para o frontend usar o refresh token.
      throw new UnauthorizedError('Sessao expirada', 'TOKEN_EXPIRED');
    }
    if (error instanceof UnauthorizedError) throw error;
    throw new UnauthorizedError('Token invalido', 'INVALID_TOKEN');
  }
}

/** Gera o refresh token: o valor cru vai para o cliente, o hash para o banco. */
export function createRefreshToken(): { token: string; hash: string } {
  const token = randomToken(48);
  return { token, hash: sha256(token) };
}

export function hashRefreshToken(token: string): string {
  return sha256(token);
}

/** Converte "30d", "15m", "1h" em milissegundos. */
export function parseDuration(value: string): number {
  const match = /^(\d+)\s*([smhd])$/.exec(value.trim());
  if (!match) throw new Error(`Duracao invalida: ${value}`);

  const amount = Number(match[1]);
  const multipliers: Record<string, number> = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };

  return amount * (multipliers[match[2] as string] ?? 0);
}

export const REFRESH_TTL_MS = parseDuration(env.JWT_REFRESH_TTL);
