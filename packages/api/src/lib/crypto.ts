import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import { env, isProduction } from '../env.js';
import { logger } from './logger.js';

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

// Parametros do scrypt. N=2^16 leva ~100ms num servidor comum: caro o bastante
// para forca bruta, barato o bastante para o login nao travar.
const SCRYPT_PARAMS = { N: 65536, r: 8, p: 1, maxmem: 128 * 65536 * 8 * 2 };
const SCRYPT_KEYLEN = 64;
const SALT_BYTES = 16;

/**
 * Gera o hash de uma senha. Formato: `scrypt$N$r$p$salt$hash` (base64url).
 * Guardamos os parametros junto para poder endurece-los no futuro sem
 * invalidar as senhas ja existentes.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scrypt(password.normalize('NFKC'), salt, SCRYPT_KEYLEN, SCRYPT_PARAMS);
  const { N, r, p } = SCRYPT_PARAMS;
  return ['scrypt', N, r, p, salt.toString('base64url'), derived.toString('base64url')].join('$');
}

/**
 * Confere a senha. Sempre em tempo constante e sempre pagando o custo do
 * scrypt, mesmo com hash malformado - senao o tempo de resposta entrega
 * quais e-mails existem.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    // Hash corrompido: gasta o mesmo tempo e nega.
    await scrypt(password, randomBytes(SALT_BYTES), SCRYPT_KEYLEN, SCRYPT_PARAMS);
    return false;
  }

  const [, rawN, rawR, rawP, rawSalt, rawHash] = parts as [
    string, string, string, string, string, string,
  ];
  const params = {
    N: Number(rawN),
    r: Number(rawR),
    p: Number(rawP),
    maxmem: 128 * Number(rawN) * Number(rawR) * 2,
  };

  const expected = Buffer.from(rawHash, 'base64url');
  const derived = await scrypt(
    password.normalize('NFKC'),
    Buffer.from(rawSalt, 'base64url'),
    expected.length,
    params,
  );

  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

// --- Cifra de credenciais --------------------------------------------------

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

let cachedKey: Buffer | null = null;

function encryptionKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = env.CREDENTIALS_ENCRYPTION_KEY.trim();
  if (!raw) {
    if (isProduction) {
      throw new Error('CREDENTIALS_ENCRYPTION_KEY ausente em producao');
    }
    // Em desenvolvimento derivamos do segredo do JWT para nao travar o setup.
    logger.warn(
      'CREDENTIALS_ENCRYPTION_KEY vazia: usando chave derivada (aceitavel apenas em desenvolvimento)',
    );
    cachedKey = createHash('sha256').update(env.JWT_ACCESS_SECRET).digest();
    return cachedKey;
  }

  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('CREDENTIALS_ENCRYPTION_KEY precisa ter 32 bytes em base64');
  }
  cachedKey = key;
  return cachedKey;
}

/** Cifra um objeto de credenciais. Saida: base64 de `iv | authTag | payload`. */
export function encryptJson(value: unknown): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, encryptionKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}

/**
 * Decifra. Retorna `null` se o dado foi adulterado ou a chave mudou - nunca
 * lanca, para que um canal com credencial corrompida nao derrube o boot.
 */
export function decryptJson<T = Record<string, string>>(payload: string | null): T | null {
  if (!payload) return null;

  try {
    const buffer = Buffer.from(payload, 'base64');
    if (buffer.length <= IV_BYTES + AUTH_TAG_BYTES) return null;

    const iv = buffer.subarray(0, IV_BYTES);
    const authTag = buffer.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
    const encrypted = buffer.subarray(IV_BYTES + AUTH_TAG_BYTES);

    const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, encryptionKey(), iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return JSON.parse(decrypted.toString('utf8')) as T;
  } catch (error) {
    logger.error({ err: error }, 'Falha ao decifrar credenciais do canal');
    return null;
  }
}

// --- Hashes e comparacoes --------------------------------------------------

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Compara duas strings em tempo constante (assinaturas, tokens). */
export function safeCompare(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/**
 * Valida o header `X-Hub-Signature-256` da Meta.
 * O corpo PRECISA ser o buffer cru: reserializar o JSON muda os bytes e
 * a assinatura nunca bate.
 */
export function verifyMetaSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  appSecret: string,
): boolean {
  if (!signatureHeader || !appSecret) return false;
  const [algorithm, signature] = signatureHeader.split('=');
  if (algorithm !== 'sha256' || !signature) return false;

  const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex');
  return safeCompare(signature, expected);
}

export function randomToken(bytes = 48): string {
  return randomBytes(bytes).toString('base64url');
}
