import type { Db } from '../db/pool';
import type { Actor } from './actor';
import { occurredAt } from './actor';

export interface AuditEntry {
  action: string;
  module: string;
  entityType?: string;
  entityId?: string | number | null;
  summary: string;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
}

/** Writes an audit record. Call inside the same transaction as the change it describes. */
export async function audit(db: Db, actor: Actor | null, entry: AuditEntry): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs (user_id, user_name, action, module, entity_type, entity_id, summary, old_values, new_values, ip, user_agent, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      actor?.userId ?? null,
      actor?.userName ?? 'System',
      entry.action,
      entry.module,
      entry.entityType ?? null,
      entry.entityId === undefined || entry.entityId === null ? null : String(entry.entityId),
      entry.summary.slice(0, 500),
      entry.oldValues ? JSON.stringify(entry.oldValues) : null,
      entry.newValues ? JSON.stringify(entry.newValues) : null,
      actor?.ip ?? null,
      actor?.userAgent?.slice(0, 300) ?? null,
      actor ? occurredAt(actor) : new Date(),
    ],
  );
}

/** Returns only the fields whose values differ, as {old, new} maps for the audit trail. */
export function diff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { old: Record<string, unknown>; new: Record<string, unknown> } | null {
  const oldValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    if (String(before[key] ?? '') !== String(after[key] ?? '')) {
      oldValues[key] = before[key];
      newValues[key] = after[key];
    }
  }
  return Object.keys(newValues).length ? { old: oldValues, new: newValues } : null;
}
