// CockroachDB Cloud connection pool. `pg-connection-string` parses
// `sslmode=verify-full` out of DATABASE_URL automatically, and CockroachDB
// Cloud certs are signed by a publicly-trusted CA, so no separate CA file
// is needed here.

const { Pool } = require('pg');
const env = require('../config/env');

if (!env.databaseUrl) {
  throw new Error('DATABASE_URL is not set in backend environment.');
}

const pool = new Pool({ connectionString: env.databaseUrl });

async function query(text, params) {
  return pool.query(text, params);
}

module.exports = { pool, query };
