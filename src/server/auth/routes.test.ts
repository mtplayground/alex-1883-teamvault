import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import test from 'node:test';

import express from 'express';

import type { AuthConfig } from '../config.js';
import { createAuthRouter } from './routes.js';
import { buildAuthLoginUrl } from './urls.js';

const authConfig: AuthConfig = {
  url: 'https://auth.example.test',
  appToken: 'app_token',
  jwksUrl: 'https://auth.example.test/.well-known/jwks.json',
};

test('builds central auth login URL with app token and frontend return_to', () => {
  const loginUrl = new URL(
    buildAuthLoginUrl(authConfig, 'https://app.example.test/'),
  );

  assert.equal(loginUrl.origin, 'https://auth.example.test');
  assert.equal(loginUrl.pathname, '/login');
  assert.equal(loginUrl.searchParams.get('app_token'), 'app_token');
  assert.equal(
    loginUrl.searchParams.get('return_to'),
    'https://app.example.test/',
  );
});

test('auth login accepts only frontend return_to paths', async () => {
  const app = express();
  app.use(
    '/api/auth',
    createAuthRouter({
      authConfig,
      selfUrl: 'https://app.example.test',
      db: {
        query: async <T>() => ({ rows: [] as T[] }),
      },
    }),
  );
  const server = app.listen(0);

  try {
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const frontendResponse = await fetch(
      `${baseUrl}/api/auth/login?return_to=${encodeURIComponent(
        '/invitations/accept?token=abc',
      )}`,
      { redirect: 'manual' },
    );
    const apiResponse = await fetch(
      `${baseUrl}/api/auth/login?return_to=${encodeURIComponent(
        '/api/auth/session',
      )}`,
      { redirect: 'manual' },
    );
    const externalResponse = await fetch(
      `${baseUrl}/api/auth/login?return_to=${encodeURIComponent(
        '//example.invalid/path',
      )}`,
      { redirect: 'manual' },
    );

    assert.equal(frontendResponse.status, 302);
    assert.equal(apiResponse.status, 302);
    assert.equal(externalResponse.status, 302);
    assert.equal(
      new URL(frontendResponse.headers.get('location') ?? '').searchParams.get(
        'return_to',
      ),
      'https://app.example.test/invitations/accept?token=abc',
    );
    assert.equal(
      new URL(apiResponse.headers.get('location') ?? '').searchParams.get(
        'return_to',
      ),
      'https://app.example.test/',
    );
    assert.equal(
      new URL(externalResponse.headers.get('location') ?? '').searchParams.get(
        'return_to',
      ),
      'https://app.example.test/',
    );
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
