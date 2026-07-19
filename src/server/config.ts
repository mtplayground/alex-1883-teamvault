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
  auth: AuthConfig;
  email: EmailConfig;
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
      selfUrl: readUrl(env, 'SELF_URL'),
    },
    database: runtime.database,
    auth: {
      url: readUrl(env, 'MCTAI_AUTH_URL'),
      appToken: readString(env, 'MCTAI_AUTH_APP_TOKEN'),
      jwksUrl: readUrl(env, 'MCTAI_AUTH_JWKS_URL'),
    },
    email: {
      url: readUrl(env, 'MCTAI_EMAIL_URL'),
      appToken: readString(env, 'MCTAI_EMAIL_APP_TOKEN'),
    },
    storage: {
      endpoint: readUrl(env, 'S3_ENDPOINT_URL'),
      region: readString(env, 'S3_REGION'),
      bucket: readString(env, 'S3_BUCKET'),
      accessKeyId: readString(env, 'S3_ACCESS_KEY_ID'),
      secretAccessKey: readString(env, 'S3_SECRET_ACCESS_KEY'),
    },
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

function readUrl(env: NodeJS.ProcessEnv, key: string): string {
  const value = readString(env, key);

  try {
    return new URL(value).toString();
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
