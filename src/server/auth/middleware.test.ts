import assert from 'node:assert/strict';
import test from 'node:test';

import type { AuthConfig } from '../config.js';
import type { UserAccountQueryable } from '../users/model.js';
import {
  authenticateSession,
  type AuthenticationResult,
} from './middleware.js';
import type { MctaiJwtVerifier } from './session.js';

const authConfig: AuthConfig = {
  url: 'https://auth.example.test',
  appToken: 'app_token',
  jwksUrl: 'https://auth.example.test/.well-known/jwks.json',
};

test('authenticates a valid mctai session and identifies the current user', async () => {
  const db = userDb({ emailVerified: true, inserted: false });
  const verifier: MctaiJwtVerifier = async () => ({
    sub: 'auth|123',
    email: 'ada@example.test',
    email_verified: true,
    name: 'Ada',
  });

  const result = await authenticateSession({
    cookieHeader: 'mctai_session=valid',
    authConfig,
    db,
    verifier,
  });

  assert.equal(result.status, 'authenticated');
  assert.equal(authenticatedUser(result)?.sub, 'auth|123');
  assert.equal(authenticatedUser(result)?.emailVerified, true);
});

test('rejects missing or invalid mctai sessions', async () => {
  const verifier: MctaiJwtVerifier = async () => {
    throw new Error('bad session');
  };

  assert.deepEqual(
    await authenticateSession({
      cookieHeader: undefined,
      authConfig,
      db: userDb({ emailVerified: true, inserted: false }),
      verifier,
    }),
    { status: 'unauthenticated' },
  );
  assert.deepEqual(
    await authenticateSession({
      cookieHeader: 'mctai_session=invalid',
      authConfig,
      db: userDb({ emailVerified: true, inserted: false }),
      verifier,
    }),
    { status: 'unauthenticated' },
  );
});

test('rejects unverified auth claims after user upsert', async () => {
  const verifier: MctaiJwtVerifier = async () => ({
    sub: 'auth|123',
    email: 'ada@example.test',
    email_verified: false,
  });

  const result = await authenticateSession({
    cookieHeader: 'mctai_session=valid',
    authConfig,
    db: userDb({ emailVerified: false, inserted: true }),
    verifier,
  });

  assert.equal(result.status, 'unverified');
  assert.equal(authenticatedUser(result)?.emailVerified, false);
});

function userDb({
  emailVerified,
  inserted,
}: {
  emailVerified: boolean;
  inserted: boolean;
}): UserAccountQueryable {
  const now = new Date('2026-07-19T00:00:00.000Z');

  return {
    query: async <T>() => ({
      rows: [
        {
          sub: 'auth|123',
          email: 'ada@example.test',
          email_verified: emailVerified,
          name: 'Ada',
          picture_url: null,
          password_hash: null,
          created_at: now,
          updated_at: now,
          last_seen_at: now,
          inserted,
        } as T,
      ],
    }),
  };
}

function authenticatedUser(result: AuthenticationResult) {
  return result.status === 'authenticated' || result.status === 'unverified'
    ? result.user
    : null;
}
