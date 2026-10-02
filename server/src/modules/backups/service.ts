import { spawn } from 'node:child_process';
import { chmodSync, createWriteStream, mkdirSync } from 'node:fs';
import { copyFile, readdir, stat, unlink } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { env } from '../../config/env';
import type { Actor } from '../../lib/actor';
import { audit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { BACKUP_DIR, safeResolve } from '../../lib/uploads';
import { pool } from '../../db/pool';
import { getSettings } from '../settings/service';
import { raiseNotification, resolveNotifications } from '../notifications/service';
import { encryptingStream, parseKey } from '../../lib/backupCrypto';

const NAME = /^dawa-\d{8}-\d{6}\.dump(\.enc)?$/;
const backupKey = env.BACKUP_ENCRYPTION_KEY ? parseKey(env.BACKUP_ENCRYPTION_KEY) : null;

// Backups hold every record in the system: readable by the service account only.
chmodSync(BACKUP_DIR, 0o700);
if (env.BACKUP_COPY_DIR) mkdirSync(env.BACKUP_COPY_DIR, { recursive: true, mode: 0o700 });
if (env.isProduction && !backupKey) logger.warn('BACKUP_ENCRYPTION_KEY is not set: backups are stored unencrypted');
if (env.isProduction && !env.BACKUP_COPY_DIR) logger.warn('BACKUP_COPY_DIR is not set: backups exist only on this server');

export const backupProtection = { encrypted: backupKey !== null, offServerCopy: Boolean(env.BACKUP_COPY_DIR) };

export async function listBackups(dir = BACKUP_DIR) {
  const files = (await readdir(dir)).filter((f) => NAME.test(f)).sort().reverse();
  return Promise.all(
    files.map(async (name) => {
      const s = await stat(path.join(dir, name));
      return { name, size: s.size, createdAt: s.mtime, encrypted: name.endsWith('.enc') };
    }),
  );
}

/**
 * libpq connection settings as environment variables, so the database password
 * never appears on pg_dump's command line (visible to other users via ps).
 */
function pgEnv(url: string): NodeJS.ProcessEnv {
  const u = new URL(url);
  const out: NodeJS.ProcessEnv = {
    PATH: process.env.PATH, HOME: process.env.HOME,
    PGHOST: u.hostname, PGPORT: u.port || '5432', PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password), PGDATABASE: decodeURIComponent(u.pathname.replace(/^\//, '')),
  };
  const sslmode = u.searchParams.get('sslmode');
  if (sslmode) out.PGSSLMODE = sslmode;
  return out;
}

/**
 * Full database backup with pg_dump (custom format, compressed), encrypted
 * when BACKUP_ENCRYPTION_KEY is set and copied to BACKUP_COPY_DIR when set.
 * See docs/SECURITY.md for the restore procedure.
 */
export async function createBackup(actor: Actor | null): Promise<{ name: string; size: number; copied: boolean }> {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const name = `dawa-${stamp}.dump${backupKey ? '.enc' : ''}`;
  const file = path.join(BACKUP_DIR, name);
  try {
    await new Promise<void>((resolve, reject) => {
      // The schema owner can read everything, including objects the runtime role cannot.
      const child = spawn(env.PG_DUMP_PATH, ['--format=custom', '--no-owner', '--no-privileges'], {
        stdio: ['ignore', 'pipe', 'pipe'], env: pgEnv(env.MIGRATIONS_DATABASE_URL ?? env.DATABASE_URL),
      });
      let stderr = '';
      child.stderr.on('data', (d) => { stderr += d.toString(); });
      child.on('error', (err) => reject(new AppError(503, 'BACKUP_UNAVAILABLE', `pg_dump could not be started (${(err as NodeJS.ErrnoException).code}). Install the PostgreSQL client tools or set PG_DUMP_PATH.`)));
      const out = createWriteStream(file, { mode: 0o600 });
      const written = backupKey ? pipeline(child.stdout, encryptingStream(backupKey), out) : pipeline(child.stdout, out);
      child.on('close', (code) => {
        written.then(() => {
          if (code === 0) resolve();
          else reject(new AppError(500, 'BACKUP_FAILED', `Backup failed: ${stderr.trim().split('\n').pop() ?? `exit ${code}`}`));
        }, reject);
      });
    });
  } catch (err) {
    await unlink(file).catch(() => undefined);
    await raiseNotification({
      type: 'system', severity: 'critical', dedupeKey: 'backup:failed', title: 'Database backup failed',
      message: err instanceof AppError ? err.message : 'The backup could not be written. Check the server log.', link: '/settings?section=system',
      audiencePermission: 'backups.manage',
    }).catch(() => undefined);
    throw err;
  }
  const { size } = await stat(file);
  let copied = false;
  if (env.BACKUP_COPY_DIR) {
    try {
      await copyFile(file, path.join(env.BACKUP_COPY_DIR, name));
      copied = true;
      await resolveNotifications(['backup:copy-failed']);
    } catch (err) {
      logger.error({ err }, 'Copying the backup to BACKUP_COPY_DIR failed');
      await raiseNotification({
        type: 'system', severity: 'critical', dedupeKey: 'backup:copy-failed', title: 'Backup was not copied off the server',
        message: `${name} was created but could not be copied to the second location. Check that the backup drive or share is connected.`,
        link: '/settings?section=system', audiencePermission: 'backups.manage',
      }).catch(() => undefined);
    }
  }
  await resolveNotifications(['backup:failed']);
  await audit(pool, actor, {
    action: 'backup', module: 'system', entityType: 'backup', entityId: name,
    summary: `${actor?.userName ?? 'Scheduled job'} created backup ${name}${backupKey ? ' (encrypted)' : ''}${copied ? ', copied to the second location' : ''}`,
  });
  await pruneBackups();
  return { name, size, copied };
}

async function pruneBackups() {
  const keep = (await getSettings()).system.backupRetentionCount;
  for (const dir of [BACKUP_DIR, env.BACKUP_COPY_DIR].filter(Boolean) as string[]) {
    const files = await listBackups(dir).catch(() => []);
    for (const f of files.slice(keep)) await unlink(path.join(dir, f.name)).catch(() => undefined);
  }
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
