import pg from 'pg';

import type { DatabaseConfig } from './config.js';
import { readDatabaseConfig } from './config.js';

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (pool) return pool;

  pool = createPool(readDatabaseConfig(process.env));

  pool.on('error', (error) => {
    console.error('Unexpected PostgreSQL pool error', {
      name: error.name,
      code: 'code' in error ? (error as { code?: unknown }).code : undefined,
      message: error.message,
      stack: error.stack,
    });
  });

  return pool;
}

export function createPool(config: DatabaseConfig): pg.Pool {
  return new Pool({
    connectionString: config.connectionString,
    max: config.maxConnections,
    connectionTimeoutMillis: config.connectionTimeoutMillis,
    ssl: config.ssl,
  });
}

export async function closePool(): Promise<void> {
  if (!pool) return;

  await pool.end();
  pool = null;
}

export interface DatabaseSmokeResult {
  ok: true;
  latencyMs: number;
  serverTime: string;
}

export async function smokeTestDatabase(
  db: pg.Pool = getPool(),
): Promise<DatabaseSmokeResult> {
  const startedAt = performance.now();
  const result = await db.query<{ server_time: Date }>(
    'select now() as server_time',
  );
  const serverTime = result.rows[0]?.server_time;

  if (!serverTime) {
    throw new Error('PostgreSQL smoke query returned no rows');
  }

  return {
    ok: true,
    latencyMs: Math.round(performance.now() - startedAt),
    serverTime: serverTime.toISOString(),
  };
}
