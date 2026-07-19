import assert from 'node:assert/strict';
import test from 'node:test';

import type { AuthConfig } from '../config.js';
import {
  passwordResetCompleteResponse,
  passwordResetRequestResponse,
} from './password-reset.js';

const authConfig: AuthConfig = {
  url: 'https://auth.example.test',
  appToken: 'app_token',
  jwksUrl: 'https://auth.example.test/.well-known/jwks.json',
};

test('password reset request response does not reveal whether an email exists', () => {
  assert.deepEqual(passwordResetRequestResponse(), {
    status: 'accepted',
    message:
      'If this email can be used to sign in, continue with the central sign-in flow.',
  });
});

test('password reset completion sends clients back through central auth', () => {
  const response = passwordResetCompleteResponse(
    authConfig,
    'https://app.example.test/',
  );
  const loginUrl = new URL(response.loginUrl);

  assert.equal(response.status, 'central_auth_required');
  assert.equal(loginUrl.origin, 'https://auth.example.test');
  assert.equal(loginUrl.pathname, '/login');
  assert.equal(loginUrl.searchParams.get('app_token'), 'app_token');
  assert.equal(
    loginUrl.searchParams.get('return_to'),
    'https://app.example.test/',
  );
});
