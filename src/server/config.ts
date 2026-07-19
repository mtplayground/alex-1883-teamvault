import { readDatabaseConfig, type DatabaseConfig } from './db/config.js';

export interface ServerConfig {
  host: string;
  port: number;
  selfUrl: string;
}

export interface AuthConfig {
  url: string;
  appToken: string;
  jwksUrl: string;
}

export interface EmailConfig {
  url: string;
  appToken: string;
}

export interface StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface AppConfig {
  server: ServerConfig;
  database: DatabaseConfig;
  auth: AuthConfig | null;
  email: EmailConfig | null;
  storage: StorageConfig;
}

export interface RuntimeConfig {
  server: Pick<ServerConfig, 'host' | 'port'>;
  database: DatabaseConfig;
}

export function readRuntimeConfig(env: NodeJS.ProcessEnv): RuntimeConfig {
  return {
    server: {
      host: readString(env, 'HOST', '0.0.0.0'),
      port: readPositiveInteger(env, 'PORT', 8080),
    },
    database: readDatabaseConfig(env),
  };
}

export function readAppConfig(env: NodeJS.ProcessEnv): AppConfig {
  const runtime = readRuntimeConfig(env);

  return {
    server: {
      ...runtime.server,
      selfUrl: readSelfUrl(env),
    },
    database: runtime.database,
    auth: readAuthConfig(env),
    email: readEmailConfig(env),
    storage: {
      endpoint: readUrl(env, 'S3_ENDPOINT_URL'),
      region: readString(env, 'S3_REGION'),
      bucket: readString(env, 'S3_BUCKET'),
      accessKeyId: readString(env, 'S3_ACCESS_KEY_ID'),
      secretAccessKey: readString(env, 'S3_SECRET_ACCESS_KEY'),
    },
  };
}

export function readAuthConfig(env: NodeJS.ProcessEnv): AuthConfig | null {
  const hasUrl = hasValue(env.MCTAI_AUTH_URL);
  const hasToken = hasValue(env.MCTAI_AUTH_APP_TOKEN);
  const hasJwksUrl = hasValue(env.MCTAI_AUTH_JWKS_URL);

  if (!hasUrl && !hasToken && !hasJwksUrl) {
    return null;
  }

  if (!hasUrl || !hasToken || !hasJwksUrl) {
    throw new Error(
      'MCTAI_AUTH_URL, MCTAI_AUTH_APP_TOKEN, and MCTAI_AUTH_JWKS_URL must be configured together',
    );
  }

  return {
    url: readUrl(env, 'MCTAI_AUTH_URL'),
    appToken: readString(env, 'MCTAI_AUTH_APP_TOKEN'),
    jwksUrl: readUrl(env, 'MCTAI_AUTH_JWKS_URL'),
  };
}

export function readSelfUrl(env: NodeJS.ProcessEnv): string {
  return readUrl(env, 'SELF_URL');
}

export function readEmailConfig(env: NodeJS.ProcessEnv): EmailConfig | null {
  const hasUrl = hasValue(env.MCTAI_EMAIL_URL);
  const hasToken = hasValue(env.MCTAI_EMAIL_APP_TOKEN);

  if (!hasUrl && !hasToken) {
    return null;
  }

  if (!hasUrl || !hasToken) {
    throw new Error(
      'MCTAI_EMAIL_URL and MCTAI_EMAIL_APP_TOKEN must be configured together',
    );
  }

  return {
    url: readUrl(env, 'MCTAI_EMAIL_URL'),
    appToken: readString(env, 'MCTAI_EMAIL_APP_TOKEN'),
  };
}

function readString(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback?: string,
): string {
  const value = env[key] ?? fallback;

  if (!value || value.trim().length === 0) {
    throw new Error(`${key} is required`);
  }

  return value;
}

function hasValue(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0;
}

function readUrl(env: NodeJS.ProcessEnv, key: string): string {
  const value = readString(env, key);
  const trimmedValue = value.trim();

  try {
    new URL(trimmedValue);
    return trimmedValue;
  } catch {
    throw new Error(`${key} must be a valid URL`);
  }
}

function readPositiveInteger(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
): number {
  const rawValue = env[key] ?? String(fallback);
  const value = Number.parseInt(rawValue, 10);

  if (!Number.isInteger(value) || value < 1 || String(value) !== rawValue) {
    throw new Error(`${key} must be a positive integer`);
  }

  return value;
}
