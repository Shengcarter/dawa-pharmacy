import { addDays, formatMoney, todayIn, type NotificationSeverity, type NotificationType } from '@dawa/shared';
import { pool } from '../../db/pool';
import type { Actor } from '../../lib/actor';
import { getSettings } from '../settings/service';

export interface NotificationInput {
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  message: string;
  link?: string | null;
  audiencePermission?: string | null;
  userId?: number | null;
  /** Same key = same condition; it is updated in place instead of duplicated. */
  dedupeKey?: string | null;
}

/**
 * Creates a notification, or refreshes the open one with the same key. A
 * condition that comes back after being resolved re-opens as unread.
 */
export async function raiseNotification(n: NotificationInput) {
  const { rows } = await pool.query(
    `INSERT INTO notifications (type, severity, title, message, link, audience_permission, user_id, dedupe_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (dedupe_key) DO UPDATE SET
       type = EXCLUDED.type, severity = EXCLUDED.severity, title = EXCLUDED.title, message = EXCLUDED.message, link = EXCLUDED.link,
       created_at = CASE WHEN notifications.resolved_at IS NOT NULL OR notifications.severity <> EXCLUDED.severity THEN now() ELSE notifications.created_at END,
       resolved_at = NULL, updated_at = now()
     RETURNING id, (xmax = 0) AS inserted, created_at = updated_at AS reopened`,
    [n.type, n.severity, n.title, n.message, n.link ?? null, n.audiencePermission ?? null, n.userId ?? null, n.dedupeKey ?? null],
  );
  // Re-opened or escalated conditions should be seen again.
  if (rows[0] && !rows[0].inserted && rows[0].reopened) {
    await pool.query('DELETE FROM notification_reads WHERE notification_id = $1', [rows[0].id]);
  }
}

export async function resolveNotifications(keys: string[]) {
  if (!keys.length) return;
  await pool.query(`UPDATE notifications SET resolved_at = now() WHERE dedupe_key = ANY($1::text[]) AND resolved_at IS NULL`, [keys]);
}

async function resolveByPrefixExcept(prefix: string, keep: string[]) {
  await pool.query(
    `UPDATE notifications SET resolved_at = now() WHERE dedupe_key LIKE $1 AND resolved_at IS NULL AND NOT (dedupe_key = ANY($2::text[]))`,
    [`${prefix}%`, keep],
  );
}

/** Low / critical / out-of-stock alerts per product. Pass productIds to refresh a subset. */
export async function refreshProductAlerts(branchId: number, productIds?: number[]) {
  const settings = await getSettings();
  const today = todayIn(settings.general.timezone);
  const params: unknown[] = [branchId, today, settings.inventory.criticalStockPercent];
  let filter = '';
  if (productIds?.length) { params.push(productIds); filter = 'AND p.id = ANY($4::int[])'; }
  const { rows } = await pool.query(
    `SELECT p.id, p.name, p.reorder_level, p.status, s.sellable,
            CASE WHEN s.sellable = 0 THEN 'out' WHEN s.sellable <= floor(p.reorder_level * $3::numeric / 100) THEN 'critical'
                 WHEN s.sellable <= p.reorder_level THEN 'low' ELSE 'ok' END AS level
       FROM products p
       LEFT JOIN LATERAL (
         SELECT COALESCE(sum(b.quantity_on_hand), 0)::int AS sellable FROM product_batches b
          WHERE b.product_id = p.id AND b.branch_id = $1 AND b.status = 'active' AND (b.expiry_date IS NULL OR b.expiry_date >= $2::date)
       ) s ON TRUE
      WHERE TRUE ${filter}`,
    params,
  );
  const toResolve: string[] = [];
  for (const p of rows) {
    const key = `stock:${branchId}:${p.id}`;
    if (!settings.notifications.lowStock || p.status !== 'active' || p.level === 'ok' || p.reorder_level === 0 && p.level !== 'out') {
      toResolve.push(key);
      continue;
    }
    const out = p.level === 'out';
    await raiseNotification({
      type: out ? 'out_of_stock' : 'low_stock',
      severity: out || p.level === 'critical' ? 'critical' : 'warning',
      title: out ? `${p.name} is out of stock` : `${p.name} is ${p.level === 'critical' ? 'critically low' : 'running low'}`,
      message: out
        ? `No sellable stock left (reorder level ${p.reorder_level}).`
        : `${p.sellable} left, reorder level is ${p.reorder_level}.`,
      link: `/inventory/products/${p.id}`,
      audiencePermission: 'inventory.view',
      dedupeKey: key,
    });
  }
  await resolveNotifications(toResolve);
}

/** Summaries of expired and soon-expiring stock (one notification per bucket). */
export async function refreshExpiryAlerts(branchId: number) {
  const settings = await getSettings();
  const cur = settings.general.currency;
  const today = todayIn(settings.general.timezone);
  const warnUntil = addDays(today, settings.inventory.expiryWarningDays);
  const soonUntil = addDays(today, 30);
  const { rows } = await pool.query(
    `SELECT
        count(*) FILTER (WHERE expiry_date < $2::date)::int AS expired_batches,
        COALESCE(sum(quantity_on_hand * unit_cost) FILTER (WHERE expiry_date < $2::date), 0) AS expired_value,
        count(*) FILTER (WHERE expiry_date BETWEEN $2::date AND $3::date)::int AS soon_batches,
        COALESCE(sum(quantity_on_hand * unit_cost) FILTER (WHERE expiry_date BETWEEN $2::date AND $3::date), 0) AS soon_value,
        count(*) FILTER (WHERE expiry_date > $3::date AND expiry_date <= $4::date)::int AS later_batches,
        COALESCE(sum(quantity_on_hand * unit_cost) FILTER (WHERE expiry_date > $3::date AND expiry_date <= $4::date), 0) AS later_value
       FROM product_batches WHERE branch_id = $1 AND quantity_on_hand > 0 AND status <> 'disposed'`,
    [branchId, today, soonUntil, warnUntil],
  );
  const r = rows[0];
  const base = `expiry:${branchId}:`;
  const keep: string[] = [];
  if (settings.notifications.expiry) {
    if (r.expired_batches > 0) {
      keep.push(`${base}expired`);
      await raiseNotification({
        type: 'expired', severity: 'critical', dedupeKey: `${base}expired`,
        title: `${r.expired_batches} expired batch${r.expired_batches === 1 ? '' : 'es'} on the shelf`,
        message: `Stock worth ${formatMoney(r.expired_value, cur)} has expired. It is blocked from sale; dispose of it and record the write-off.`,
        link: '/inventory/expiry?bucket=expired', audiencePermission: 'inventory.view',
      });
    }
    if (r.soon_batches > 0) {
      keep.push(`${base}d30`);
      await raiseNotification({
        type: 'expiring', severity: 'warning', dedupeKey: `${base}d30`,
        title: `${r.soon_batches} batch${r.soon_batches === 1 ? ' expires' : 'es expire'} within 30 days`,
        message: `${formatMoney(r.soon_value, cur)} of stock at risk. Sell first, return to supplier, or plan disposal.`,
        link: '/inventory/expiry?bucket=d30', audiencePermission: 'inventory.view',
      });
    }
    if (r.later_batches > 0) {
      keep.push(`${base}warn`);
      await raiseNotification({
        type: 'expiring', severity: 'info', dedupeKey: `${base}warn`,
        title: `${r.later_batches} batch${r.later_batches === 1 ? ' expires' : 'es expire'} within ${settings.inventory.expiryWarningDays} days`,
        message: `${formatMoney(r.later_value, cur)} of stock approaching expiry.`,
        link: '/inventory/expiry?bucket=all_risk', audiencePermission: 'inventory.view',
      });
    }
  }
  await resolveByPrefixExcept(base, keep);
}

/** Purchase orders waiting for approval too long, or overdue for delivery. */
export async function refreshPurchaseAlerts(branchId: number) {
  const settings = await getSettings();
  const today = todayIn(settings.general.timezone);
  const { rows } = await pool.query(
    `SELECT po.id, po.po_number, po.status, po.expected_date, po.submitted_at, s.name AS supplier_name
       FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
      WHERE po.branch_id = $1 AND (
        (po.status = 'pending' AND po.submitted_at < now() - make_interval(days => $2))
        OR (po.status IN ('ordered','partially_received') AND po.expected_date < $3::date))`,
    [branchId, settings.notifications.purchaseOrderPendingDays, today],
  );
  const keep: string[] = [];
  for (const po of rows) {
    const key = `po:${po.id}`;
    keep.push(key);
    const pending = po.status === 'pending';
    await raiseNotification({
      type: 'po_pending', severity: 'warning', dedupeKey: key,
      title: pending ? `${po.po_number} is waiting for approval` : `${po.po_number} delivery is overdue`,
      message: pending
        ? `Submitted to ${po.supplier_name} more than ${settings.notifications.purchaseOrderPendingDays} day(s) ago and not yet approved.`
        : `${po.supplier_name} was expected to deliver by ${po.expected_date}.`,
      link: `/purchasing/orders/${po.id}`,
      audiencePermission: pending ? 'purchasing.approve' : 'purchasing.view',
    });
  }
  await resolveByPrefixExcept('po:', keep);
}

/** Suppliers with unpaid deliveries past their payment terms. */
export async function refreshSupplierAlerts() {
  const settings = await getSettings();
  const cur = settings.general.currency;
  const today = todayIn(settings.general.timezone);
  const keep: string[] = [];
  if (settings.notifications.supplierOverdue) {
    const { rows } = await pool.query(
      `WITH r AS (
         SELECT g.supplier_id, g.due_date, g.total_cost,
                sum(g.total_cost) OVER (PARTITION BY g.supplier_id ORDER BY g.received_date, g.id) AS running
           FROM goods_receipts g),
       paid AS (SELECT supplier_id, sum(amount) AS total FROM supplier_payments GROUP BY supplier_id)
       SELECT s.id, s.name, sum(LEAST(r.total_cost, GREATEST(r.running - COALESCE(paid.total, 0), 0))) AS overdue
         FROM r JOIN suppliers s ON s.id = r.supplier_id LEFT JOIN paid ON paid.supplier_id = r.supplier_id
        WHERE r.due_date < $1::date
        GROUP BY s.id HAVING sum(LEAST(r.total_cost, GREATEST(r.running - COALESCE(paid.total, 0), 0))) > 0`,
      [today],
    );
    for (const s of rows) {
      const key = `supplier:${s.id}`;
      keep.push(key);
      await raiseNotification({
        type: 'supplier_overdue', severity: 'warning', dedupeKey: key,
        title: `Payment overdue to ${s.name}`,
        message: `${formatMoney(s.overdue, cur)} is past the agreed payment terms.`,
        link: `/purchasing/suppliers/${s.id}`, audiencePermission: 'suppliers.payments',
      });
    }
  }
  await resolveByPrefixExcept('supplier:', keep);
}

export async function runAllAlerts() {
  const { rows } = await pool.query('SELECT id FROM branches WHERE is_active');
  for (const b of rows) {
    await refreshProductAlerts(b.id);
    await refreshExpiryAlerts(b.id);
    await refreshPurchaseAlerts(b.id);
  }
  await refreshSupplierAlerts();
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------
const VISIBLE = `n.resolved_at IS NULL AND (n.user_id IS NULL OR n.user_id = $1)
  AND (n.audience_permission IS NULL OR n.audience_permission = ANY($2::text[]))`;

export async function listNotifications(actor: Actor, q: { unreadOnly?: boolean; limit: number; type?: string }) {
  const perms = [...actor.permissions];
  const params: unknown[] = [actor.userId, perms];
  let extra = '';
  if (q.unreadOnly) extra += ' AND r.notification_id IS NULL';
  if (q.type) { params.push(q.type); extra += ` AND n.type = $${params.length}`; }
  const { rows } = await pool.query(
    `SELECT n.id, n.type, n.severity, n.title, n.message, n.link, n.created_at, (r.notification_id IS NOT NULL) AS is_read
       FROM notifications n LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = $1
      WHERE ${VISIBLE} ${extra}
      ORDER BY (r.notification_id IS NULL) DESC,
               CASE n.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 WHEN 'info' THEN 2 ELSE 3 END, n.created_at DESC
      LIMIT ${q.limit}`,
    params,
  );
  const count = await pool.query(
    `SELECT count(*)::int AS unread FROM notifications n
       LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = $1
      WHERE ${VISIBLE} AND r.notification_id IS NULL`,
    [actor.userId, perms],
  );
  return { items: rows, unread: count.rows[0].unread };
}

export async function markRead(actor: Actor, ids: number[] | 'all') {
  if (ids === 'all') {
    await pool.query(
      `INSERT INTO notification_reads (notification_id, user_id)
       SELECT n.id, $1 FROM notifications n WHERE ${VISIBLE} ON CONFLICT DO NOTHING`,
      [actor.userId, [...actor.permissions]],
    );
    return;
  }
  await pool.query(
    `INSERT INTO notification_reads (notification_id, user_id) SELECT unnest($2::bigint[]), $1 ON CONFLICT DO NOTHING`,
    [actor.userId, ids],
  );
}
