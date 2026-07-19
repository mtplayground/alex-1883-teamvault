import assert from 'node:assert/strict';
import test from 'node:test';

import { readAuthConfig } from './config.js';

test('auth config preserves issuer URL exactly after trimming', () => {
  assert.deepEqual(
    readAuthConfig({
      MCTAI_AUTH_URL: ' https://auth.example.test ',
      MCTAI_AUTH_APP_TOKEN: 'app_token',
      MCTAI_AUTH_JWKS_URL: ' https://auth.example.test/.well-known/jwks.json ',
    }),
    {
      url: 'https://auth.example.test',
      appToken: 'app_token',
      jwksUrl: 'https://auth.example.test/.well-known/jwks.json',
    },
  );
});
