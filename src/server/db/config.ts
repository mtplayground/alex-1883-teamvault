export interface DatabaseConfig {
  connectionString: string;
  maxConnections: number;
  connectionTimeoutMillis: number;
  ssl?: boolean | { rejectUnauthorized: boolean };
}

export function readDatabaseConfig(env: NodeJS.ProcessEnv): DatabaseConfig {
  const rawConnectionString = env.DATABASE_URL;

  if (!rawConnectionString) {
    throw new Error('DATABASE_URL is required to connect to PostgreSQL');
  }

  const maxConnections = Number.parseInt(
    env.DATABASE_MAX_CONNECTIONS ?? '5',
    10,
  );

  if (!Number.isInteger(maxConnections) || maxConnections < 1) {
    throw new Error('DATABASE_MAX_CONNECTIONS must be a positive integer');
  }

  const connectionTimeoutMillis = Number.parseInt(
    env.DATABASE_CONNECTION_TIMEOUT_MS ?? '5000',
    10,
  );

  if (
    !Number.isInteger(connectionTimeoutMillis) ||
    connectionTimeoutMillis < 1
  ) {
    throw new Error(
      'DATABASE_CONNECTION_TIMEOUT_MS must be a positive integer',
    );
  }

  const { connectionString, ssl } = normalizeDatabaseUrl(rawConnectionString);

  return {
    connectionString,
    maxConnections,
    connectionTimeoutMillis,
    ssl,
  };
}

function normalizeDatabaseUrl(connectionString: string): {
  connectionString: string;
  ssl?: boolean | { rejectUnauthorized: boolean };
} {
  const url = new URL(connectionString);
  const sslMode = url.searchParams.get('sslmode');

  if (!sslMode) {
    return { connectionString };
  }

  url.searchParams.delete('sslmode');

  if (sslMode === 'disable') {
    return { connectionString: url.toString(), ssl: false };
  }

  if (sslMode === 'verify-full') {
    return { connectionString: url.toString(), ssl: true };
  }

  if (
    sslMode === 'require' ||
    sslMode === 'prefer' ||
    sslMode === 'verify-ca'
  ) {
    return {
      connectionString: url.toString(),
      ssl: { rejectUnauthorized: false },
    };
  }

  throw new Error(`Unsupported DATABASE_URL sslmode: ${sslMode}`);
}
