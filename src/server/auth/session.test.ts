import assert from 'node:assert/strict';
import test from 'node:test';

import type { AuthConfig } from '../config.js';
import {
  claimsToAuthenticatedUser,
  verifySessionCookie,
  type MctaiJwtVerifier,
} from './session.js';

const authConfig: AuthConfig = {
  url: 'https://auth.example.test/',
  appToken: 'app_token',
  jwksUrl: 'https://auth.example.test/.well-known/jwks.json',
};

test('verifies mctai session cookie into authenticated user input', async () => {
  const verifier: MctaiJwtVerifier = async (token, config) => {
    assert.equal(token, 'session token');
    assert.equal(config.appToken, 'app_token');
    return {
      sub: 'auth|123',
      email: 'ADA@EXAMPLE.TEST',
      email_verified: true,
      name: 'Ada',
      picture: 'https://cdn.example.test/ada.png',
    };
  };

  const user = await verifySessionCookie(
    'theme=light; mctai_session=session%20token',
    authConfig,
    verifier,
  );

  assert.deepEqual(user, {
    sub: 'auth|123',
    email: 'ADA@EXAMPLE.TEST',
    emailVerified: true,
    name: 'Ada',
    pictureUrl: 'https://cdn.example.test/ada.png',
  });
});

test('returns null for missing config, missing cookie, or failed verification', async () => {
  const failingVerifier: MctaiJwtVerifier = async () => {
    throw new Error('bad token');
  };

  assert.equal(
    await verifySessionCookie('mctai_session=token', null, failingVerifier),
    null,
  );
  assert.equal(await verifySessionCookie('theme=light', authConfig), null);
  assert.equal(
    await verifySessionCookie(
      'mctai_session=bad-token',
      authConfig,
      failingVerifier,
    ),
    null,
  );
});

test('rejects session claims without required identity fields', () => {
  assert.throws(
    () => claimsToAuthenticatedUser({ email: 'ada@example.test' }),
    /sub is required/,
  );
  assert.throws(
    () => claimsToAuthenticatedUser({ sub: 'auth|123' }),
    /email is required/,
  );
});
