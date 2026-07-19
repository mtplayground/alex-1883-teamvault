import {
  randomBytes,
  scrypt as scryptCallback,
  type ScryptOptions,
  timingSafeEqual,
} from 'node:crypto';

const HASH_PREFIX = 'scrypt';
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

export async function hashPassword(password: string): Promise<string> {
  const normalizedPassword = normalizePassword(password);
  const salt = randomBytes(SALT_LENGTH);
  const derivedKey = await scrypt(normalizedPassword, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  });

  return [
    HASH_PREFIX,
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64url'),
    derivedKey.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  const parsed = parsePasswordHash(passwordHash);
  if (!parsed) {
    return false;
  }

  const derivedKey = await scrypt(password, parsed.salt, parsed.key.length, {
    N: parsed.n,
    r: parsed.r,
    p: parsed.p,
    maxmem: 64 * 1024 * 1024,
  });

  return (
    derivedKey.length === parsed.key.length &&
    timingSafeEqual(derivedKey, parsed.key)
  );
}

export function isPasswordHash(value: string): boolean {
  return parsePasswordHash(value) !== null;
}

interface ParsedPasswordHash {
  n: number;
  r: number;
  p: number;
  salt: Buffer;
  key: Buffer;
}

function parsePasswordHash(value: string): ParsedPasswordHash | null {
  const [prefix, rawN, rawR, rawP, rawSalt, rawKey, ...extra] =
    value.split('$');

  if (
    prefix !== HASH_PREFIX ||
    !rawN ||
    !rawR ||
    !rawP ||
    !rawSalt ||
    !rawKey ||
    extra.length > 0
  ) {
    return null;
  }

  const n = Number.parseInt(rawN, 10);
  const r = Number.parseInt(rawR, 10);
  const p = Number.parseInt(rawP, 10);

  if (
    !Number.isInteger(n) ||
    !Number.isInteger(r) ||
    !Number.isInteger(p) ||
    n < 2 ||
    r < 1 ||
    p < 1
  ) {
    return null;
  }

  const salt = Buffer.from(rawSalt, 'base64url');
  const key = Buffer.from(rawKey, 'base64url');

  if (salt.length === 0 || key.length === 0) {
    return null;
  }

  return { n, r, p, salt, key };
}

function normalizePassword(password: string): string {
  if (password.length === 0) {
    throw new Error('password is required');
  }

  return password;
}

function scrypt(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(derivedKey);
    });
  });
}
