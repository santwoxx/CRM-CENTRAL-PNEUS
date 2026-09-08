import { createRemoteJWKSet, jwtVerify } from 'jose';
import { env } from '../../env.js';
import { UnauthorizedError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';

/**
 * Verificacao do token de login do Google (Firebase Authentication).
 *
 * POR QUE NAO USAMOS O firebase-admin
 *
 * O SDK oficial exigiria uma chave de service account (um JSON secreto) no
 * servidor. Um token do Firebase e apenas um JWT RS256 assinado pelo Google,
 * e o Google publica as chaves publicas correspondentes. Entao da para
 * verificar com a biblioteca `jose`, que ja usamos para os nossos proprios
 * tokens - sem dependencia nova e sem mais um segredo para vazar.
 *
 * O QUE PRECISA SER CONFERIDO (e por que cada item importa)
 *
 *  - assinatura : prova que foi o Google que emitiu, e nao qualquer um
 *  - issuer     : prova que veio do NOSSO projeto Firebase
 *  - audience   : idem; sem isso, um token de outro projeto Firebase passaria
 *  - expiracao  : a `jwtVerify` recusa token vencido automaticamente
 *  - auth_time  : quando o usuario realmente se autenticou
 *
 * Pular qualquer um deles transforma "login com Google" em "entrada livre".
 */

const GOOGLE_JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

/**
 * O conjunto de chaves e buscado uma vez e mantido em cache pela propria
 * `jose`, que renova sozinha quando o Google rotaciona as chaves.
 */
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks() {
  jwks ??= createRemoteJWKSet(new URL(GOOGLE_JWKS_URL), {
    cooldownDuration: 30_000,
    timeoutDuration: 10_000,
  });
  return jwks;
}

export interface GoogleIdentity {
  /** UID do usuario no Firebase. Estavel para sempre. */
  uid: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  pictureUrl: string | null;
}

export function isGoogleAuthConfigured(): boolean {
  return Boolean(env.FIREBASE_PROJECT_ID);
}

export async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdentity> {
  if (!env.FIREBASE_PROJECT_ID) {
    throw new UnauthorizedError(
      'Login com Google nao esta configurado no servidor',
      'GOOGLE_AUTH_DISABLED',
    );
  }

  let payload: Record<string, unknown>;

  try {
    const result = await jwtVerify(idToken, getJwks(), {
      issuer: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`,
      audience: env.FIREBASE_PROJECT_ID,
      algorithms: ['RS256'],
    });
    payload = result.payload as Record<string, unknown>;
  } catch (error) {
    logger.warn({ err: error }, 'Token do Google recusado na verificacao');
    throw new UnauthorizedError('Token do Google invalido ou expirado', 'INVALID_GOOGLE_TOKEN');
  }

  // `sub` e o UID. A `jwtVerify` ja garantiu que o token nao expirou.
  const uid = typeof payload.sub === 'string' ? payload.sub : null;
  const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : null;

  if (!uid || !email) {
    throw new UnauthorizedError('Token do Google sem UID ou e-mail', 'INVALID_GOOGLE_TOKEN');
  }

  // E-mail nao verificado nao serve para identificar ninguem: em provedores
  // que permitem cadastrar e-mail alheio, isso viraria sequestro de conta.
  if (payload.email_verified !== true) {
    throw new UnauthorizedError(
      'Sua conta Google esta com o e-mail nao verificado',
      'EMAIL_NOT_VERIFIED',
    );
  }

  return {
    uid,
    email,
    emailVerified: true,
    name: typeof payload.name === 'string' ? payload.name : null,
    pictureUrl: typeof payload.picture === 'string' ? payload.picture : null,
  };
}
