import pg from 'pg';
import { env } from '../config/env';
import { logger } from '../lib/logger';

// NUMERIC → number. Amounts are ≤ 1e11 with 2 decimals, exact in a double;
// arithmetic is done in integer cents (see lib/money.ts).
pg.types.setTypeParser(1700, (v) => Number(v));
// BIGINT (counts) → number: our counts never approach 2^53.
pg.types.setTypeParser(20, (v) => Number(v));
// DATE stays as 'YYYY-MM-DD' text, never shifted by the server time zone.
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: env.DATABASE_POOL_MAX,
  idleTimeoutMillis: 30_000,
});

pool.on('error', (err) => logger.error({ err }, 'Unexpected PostgreSQL pool error'));

export type Db = pg.Pool | pg.PoolClient;
export type Tx = pg.PoolClient;

/** Runs `fn` in a transaction; rolls back on any thrown error. */
export async function withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function one<T = Record<string, unknown>>(db: Db, sql: string, params: unknown[] = []): Promise<T | null> {
  const { rows } = await db.query(sql, params);
  return (rows[0] as T) ?? null;
}

export async function many<T = Record<string, unknown>>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  const { rows } = await db.query(sql, params);
  return rows as T[];
}
