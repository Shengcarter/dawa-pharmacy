import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';
import { pool as runtimePool } from './pool';
import { env } from '../config/env';
import { logger } from '../lib/logger';

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations', import.meta.url));

/**
 * Applies pending .sql migrations in filename order, each in its own transaction.
 * With MIGRATIONS_DATABASE_URL (the schema owner) the runtime role in
 * DATABASE_URL needs no DDL rights at all: it only gets data access below.
 */
export async function runMigrations(): Promise<string[]> {
  const separate = Boolean(env.MIGRATIONS_DATABASE_URL);
  const pool = separate ? new pg.Pool({ connectionString: env.MIGRATIONS_DATABASE_URL, max: 1 }) : runtimePool;
  try {
    const ran = await applyMigrations(pool);
    if (separate) await grantRuntimeAccess(pool);
    return ran;
  } finally {
    if (separate) await pool.end();
  }
}

/** Least privilege for the application's runtime role (see docs/SECURITY.md). */
async function grantRuntimeAccess(pool: pg.Pool) {
  const role = decodeURIComponent(new URL(env.DATABASE_URL).username);
  const owner = decodeURIComponent(new URL(env.MIGRATIONS_DATABASE_URL!).username);
  if (!role || role === owner) return;
  const r = pg.escapeIdentifier(role);
  await pool.query(`GRANT USAGE ON SCHEMA public TO ${r}`);
  await pool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${r}`);
  await pool.query(`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${r}`);
  // History tables are append-only for the application (old audit entries may be purged by retention).
  await pool.query(`REVOKE UPDATE, DELETE ON inventory_movements, schema_migrations FROM ${r}`);
  await pool.query(`REVOKE UPDATE ON audit_logs FROM ${r}`);
  await pool.query(`REVOKE INSERT, UPDATE, DELETE ON schema_migrations FROM ${r}`);
  logger.info({ role }, 'Granted runtime data access (no schema changes)');
}

async function applyMigrations(pool: pg.Pool): Promise<string[]> {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name VARCHAR(200) PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const applied = new Set((await pool.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name as string));
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      ran.push(file);
      logger.info({ migration: file }, 'Applied migration');
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }
  return ran;
}
