import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runMigrations } from './migrations.js';
import { closePool, getPool } from './pool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.resolve(__dirname, '../../../migrations');

try {
  const result = await runMigrations(getPool(), migrationsDir);

  console.log('Database migrations complete', {
    applied: result.applied,
    skipped: result.skipped,
  });
} catch (error) {
  console.error('Database migration failed', {
    name: error instanceof Error ? error.name : undefined,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exitCode = 1;
} finally {
  await closePool();
}
