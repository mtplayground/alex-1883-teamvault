import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import type pg from 'pg';

const MIGRATIONS_TABLE = '_schema_migrations';

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

interface MigrationFile {
  name: string;
  sql: string;
  checksum: string;
}

interface AppliedMigration {
  name: string;
  checksum: string;
}

export async function runMigrations(
  pool: pg.Pool,
  migrationsDir: string,
): Promise<MigrationResult> {
  const client = await pool.connect();

  try {
    await ensureMigrationsTable(client);
    const migrations = await readMigrationFiles(migrationsDir);
    const applied = new Map(
      (await readAppliedMigrations(client)).map((migration) => [
        migration.name,
        migration.checksum,
      ]),
    );
    const result: MigrationResult = { applied: [], skipped: [] };

    for (const migration of migrations) {
      const appliedChecksum = applied.get(migration.name);

      if (appliedChecksum) {
        if (appliedChecksum !== migration.checksum) {
          throw new Error(`Migration checksum changed: ${migration.name}`);
        }

        result.skipped.push(migration.name);
        continue;
      }

      await client.query('begin');
      try {
        if (migration.sql.trim().length > 0) {
          await client.query(migration.sql);
        }

        await client.query(
          `insert into ${MIGRATIONS_TABLE} (name, checksum) values ($1, $2)`,
          [migration.name, migration.checksum],
        );
        await client.query('commit');
        result.applied.push(migration.name);
      } catch (error) {
        await client.query('rollback');
        throw error;
      }
    }

    return result;
  } finally {
    client.release();
  }
}

async function ensureMigrationsTable(client: pg.PoolClient): Promise<void> {
  await client.query(`
    create table if not exists ${MIGRATIONS_TABLE} (
      name text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )
  `);
}

async function readAppliedMigrations(
  client: pg.PoolClient,
): Promise<AppliedMigration[]> {
  const result = await client.query<AppliedMigration>(
    `select name, checksum from ${MIGRATIONS_TABLE} order by name`,
  );

  return result.rows;
}

async function readMigrationFiles(
  migrationsDir: string,
): Promise<MigrationFile[]> {
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  const filenames = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort();

  const migrations = await Promise.all(
    filenames.map(async (name) => {
      const filePath = path.join(migrationsDir, name);
      const sql = await readFile(filePath, 'utf8');

      return {
        name,
        sql,
        checksum: createHash('sha256').update(sql).digest('hex'),
      };
    }),
  );

  return migrations;
}
