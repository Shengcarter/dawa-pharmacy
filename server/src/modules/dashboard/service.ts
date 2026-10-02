import { addDays } from '@dawa/shared';
import { pool } from '../../db/pool';
import { can, type Actor } from '../../lib/actor';
import { businessToday } from '../../lib/today';
import { getSettings } from '../settings/service';

export type DashboardPeriod = 'today' | '7d' | '30d' | '3m' | '12m';

const PERIODS: Record<DashboardPeriod, { days: number; bucket: 'hour' | 'day' | 'week' | 'month' }> = {
  today: { days: 1, bucket: 'hour' },
  '7d': { days: 7, bucket: 'day' },
  '30d': { days: 30, bucket: 'day' },
  '3m': { days: 91, bucket: 'week' },
  '12m': { days: 365, bucket: 'month' },
};

/**
 * Everything on the dashboard comes from live transactions. Sections a user
 * is not permitted to see (profit, stock value, balances) are left out.
 */
export async function dashboard(actor: Actor, period: DashboardPeriod) {
  const settings = await getSettings();
  const tz = settings.general.timezone;
  const today = await businessToday();
  const yesterday = addDays(today, -1);
  const ownOnly = !can(actor, 'sales.view_all');
  const salesScope = ownOnly ? 'AND s.cashier_id = $4' : '';
  const base = [actor.branchId, tz, today];
  const scoped = ownOnly ? [...base, actor.userId] : base;

  const day = await pool.query(
    `SELECT (s.created_at AT TIME ZONE $2)::date AS day, count(*)::int AS transactions, COALESCE(sum(s.total), 0) AS total,
            COALESCE(sum(si.net), 0) AS net, COALESCE(sum(s.cost_total), 0) AS cost
       FROM sales s
       LEFT JOIN LATERAL (SELECT sum(net_amount) AS net FROM sale_items WHERE sale_id = s.id) si ON TRUE
      WHERE s.branch_id = $1 AND (s.created_at AT TIME ZONE $2)::date BETWEEN $3::date - 1 AND $3::date
        -- Yesterday is counted only up to this time of day, so the comparison is like for like.
        AND ((s.created_at AT TIME ZONE $2)::date = $3::date OR s.created_at <= now() - interval '1 day') ${salesScope}
      GROUP BY 1`,
    scoped,
  );
  const byDay = new Map(day.rows.map((r) => [r.day, r]));
  const t = byDay.get(today) ?? { transactions: 0, total: 0, net: 0, cost: 0 };
  const y = byDay.get(yesterday) ?? { transactions: 0, total: 0, net: 0, cost: 0 };
  const returnsToday = await pool.query(
    `SELECT COALESCE(sum(net_amount), 0) AS net, COALESCE(sum(cost_restocked), 0) AS cost FROM sale_returns
      WHERE branch_id = $1 AND (created_at AT TIME ZONE $2)::date = $3::date`,
    base,
  );

  const kpis: Record<string, unknown> = {
    todaySales: { value: Number(t.total), previous: Number(y.total) },
    todayTransactions: { value: t.transactions, previous: y.transactions },
  };
  if (can(actor, 'reports.financial')) {
    const r = returnsToday.rows[0];
    const yReturns = await pool.query(
      `SELECT COALESCE(sum(net_amount), 0) AS net, COALESCE(sum(cost_restocked), 0) AS cost FROM sale_returns
        WHERE branch_id = $1 AND (created_at AT TIME ZONE $2)::date = $3::date - 1 AND created_at <= now() - interval '1 day'`,
      base,
    );
    const yr = yReturns.rows[0];
    kpis.todayGrossProfit = {
      value: Number(t.net) - Number(r.net) - (Number(t.cost) - Number(r.cost)),
      previous: Number(y.net) - Number(yr.net) - (Number(y.cost) - Number(yr.cost)),
    };
  }
  if (can(actor, 'inventory.view')) {
    const stock = await pool.query(
      `SELECT COALESCE(sum(quantity_on_hand * unit_cost) FILTER (WHERE expiry_date IS NULL OR expiry_date >= $2::date), 0) AS value,
              COALESCE(sum(quantity_on_hand * unit_cost) FILTER (WHERE expiry_date < $2::date), 0) AS expired_value,
              count(*) FILTER (WHERE expiry_date BETWEEN $2::date AND $3::date)::int AS expiring_batches,
              COALESCE(sum(quantity_on_hand * unit_cost) FILTER (WHERE expiry_date BETWEEN $2::date AND $3::date), 0) AS expiring_value,
              count(*) FILTER (WHERE expiry_date < $2::date)::int AS expired_batches
         FROM product_batches WHERE branch_id = $1 AND quantity_on_hand > 0 AND status <> 'disposed'`,
      [actor.branchId, today, addDays(today, settings.inventory.expiryWarningDays)],
    );
    const levels = await pool.query(
      `SELECT count(*) FILTER (WHERE s.sellable = 0)::int AS out_of_stock,
              count(*) FILTER (WHERE s.sellable > 0 AND s.sellable <= p.reorder_level)::int AS low_stock,
              count(*) FILTER (WHERE s.sellable > 0 AND s.sellable <= floor(p.reorder_level * $3::numeric / 100))::int AS critical
         FROM products p
         LEFT JOIN LATERAL (
           SELECT COALESCE(sum(b.quantity_on_hand), 0)::int AS sellable FROM product_batches b
            WHERE b.product_id = p.id AND b.branch_id = $1 AND b.status = 'active' AND (b.expiry_date IS NULL OR b.expiry_date >= $2::date)
         ) s ON TRUE
        WHERE p.status = 'active' AND EXISTS (SELECT 1 FROM product_batches x WHERE x.product_id = p.id AND x.branch_id = $1)`,
      [actor.branchId, today, settings.inventory.criticalStockPercent],
    );
    const st = stock.rows[0];
    const lv = levels.rows[0];
    kpis.stockValue = { value: Number(st.value), expiredValue: Number(st.expired_value) };
    kpis.lowStock = { value: lv.low_stock + lv.out_of_stock, critical: lv.critical, outOfStock: lv.out_of_stock };
    kpis.expiringSoon = {
      value: st.expiring_batches, valueAtRisk: Number(st.expiring_value), expired: st.expired_batches,
      windowDays: settings.inventory.expiryWarningDays,
    };
  }
  if (can(actor, 'suppliers.view') || can(actor, 'reports.financial')) {
    // Suppliers are company-wide: balances cover deliveries to every branch.
    const sup = await pool.query(
      `SELECT COALESCE((SELECT sum(total_cost) FROM goods_receipts), 0)
            - COALESCE((SELECT sum(sp.amount) FROM supplier_payments sp), 0) AS outstanding,
              (WITH r AS (
                 SELECT g.supplier_id, g.due_date, g.total_cost,
                        sum(g.total_cost) OVER (PARTITION BY g.supplier_id ORDER BY g.received_date, g.id) AS running
                   FROM goods_receipts g),
               paid AS (SELECT supplier_id, sum(amount) AS total FROM supplier_payments GROUP BY supplier_id)
               SELECT count(DISTINCT r.supplier_id)::int FROM r LEFT JOIN paid ON paid.supplier_id = r.supplier_id
                WHERE r.due_date < $1::date AND r.running - COALESCE(paid.total, 0) > 0) AS overdue_suppliers`,
      [today],
    );
    kpis.supplierBalances = { value: Number(sup.rows[0].outstanding), overdueSuppliers: sup.rows[0].overdue_suppliers };
  }
  if (can(actor, 'sales.record_payment') || can(actor, 'reports.financial')) {
    const cust = await pool.query(
      `SELECT COALESCE(sum(balance_due), 0) AS outstanding, count(DISTINCT customer_id)::int AS customers
         FROM sales WHERE branch_id = $1 AND balance_due > 0`,
      [actor.branchId],
    );
    kpis.customerBalances = { value: Number(cust.rows[0].outstanding), customers: cust.rows[0].customers };
  }

  const chart = await salesSeries(actor, period, tz, today, ownOnly);

  const showProfit = can(actor, 'reports.financial');
  const top = await pool.query(
    `SELECT p.id, p.name, p.strength, sum(si.quantity - si.quantity_returned)::int AS quantity, sum(si.net_amount) AS revenue,
            sum(si.net_amount) - sum(si.quantity * si.unit_cost) AS profit
       FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id
      WHERE s.branch_id = $1 AND (s.created_at AT TIME ZONE $2)::date > $3::date - $4::int ${ownOnly ? 'AND s.cashier_id = $5' : ''}
      GROUP BY p.id ORDER BY revenue DESC LIMIT 6`,
    ownOnly ? [actor.branchId, tz, today, PERIODS[period].days, actor.userId] : [actor.branchId, tz, today, PERIODS[period].days],
  );

  let lowStock: unknown[] = [];
  let expiring: unknown[] = [];
  if (can(actor, 'inventory.view')) {
    lowStock = (await pool.query(
      `SELECT p.id, p.name, p.strength, p.reorder_level, s.sellable,
              CASE WHEN s.sellable = 0 THEN 'out_of_stock' WHEN s.sellable <= floor(p.reorder_level * $3::numeric / 100) THEN 'critical'
                   ELSE 'low_stock' END AS stock_status
         FROM products p
         LEFT JOIN LATERAL (
           SELECT COALESCE(sum(b.quantity_on_hand), 0)::int AS sellable FROM product_batches b
            WHERE b.product_id = p.id AND b.branch_id = $1 AND b.status = 'active' AND (b.expiry_date IS NULL OR b.expiry_date >= $2::date)
         ) s ON TRUE
        WHERE p.status = 'active' AND s.sellable <= p.reorder_level AND p.reorder_level > 0
          AND EXISTS (SELECT 1 FROM product_batches x WHERE x.product_id = p.id AND x.branch_id = $1)
        ORDER BY (s.sellable::float / NULLIF(p.reorder_level, 0)) ASC, p.name LIMIT 7`,
      [actor.branchId, today, settings.inventory.criticalStockPercent],
    )).rows;
    expiring = (await pool.query(
      `SELECT b.id, p.id AS product_id, p.name, b.batch_number, b.expiry_date, b.quantity_on_hand, (b.expiry_date - $2::date) AS days_to_expiry,
              (b.quantity_on_hand * b.unit_cost)::numeric(14,2) AS value
         FROM product_batches b JOIN products p ON p.id = b.product_id
        WHERE b.branch_id = $1 AND b.quantity_on_hand > 0 AND b.status <> 'disposed' AND b.expiry_date <= $3::date
        ORDER BY b.expiry_date, p.name LIMIT 7`,
      [actor.branchId, today, addDays(today, settings.inventory.expiryWarningDays)],
    )).rows;
  }

  const recent = await pool.query(
    `SELECT s.id, s.invoice_no, s.created_at, s.total, s.payment_type, s.payment_status, s.status,
            c.full_name AS customer_name, u.full_name AS cashier_name
       FROM sales s LEFT JOIN customers c ON c.id = s.customer_id JOIN users u ON u.id = s.cashier_id
      WHERE s.branch_id = $1 ${ownOnly ? 'AND s.cashier_id = $2' : ''}
      ORDER BY s.created_at DESC LIMIT 8`,
    ownOnly ? [actor.branchId, actor.userId] : [actor.branchId],
  );

  return {
    today,
    scope: ownOnly ? 'own' : 'all',
    kpis,
    chart,
    topProducts: top.rows.map((r) => (showProfit ? r : { ...r, profit: undefined })),
    lowStock,
    expiring,
    recentTransactions: recent.rows,
  };
}

async function salesSeries(actor: Actor, period: DashboardPeriod, tz: string, today: string, ownOnly: boolean) {
  const { days, bucket } = PERIODS[period];
  const start = addDays(today, -(days - 1));
  const prevStart = addDays(start, -days);
  const params: unknown[] = [actor.branchId, tz, start, today];
  const own = ownOnly ? `AND s.cashier_id = $${params.push(actor.userId)}` : '';
  const local = `(s.created_at AT TIME ZONE $2)`;
  const bucketExpr = bucket === 'hour' ? `date_trunc('hour', ${local})` : `date_trunc('${bucket}', ${local}::date)`;
  const series = bucket === 'hour'
    ? `generate_series($3::date::timestamp, $3::date::timestamp + interval '23 hours', interval '1 hour')`
    : `generate_series(date_trunc('${bucket}', $3::date), date_trunc('${bucket}', $4::date), interval '1 ${bucket}')`;
  const { rows } = await pool.query(
    `WITH buckets AS (SELECT b AS bucket FROM ${series} AS b),
     agg AS (
       SELECT ${bucketExpr} AS bucket, sum(s.total) AS total, count(*)::int AS transactions
         FROM sales s WHERE s.branch_id = $1 AND ${local}::date BETWEEN $3::date AND $4::date ${own} GROUP BY 1)
     SELECT to_char(buckets.bucket, 'YYYY-MM-DD"T"HH24:MI') AS bucket, COALESCE(agg.total, 0) AS total, COALESCE(agg.transactions, 0) AS transactions
       FROM buckets LEFT JOIN agg ON agg.bucket = buckets.bucket ORDER BY buckets.bucket`,
    params,
  );
  const prevParams: unknown[] = [actor.branchId, tz, start, prevStart];
  if (ownOnly) prevParams.push(actor.userId);
  const prev = await pool.query(
    `SELECT COALESCE(sum(s.total), 0) AS total, count(*)::int AS transactions FROM sales s
      WHERE s.branch_id = $1 AND ${local}::date >= $4::date AND ${local}::date < $3::date ${ownOnly ? 'AND s.cashier_id = $5' : ''}`,
    prevParams,
  );
  const total = rows.reduce((a, r) => a + Number(r.total), 0);
  return {
    period,
    bucket,
    points: rows.map((r) => ({ bucket: r.bucket, total: Number(r.total), transactions: r.transactions })),
    total,
    transactions: rows.reduce((a, r) => a + r.transactions, 0),
    previousTotal: Number(prev.rows[0].total),
  };
}
