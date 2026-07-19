import assert from 'node:assert/strict';
import test from 'node:test';

import type { AuthConfig } from '../config.js';
import { buildAuthLoginUrl } from './routes.js';

test('builds central auth login URL with app token and frontend return_to', () => {
  const authConfig: AuthConfig = {
    url: 'https://auth.example.test',
    appToken: 'app_token',
    jwksUrl: 'https://auth.example.test/.well-known/jwks.json',
  };

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
