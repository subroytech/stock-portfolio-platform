// Applies backend/src/db/migrations against the E2E test database by
// shelling out to the backend's own existing migration runner (no parallel
// DB-access code) with DATABASE_URL overridden in the child process's env.
// Idempotent — safe to run before every test run (tracked in
// sys_schema_migrations, same as dev/prod).

import { execSync } from 'child_process';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../.env.e2e') });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set (expected the E2E test database connection string).');
  process.exit(1);
}

execSync('npm run migrate', {
  cwd: path.join(__dirname, '../../backend'),
  env: { ...process.env, DATABASE_URL: databaseUrl },
  stdio: 'inherit',
});
