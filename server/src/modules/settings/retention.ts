import { pool } from '../../db/pool';
import { logger } from '../../lib/logger';
import { getSettings } from './service';

/** Deletes audit and sign-in records older than the configured retention period (minimum one year). */
export async function purgeExpiredAuditLogs() {
  const days = (await getSettings()).system.auditRetentionDays;
  const audit = await pool.query(`DELETE FROM audit_logs WHERE created_at < now() - make_interval(days => $1)`, [days]);
  const logins = await pool.query(`DELETE FROM login_activity WHERE created_at < now() - make_interval(days => $1)`, [days]);
  if (audit.rowCount || logins.rowCount) logger.info({ audit: audit.rowCount, logins: logins.rowCount, days }, 'Purged expired audit records');
}
