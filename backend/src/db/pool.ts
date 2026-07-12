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

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params);
}
