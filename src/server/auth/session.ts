import jwt, {
  type JwtHeader,
  type JwtPayload,
  type SigningKeyCallback,
} from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';

import type { AuthConfig } from '../config.js';
import type { AuthenticatedUserInput } from '../users/model.js';

export interface MctaiSessionClaims extends JwtPayload {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

export type MctaiJwtVerifier = (
  token: string,
  config: AuthConfig,
) => Promise<unknown>;

const jwksClients = new Map<string, jwksClient.JwksClient>();

export async function verifySessionCookie(
  cookieHeader: string | undefined,
  config: AuthConfig | null,
  verifier: MctaiJwtVerifier = verifyJwtWithJwks,
): Promise<AuthenticatedUserInput | null> {
  if (!config) {
    return null;
  }

  const token = parseCookies(cookieHeader).get('mctai_session');
  if (!token) {
    return null;
  }

  try {
    return claimsToAuthenticatedUser(await verifier(token, config));
  } catch {
    return null;
  }
}

export async function verifyJwtWithJwks(
  token: string,
  config: AuthConfig,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      (header: JwtHeader, callback: SigningKeyCallback) => {
        void getSigningKey(header, config).then(
          (publicKey) => callback(null, publicKey),
          (error: unknown) =>
            callback(error instanceof Error ? error : new Error(String(error))),
        );
      },
      {
        audience: config.appToken,
        issuer: config.url,
      },
      (error, claims) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(claims);
      },
    );
  });
}

export function claimsToAuthenticatedUser(
  claims: unknown,
): AuthenticatedUserInput {
  if (!isClaimsRecord(claims)) {
    throw new Error('Session claims must be an object');
  }

  const sub = readClaimString(claims, 'sub');
  const email = readClaimString(claims, 'email');
  const emailVerified =
    typeof claims.email_verified === 'boolean' ? claims.email_verified : false;
  const name =
    typeof claims.name === 'string' && claims.name.trim().length > 0
      ? claims.name
      : null;
  const pictureUrl =
    typeof claims.picture === 'string' && claims.picture.trim().length > 0
      ? claims.picture
      : null;

  return {
    sub,
    email,
    emailVerified,
    name,
    pictureUrl,
  };
}

function parseCookies(cookieHeader: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!cookieHeader) {
    return cookies;
  }

  for (const part of cookieHeader.split(';')) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();

    if (key) {
      cookies.set(key, decodeURIComponent(value));
    }
  }

  return cookies;
}

async function getSigningKey(
  header: JwtHeader,
  config: AuthConfig,
): Promise<string> {
  if (!header.kid) {
    throw new Error('JWT header missing kid');
  }

  let client = jwksClients.get(config.jwksUrl);
  if (!client) {
    client = jwksClient({ jwksUri: config.jwksUrl });
    jwksClients.set(config.jwksUrl, client);
  }

  const key = await client.getSigningKey(header.kid);
  return key.getPublicKey();
}

function isClaimsRecord(claims: unknown): claims is Record<string, unknown> {
  return typeof claims === 'object' && claims !== null;
}

function readClaimString(claims: Record<string, unknown>, key: string): string {
  const value = claims[key];

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Session claim ${key} is required`);
  }

  return value;
}
