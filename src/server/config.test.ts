import assert from 'node:assert/strict';
import test from 'node:test';

import { readAuthConfig, readStorageConfig } from './config.js';

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

test('storage config reads S3-compatible object storage settings together', () => {
  assert.equal(readStorageConfig({}), null);
  assert.deepEqual(
    readStorageConfig({
      S3_ENDPOINT_URL: ' https://storage.example.test ',
      S3_REGION: 'auto',
      S3_BUCKET: 'teamvault',
      S3_ACCESS_KEY_ID: 'access-key',
      S3_SECRET_ACCESS_KEY: 'secret-key',
    }),
    {
      endpoint: 'https://storage.example.test',
      region: 'auto',
      bucket: 'teamvault',
      accessKeyId: 'access-key',
      secretAccessKey: 'secret-key',
    },
  );
  assert.throws(
    () =>
      readStorageConfig({
        S3_ENDPOINT_URL: 'https://storage.example.test',
      }),
    /must be configured together/,
  );
});
