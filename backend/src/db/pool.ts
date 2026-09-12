// CockroachDB Cloud connection pool. `pg-connection-string` parses
// `sslmode=verify-full` out of DATABASE_URL automatically, and CockroachDB
// Cloud certs are signed by a publicly-trusted CA, so no separate CA file
// is needed here.

import { Pool, QueryResult, QueryResultRow } from 'pg';
import env from '../config/env';

if (!env.databaseUrl) {
  throw new Error('DATABASE_URL is not set in backend environment.');
}

export const pool = new Pool({ connectionString: env.databaseUrl });

// An idle client's connection can drop for reasons outside our control (network blip, DNS
// hiccup, DB-side restart) - node-postgres reports that as an 'error' event on the pool
// rather than throwing at the query call site. An EventEmitter with no listener for 'error'
// crashes the whole Node process on the next such event - exactly what took the backend down
// on 2026-09-12 (a stray ECONNREFUSED to a bogus local IP, not a real CockroachDB outage).
// Logging and swallowing it here is safe: the pool discards the broken idle client and opens
// a fresh one on the next actual query.
pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client:', err);
});

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params);
}
