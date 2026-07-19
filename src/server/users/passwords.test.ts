import assert from 'node:assert/strict';
import test from 'node:test';

import { hashPassword, isPasswordHash, verifyPassword } from './passwords.js';

test('hashes passwords with scrypt and verifies without storing plaintext', async () => {
  const hash = await hashPassword('correct horse battery staple');

  assert.notEqual(hash, 'correct horse battery staple');
  assert.equal(isPasswordHash(hash), true);
  assert.equal(
    await verifyPassword('correct horse battery staple', hash),
    true,
  );
  assert.equal(await verifyPassword('wrong password', hash), false);
});

test('rejects empty passwords and malformed password hashes', async () => {
  await assert.rejects(() => hashPassword(''), /password is required/);

  assert.equal(isPasswordHash('plain text'), false);
  assert.equal(await verifyPassword('password', 'plain text'), false);
});
