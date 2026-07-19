import { isPasswordHash } from './passwords.js';

export interface UserAccount {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  pictureUrl: string | null;
  passwordHash: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastSeenAt: Date;
}

export interface AuthenticatedUserInput {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string | null;
  pictureUrl?: string | null;
}

export interface UserAccountUpsertResult {
  user: UserAccount;
  isNew: boolean;
}

interface UserAccountRow {
  sub: string;
  email: string;
  email_verified: boolean;
  name: string | null;
  picture_url: string | null;
  password_hash: string | null;
  created_at: Date;
  updated_at: Date;
  last_seen_at: Date;
  inserted: boolean;
}

export interface UserAccountQueryable {
  query<T>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{
    rows: T[];
  }>;
}

export async function upsertUserAccount(
  db: UserAccountQueryable,
  input: AuthenticatedUserInput,
): Promise<UserAccountUpsertResult> {
  const normalized = normalizeAuthenticatedUser(input);
  const result = await db.query<UserAccountRow>(
    `
      insert into users (
        sub,
        email,
        email_verified,
        name,
        picture_url,
        last_seen_at
      )
      values ($1, $2, $3, $4, $5, now())
      on conflict (sub) do update set
        email = excluded.email,
        email_verified = excluded.email_verified,
        name = excluded.name,
        picture_url = excluded.picture_url,
        updated_at = now(),
        last_seen_at = now()
      returning
        sub,
        email,
        email_verified,
        name,
        picture_url,
        password_hash,
        created_at,
        updated_at,
        last_seen_at,
        (xmax = 0) as inserted
    `,
    [
      normalized.sub,
      normalized.email,
      normalized.emailVerified,
      normalized.name,
      normalized.pictureUrl,
    ],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error('User upsert returned no rows');
  }

  return {
    user: mapUserAccountRow(row),
    isNew: row.inserted,
  };
}

export async function setUserPasswordHash(
  db: UserAccountQueryable,
  sub: string,
  passwordHash: string,
): Promise<UserAccount> {
  const normalizedSub = normalizeRequiredText(sub, 'sub');
  const normalizedPasswordHash = normalizeRequiredText(
    passwordHash,
    'passwordHash',
  );

  if (!isPasswordHash(normalizedPasswordHash)) {
    throw new Error('passwordHash must be a supported password hash');
  }

  const result = await db.query<UserAccountRow>(
    `
      update users
      set password_hash = $2,
          updated_at = now()
      where sub = $1
      returning
        sub,
        email,
        email_verified,
        name,
        picture_url,
        password_hash,
        created_at,
        updated_at,
        last_seen_at,
        false as inserted
    `,
    [normalizedSub, normalizedPasswordHash],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error('User not found');
  }

  return mapUserAccountRow(row);
}

export function normalizeAuthenticatedUser(
  input: AuthenticatedUserInput,
): AuthenticatedUserInput {
  return {
    sub: normalizeRequiredText(input.sub, 'sub'),
    email: normalizeEmail(input.email),
    emailVerified: input.emailVerified,
    name: normalizeOptionalText(input.name),
    pictureUrl: normalizeOptionalText(input.pictureUrl),
  };
}

function mapUserAccountRow(row: UserAccountRow): UserAccount {
  return {
    sub: row.sub,
    email: row.email,
    emailVerified: row.email_verified,
    name: row.name,
    pictureUrl: row.picture_url,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSeenAt: row.last_seen_at,
  };
}

function normalizeEmail(email: string): string {
  const normalized = normalizeRequiredText(email, 'email').toLowerCase();

  if (!normalized.includes('@')) {
    throw new Error('email must be a valid email address');
  }

  return normalized;
}

function normalizeRequiredText(value: string, field: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`${field} is required`);
  }

  return normalized;
}

function normalizeOptionalText(
  value: string | null | undefined,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
