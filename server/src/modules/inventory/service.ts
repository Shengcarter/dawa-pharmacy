import { ADJUSTMENT_TYPES, addDays, formatMoney, type AdjustmentType } from '@dawa/shared';
import { pool, withTransaction } from '../../db/pool';
import type { Actor } from '../../lib/actor';
import { audit } from '../../lib/audit';
import { notFound, unprocessable } from '../../lib/errors';
import { likeParam, orderBy, pageParams, paginated } from '../../lib/pagination';
import { nextDocumentNumber } from '../../lib/sequences';
import { applyMovement } from '../../lib/stock';
import { businessToday } from '../../lib/today';
import { occurredAt } from '../../lib/actor';
import { getSettings } from '../settings/service';

interface BatchQuery {
  page: number;
  pageSize: number;
  search?: string;
  sort?: string;
  order?: 'asc' | 'desc';
  categoryId?: number;
  supplierId?: number;
  productId?: number;
  status?: string;
  /** expired | d30 | d60 | d90 | safe | all_risk */
  expiry?: string;
  stockStatus?: string;
  includeEmpty?: boolean;
}

const BATCH_SORTS: Record<string, string> = {
  product: 'p.name',
  sku: 'p.sku',
  batch: 'b.batch_number',
  expiry: 'b.expiry_date',
  quantity: 'b.quantity_on_hand',
  value: '(b.quantity_on_hand * b.unit_cost)',
  category: 'c.name',
};

/**
 * Batch-level inventory: the professional stock table (one row per batch),
 * used by Stock Levels, Batch Management and Expiry Tracking.
 */
export async function listBatches(actor: Actor, q: BatchQuery) {
  const settings = await getSettings();
  const today = await businessToday();
  const params: unknown[] = [actor.branchId, today, settings.inventory.criticalStockPercent];
  const where: string[] = ['b.branch_id = $1'];
  const add = (sql: string, ...values: unknown[]) => {
    let out = sql;
    for (const v of values) {
      params.push(v);
      out = out.replace('$?', `$${params.length}`);
    }
    where.push(out);
  };
  if (!q.includeEmpty) where.push('b.quantity_on_hand > 0');
  if (q.search) {
    params.push(likeParam(q.search));
    const n = params.length;
    where.push(`(p.name ILIKE $${n} OR p.generic_name ILIKE $${n} OR p.sku ILIKE $${n} OR b.batch_number ILIKE $${n} OR p.barcode = $${n + 1})`);
    params.push(q.search);
  }
  if (q.categoryId) add('p.category_id = $?', q.categoryId);
  if (q.supplierId) add('b.supplier_id = $?', q.supplierId);
  if (q.productId) add('b.product_id = $?', q.productId);
  if (q.status) add('b.status = $?', q.status);
  const window = (days: number) => addDays(today, days);
  switch (q.expiry) {
    case 'expired': where.push('b.expiry_date < $2::date'); break;
    case 'd30': add('b.expiry_date BETWEEN $2::date AND $?::date', window(30)); break;
    case 'd60': add('b.expiry_date BETWEEN $2::date AND $?::date', window(60)); break;
    case 'd90': add('b.expiry_date BETWEEN $2::date AND $?::date', window(90)); break;
    case 'safe': add('(b.expiry_date IS NULL OR b.expiry_date > $?::date)', window(90)); break;
    case 'all_risk': add('b.expiry_date <= $?::date', window(90)); break;
    default: break;
  }
  const productStatus = `CASE
      WHEN b.expiry_date < $2::date THEN 'expired'
      WHEN ps.sellable = 0 THEN 'out_of_stock'
      WHEN ps.sellable <= floor(p.reorder_level * $3::numeric / 100) THEN 'critical'
      WHEN ps.sellable <= p.reorder_level THEN 'low_stock'
      ELSE 'in_stock' END`;
  if (q.stockStatus) add(`(${productStatus}) = $?`, q.stockStatus);
  const { limit, offset } = pageParams(q.page, q.pageSize);
  const { rows } = await pool.query(
    `SELECT b.id, b.batch_number, b.manufacture_date, b.expiry_date, b.quantity_received, b.quantity_on_hand, b.unit_cost,
            p.selling_price, b.status, b.received_at,
            (b.quantity_on_hand * b.unit_cost)::numeric(14,2) AS stock_value,
            (b.expiry_date - $2::date) AS days_to_expiry,
            p.id AS product_id, p.sku, p.name AS product_name, p.strength, p.unit, p.reorder_level,
            c.name AS category_name, sup.name AS supplier_name, ps.sellable AS product_sellable,
            ${productStatus} AS stock_status,
            count(*) OVER() AS total_count,
            sum(b.quantity_on_hand * b.unit_cost) OVER() AS total_value,
            sum(b.quantity_on_hand) OVER() AS total_units
       FROM product_batches b
       JOIN products p ON p.id = b.product_id
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN suppliers sup ON sup.id = b.supplier_id
       LEFT JOIN LATERAL (
         SELECT COALESCE(sum(x.quantity_on_hand), 0)::int AS sellable FROM product_batches x
          WHERE x.product_id = p.id AND x.branch_id = $1 AND x.status = 'active' AND (x.expiry_date IS NULL OR x.expiry_date >= $2::date)
       ) ps ON TRUE
      WHERE ${where.join(' AND ')}
      ORDER BY ${orderBy(BATCH_SORTS, q.sort, q.order, 'b.expiry_date ASC NULLS LAST')}, b.id
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  const totals = { value: Number(rows[0]?.total_value ?? 0), units: Number(rows[0]?.total_units ?? 0) };
  return {
    ...paginated(rows.map(({ total_count: _c, total_value: _v, total_units: _u, ...r }) => r), rows[0]?.total_count ?? 0, q.page, q.pageSize),
    totals,
  };
}

/** Counts and value at risk per expiry bucket, for the expiry page header. */
export async function expirySummary(actor: Actor) {
  const today = await businessToday();
  const { rows } = await pool.query(
    `SELECT bucket, count(*)::int AS batches, COALESCE(sum(quantity_on_hand), 0)::int AS units,
            COALESCE(sum(quantity_on_hand * unit_cost), 0)::numeric(14,2) AS value
       FROM (
         SELECT b.quantity_on_hand, b.unit_cost,
                CASE WHEN b.expiry_date IS NULL THEN 'safe'
                     WHEN b.expiry_date < $2::date THEN 'expired'
                     WHEN b.expiry_date <= $2::date + 30 THEN 'd30'
                     WHEN b.expiry_date <= $2::date + 60 THEN 'd60'
                     WHEN b.expiry_date <= $2::date + 90 THEN 'd90'
                     ELSE 'safe' END AS bucket
           FROM product_batches b WHERE b.branch_id = $1 AND b.quantity_on_hand > 0 AND b.status <> 'disposed'
       ) t GROUP BY bucket`,
    [actor.branchId, today],
  );
  const empty = { batches: 0, units: 0, value: 0 };
  const by = Object.fromEntries(rows.map((r) => [r.bucket, { batches: r.batches, units: r.units, value: r.value }]));
  return {
    today,
    expired: by.expired ?? empty,
    d30: by.d30 ?? empty,
    d60: by.d60 ?? empty,
    d90: by.d90 ?? empty,
    safe: by.safe ?? empty,
  };
}

export async function getBatch(actor: Actor, id: number) {
  const today = await businessToday();
  const { rows } = await pool.query(
    `SELECT b.*, p.name AS product_name, p.sku, p.unit, p.selling_price AS product_selling_price, sup.name AS supplier_name,
            (b.expiry_date - $3::date) AS days_to_expiry
       FROM product_batches b JOIN products p ON p.id = b.product_id LEFT JOIN suppliers sup ON sup.id = b.supplier_id
      WHERE b.id = $1 AND b.branch_id = $2`,
    [id, actor.branchId, today],
  );
  if (!rows[0]) throw notFound('Batch');
  const movements = await pool.query(
    `SELECT m.id, m.movement_type, m.quantity, m.quantity_before, m.quantity_after, m.reason, m.reference_type, m.reference_id,
            m.reference_no, m.created_at, u.full_name AS user_name
       FROM inventory_movements m LEFT JOIN users u ON u.id = m.user_id
      WHERE m.batch_id = $1 ORDER BY m.created_at DESC, m.id DESC LIMIT 100`,
    [id],
  );
  return { ...rows[0], movements: movements.rows };
}

export async function updateBatch(
  actor: Actor,
  id: number,
  d: { expiryDate: string | null; manufactureDate: string | null; status: 'active' | 'quarantined'; reason: string },
) {
  return withTransaction(async (tx) => {
    const { rows } = await tx.query(
      `SELECT b.*, p.name AS product_name, p.is_batch_tracked FROM product_batches b JOIN products p ON p.id = b.product_id
        WHERE b.id = $1 AND b.branch_id = $2 FOR UPDATE OF b`,
      [id, actor.branchId],
    );
    const before = rows[0];
    if (!before) throw notFound('Batch');
    if (before.status === 'disposed') throw unprocessable('Disposed batches cannot be edited.');
    if (before.is_batch_tracked && !d.expiryDate) throw unprocessable('Expiry date is required for batch-tracked products.');
    if (d.manufactureDate && d.expiryDate && d.manufactureDate >= d.expiryDate) throw unprocessable('Expiry must be after the manufacturing date.');
    await tx.query(
      `UPDATE product_batches SET expiry_date=$2, manufacture_date=$3, status=$4, updated_at=now() WHERE id=$1`,
      [id, d.expiryDate, d.manufactureDate, d.status],
    );
    const changes: string[] = [];
    if (before.expiry_date !== d.expiryDate) changes.push(`expiry ${before.expiry_date ?? 'none'} → ${d.expiryDate ?? 'none'}`);
    if (before.status !== d.status) changes.push(`status ${before.status} → ${d.status}`);
    await audit(tx, actor, {
      action: 'update', module: 'inventory', entityType: 'batch', entityId: id,
      summary: `${actor.userName} updated batch ${before.batch_number} of ${before.product_name}${changes.length ? `: ${changes.join('; ')}` : ''}. Reason: ${d.reason}`,
      oldValues: { expiryDate: before.expiry_date, status: before.status },
      newValues: { expiryDate: d.expiryDate, status: d.status },
    });
    return { id };
  });
}

/**
 * Records a stock adjustment against one batch. "correction" sets the counted
 * quantity; the other types add or remove the given quantity.
 */
export async function adjustStock(actor: Actor, d: { batchId: number; type: AdjustmentType; quantity: number; reason: string }) {
  const settings = await getSettings();
  const today = await businessToday(actor);
  return withTransaction(async (tx) => {
    const { rows } = await tx.query(
      `SELECT b.id, b.batch_number, b.quantity_on_hand, b.unit_cost, b.expiry_date, b.status, p.id AS product_id, p.name
         FROM product_batches b JOIN products p ON p.id = b.product_id WHERE b.id = $1 AND b.branch_id = $2 FOR UPDATE OF b`,
      [d.batchId, actor.branchId],
    );
    const batch = rows[0];
    if (!batch) throw notFound('Batch');
    if (batch.status === 'disposed') throw unprocessable('This batch has been disposed.');
    let delta: number;
    switch (d.type) {
      case 'adjustment_in': delta = d.quantity; break;
      case 'correction': delta = d.quantity - batch.quantity_on_hand; break;
      case 'expired':
        if (!batch.expiry_date || batch.expiry_date >= today) {
          throw unprocessable(`Batch ${batch.batch_number} has not expired. Use "Damaged" or "Stock lost" instead.`);
        }
        delta = -d.quantity;
        break;
      default: delta = -d.quantity;
    }
    if (delta === 0) throw unprocessable('The counted quantity matches the system quantity; nothing to adjust.');
    if (batch.quantity_on_hand + delta < 0) {
      throw unprocessable(`Batch ${batch.batch_number} has only ${batch.quantity_on_hand} unit(s).`);
    }
    const at = occurredAt(actor);
    const adjustmentNo = await nextDocumentNumber(tx, 'ADJ', at);
    const after = batch.quantity_on_hand + delta;
    const ins = await tx.query(
      `INSERT INTO stock_adjustments (adjustment_no, branch_id, batch_id, product_id, adjustment_type, quantity_before, quantity_after,
                                      unit_cost, reason, user_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [adjustmentNo, actor.branchId, batch.id, batch.product_id, d.type, batch.quantity_on_hand, after, batch.unit_cost, d.reason, actor.userId, at],
    );
    await applyMovement(tx, actor, {
      batchId: batch.id,
      quantity: delta,
      type: d.type,
      reason: d.reason,
      referenceType: 'adjustment',
      referenceId: ins.rows[0].id,
      referenceNo: adjustmentNo,
    });
    if (after === 0 && d.type === 'expired') {
      await tx.query(`UPDATE product_batches SET status = 'disposed', updated_at = now() WHERE id = $1`, [batch.id]);
    }
    const value = Math.abs(delta) * Number(batch.unit_cost);
    await audit(tx, actor, {
      action: 'stock_adjustment', module: 'inventory', entityType: 'batch', entityId: batch.id,
      summary: `${actor.userName} adjusted stock of ${batch.name} (batch ${batch.batch_number}) from ${batch.quantity_on_hand} to ${after} — ${ADJUSTMENT_TYPES[d.type]}: ${d.reason} (value ${formatMoney(value, settings.general.currency)})`,
      oldValues: { quantity: batch.quantity_on_hand },
      newValues: { quantity: after, type: d.type, adjustmentNo },
    });
    return { id: ins.rows[0].id, adjustmentNo, quantityBefore: batch.quantity_on_hand, quantityAfter: after };
  });
}

export async function listAdjustments(actor: Actor, q: { page: number; pageSize: number; search?: string; type?: string; from?: string | null; to?: string | null }) {
  const params: unknown[] = [actor.branchId];
  const where = ['a.branch_id = $1'];
  if (q.search) {
    params.push(likeParam(q.search));
    where.push(`(p.name ILIKE $${params.length} OR b.batch_number ILIKE $${params.length} OR a.adjustment_no ILIKE $${params.length} OR a.reason ILIKE $${params.length})`);
  }
  if (q.type) { params.push(q.type); where.push(`a.adjustment_type = $${params.length}`); }
  if (q.from) { params.push(q.from); where.push(`a.created_at >= $${params.length}::date`); }
  if (q.to) { params.push(q.to); where.push(`a.created_at < $${params.length}::date + 1`); }
  const { limit, offset } = pageParams(q.page, q.pageSize);
  const { rows } = await pool.query(
    `SELECT a.id, a.adjustment_no, a.adjustment_type, a.quantity_before, a.quantity_after, (a.quantity_after - a.quantity_before) AS change,
            a.unit_cost, ((a.quantity_after - a.quantity_before) * a.unit_cost)::numeric(14,2) AS value_change, a.reason, a.created_at,
            p.id AS product_id, p.name AS product_name, p.sku, b.batch_number, u.full_name AS user_name, count(*) OVER() AS total_count
       FROM stock_adjustments a JOIN products p ON p.id = a.product_id JOIN product_batches b ON b.id = a.batch_id
       JOIN users u ON u.id = a.user_id
      WHERE ${where.join(' AND ')} ORDER BY a.created_at DESC, a.id DESC LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  return paginated(rows.map(({ total_count: _t, ...r }) => r), rows[0]?.total_count ?? 0, q.page, q.pageSize);
}

export async function listMovements(
  actor: Actor,
  q: { page: number; pageSize: number; search?: string; type?: string; productId?: number; batchId?: number; userId?: number; from?: string | null; to?: string | null },
) {
  const params: unknown[] = [actor.branchId];
  const where = ['m.branch_id = $1'];
  const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replace('$?', `$${params.length}`)); };
  if (q.search) {
    params.push(likeParam(q.search));
    const n = params.length;
    where.push(`(p.name ILIKE $${n} OR p.sku ILIKE $${n} OR b.batch_number ILIKE $${n} OR m.reference_no ILIKE $${n})`);
  }
  if (q.type) add('m.movement_type = $?', q.type);
  if (q.productId) add('m.product_id = $?', q.productId);
  if (q.batchId) add('m.batch_id = $?', q.batchId);
  if (q.userId) add('m.user_id = $?', q.userId);
  if (q.from) add('m.created_at >= $?::date', q.from);
  if (q.to) add('m.created_at < $?::date + 1', q.to);
  const { limit, offset } = pageParams(q.page, q.pageSize);
  const { rows } = await pool.query(
    `SELECT m.id, m.movement_type, m.quantity, m.quantity_before, m.quantity_after, m.unit_cost, m.reason,
            m.reference_type, m.reference_id, m.reference_no, m.created_at,
            p.id AS product_id, p.name AS product_name, p.sku, b.id AS batch_id, b.batch_number, u.full_name AS user_name,
            count(*) OVER() AS total_count
       FROM inventory_movements m JOIN products p ON p.id = m.product_id JOIN product_batches b ON b.id = m.batch_id
       LEFT JOIN users u ON u.id = m.user_id
      WHERE ${where.join(' AND ')} ORDER BY m.created_at DESC, m.id DESC LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  return paginated(rows.map(({ total_count: _t, ...r }) => r), rows[0]?.total_count ?? 0, q.page, q.pageSize);
}
