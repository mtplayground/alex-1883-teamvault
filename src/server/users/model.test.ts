import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeAuthenticatedUser,
  setUserPasswordHash,
  upsertUserAccount,
  type UserAccountQueryable,
} from './model.js';
import { hashPassword } from './passwords.js';

test('normalizes authenticated user claims before persistence', () => {
  assert.deepEqual(
    normalizeAuthenticatedUser({
      sub: '  auth|123  ',
      email: '  ADA@EXAMPLE.TEST ',
      emailVerified: true,
      name: '  Ada  ',
      pictureUrl: ' ',
    }),
    {
      sub: 'auth|123',
      email: 'ada@example.test',
      emailVerified: true,
      name: 'Ada',
      pictureUrl: null,
    },
  );
});

test('rejects invalid authenticated user claims', () => {
  assert.throws(
    () =>
      normalizeAuthenticatedUser({
        sub: '',
        email: 'ada@example.test',
        emailVerified: true,
      }),
    /sub is required/,
  );
  assert.throws(
    () =>
      normalizeAuthenticatedUser({
        sub: 'auth|123',
        email: 'not-an-email',
        emailVerified: false,
      }),
    /email must be a valid email address/,
  );
});

test('upserts user account rows from verified auth claims', async () => {
  const queries: Array<{
    sql: string;
    values: readonly unknown[] | undefined;
  }> = [];
  const now = new Date('2026-07-19T00:00:00.000Z');
  const db: UserAccountQueryable = {
    query: async <T>(sql: string, values?: readonly unknown[]) => {
      queries.push({ sql, values });
      return {
        rows: [
          {
            sub: 'auth|123',
            email: 'ada@example.test',
            email_verified: true,
            name: 'Ada',
            picture_url: null,
            password_hash: null,
            created_at: now,
            updated_at: now,
            last_seen_at: now,
            inserted: true,
          } as T,
        ],
      };
    },
  };

  const result = await upsertUserAccount(db, {
    sub: ' auth|123 ',
    email: 'ADA@EXAMPLE.TEST',
    emailVerified: true,
    name: 'Ada',
  });

  assert.equal(result.isNew, true);
  assert.equal(result.user.email, 'ada@example.test');
  assert.equal(result.user.passwordHash, null);
  assert.match(queries[0]?.sql ?? '', /on conflict \(sub\) do update/);
  assert.deepEqual(queries[0]?.values, [
    'auth|123',
    'ada@example.test',
    true,
    'Ada',
    null,
  ]);
});

test('stores only a non-empty password hash value', async () => {
  const now = new Date('2026-07-19T00:00:00.000Z');
  const passwordHash = await hashPassword('correct horse battery staple');
  const db: UserAccountQueryable = {
    query: async <T>() => ({
      rows: [
        {
          sub: 'auth|123',
          email: 'ada@example.test',
          email_verified: true,
          name: 'Ada',
          picture_url: null,
          password_hash: passwordHash,
          created_at: now,
          updated_at: now,
          last_seen_at: now,
          inserted: false,
        } as T,
      ],
    }),
  };

  await assert.rejects(() => setUserPasswordHash(db, 'auth|123', ' '));
  await assert.rejects(
    () => setUserPasswordHash(db, 'auth|123', 'plain text'),
    /passwordHash must be a supported password hash/,
  );
  const user = await setUserPasswordHash(db, ' auth|123 ', ` ${passwordHash} `);

  assert.equal(user.passwordHash, passwordHash);
});
