import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../../config/env';
import type { Actor } from '../../lib/actor';
import { audit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { BACKUP_DIR, safeResolve } from '../../lib/uploads';
import { pool } from '../../db/pool';
import { getSettings } from '../settings/service';

const NAME = /^dawa-\d{8}-\d{6}\.dump$/;

export async function listBackups() {
  const files = (await readdir(BACKUP_DIR)).filter((f) => NAME.test(f)).sort().reverse();
  return Promise.all(
    files.map(async (name) => {
      const s = await stat(path.join(BACKUP_DIR, name));
      return { name, size: s.size, createdAt: s.mtime };
    }),
  );
}

/**
 * Full database backup with pg_dump (custom format, compressed). Restore with:
 *   pg_restore --clean --if-exists -d "$DATABASE_URL" <file>
 */
export async function createBackup(actor: Actor | null): Promise<{ name: string; size: number }> {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const name = `dawa-${stamp}.dump`;
  const file = path.join(BACKUP_DIR, name);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(env.PG_DUMP_PATH, ['--format=custom', '--no-owner', '--dbname', env.DATABASE_URL], { stdio: ['ignore', 'pipe', 'pipe'] });
    const out = createWriteStream(file);
    let stderr = '';
    child.stdout.pipe(out);
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => reject(new AppError(503, 'BACKUP_UNAVAILABLE', `pg_dump could not be started (${(err as NodeJS.ErrnoException).code}). Install the PostgreSQL client tools or set PG_DUMP_PATH.`)));
    child.on('close', (code) => {
      out.close();
      if (code === 0) resolve();
      else reject(new AppError(500, 'BACKUP_FAILED', `Backup failed: ${stderr.trim().split('\n').pop() ?? `exit ${code}`}`));
    });
  }).catch(async (err) => {
    await unlink(file).catch(() => undefined);
    throw err;
  });
  const { size } = await stat(file);
  await audit(pool, actor, { action: 'backup', module: 'system', entityType: 'backup', entityId: name, summary: `${actor?.userName ?? 'Scheduled job'} created backup ${name}` });
  await pruneBackups();
  return { name, size };
}

async function pruneBackups() {
  const keep = (await getSettings()).system.backupRetentionCount;
  const files = await listBackups();
  for (const f of files.slice(keep)) await unlink(path.join(BACKUP_DIR, f.name)).catch(() => undefined);
}

export function backupPath(name: string) {
  if (!NAME.test(name)) throw notFound('Backup');
  return safeResolve(BACKUP_DIR, name);
}

/** Called by the scheduler: one automatic backup per 24 hours when enabled. */
export async function runScheduledBackup() {
  const settings = await getSettings();
  if (!settings.system.autoBackupDaily) return;
  const [latest] = await listBackups();
  if (latest && Date.now() - new Date(latest.createdAt).getTime() < 24 * 3_600_000) return;
  try {
    await createBackup(null);
  } catch (err) {
    logger.error({ err }, 'Scheduled backup failed');
  }
}
