// Applies backend/src/db/migrations/*.sql in filename order, tracking
// applied filenames in a sys_schema_migrations table so re-running is a no-op.
// Each file runs as its own statement/transaction (not all 5 wrapped
// together) since CockroachDB handles standalone DDL more predictably
// than mixed multi-statement transactions.
//
// sys_schema_migrations was named schema_migrations until 2026-07-10, when it
// was renamed (sys_ prefix, per the project's table-naming convention) via a
// one-off manual ALTER TABLE - not a numbered migration file, since this table
// is what the migration loop itself depends on: replaying a rename through the
// normal apply-then-record-in-schema_migrations flow would have the loop try
// to write its own tracking row to a table it had just renamed out from under
// itself. A fresh environment never hits this - CREATE TABLE IF NOT EXISTS
// below just creates sys_schema_migrations directly, no rename ever needed.

import fs from 'fs';
import path from 'path';
import { pool } from './pool';

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function ensureMigrationsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sys_schema_migrations (
      filename    VARCHAR(255) PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function getAppliedMigrations(): Promise<Set<string>> {
  const { rows } = await pool.query<{ filename: string }>('SELECT filename FROM sys_schema_migrations');
  return new Set(rows.map((r) => r.filename));
}

export async function runMigrations(): Promise<void> {
  await ensureMigrationsTable();
  const applied = await getAppliedMigrations();

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`skip  ${file} (already applied)`);
      continue;
    }
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    console.log(`apply ${file}`);
    await pool.query(sql);
    await pool.query('INSERT INTO sys_schema_migrations (filename) VALUES ($1)', [file]);
  }
}

if (require.main === module) {
  runMigrations()
    .then(() => {
      console.log('Migrations complete.');
      return pool.end();
    })
    .catch((err) => {
      console.error('Migration failed:', err.message);
      return pool.end().finally(() => process.exit(1));
    });
}
