// Applies backend/src/db/migrations/*.sql in filename order, tracking
// applied filenames in a schema_migrations table so re-running is a no-op.
// Each file runs as its own statement/transaction (not all 5 wrapped
// together) since CockroachDB handles standalone DDL more predictably
// than mixed multi-statement transactions.

const fs = require('fs');
const path = require('path');
const { pool } = require('./pool');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function ensureMigrationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    VARCHAR(255) PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function getAppliedMigrations() {
  const { rows } = await pool.query('SELECT filename FROM schema_migrations');
  return new Set(rows.map((r) => r.filename));
}

async function runMigrations() {
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
    await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
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

module.exports = { runMigrations };
