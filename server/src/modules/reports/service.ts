import { addDays, fromCents, toCents } from '@dawa/shared';
import { pool } from '../../db/pool';
import type { Actor } from '../../lib/actor';
import { businessToday } from '../../lib/today';
import { getSettings } from '../settings/service';

export interface ReportFilters {
  from: string;
  to: string;
  productId?: number;
  categoryId?: number;
  staffId?: number;
  supplierId?: number;
}

/** Defaults to the current month when no range is given. */
export async function resolveRange(from?: string | null, to?: string | null) {
  const today = await businessToday();
  return { from: from ?? `${today.slice(0, 8)}01`, to: to ?? today };
}

async function tz() {
  return (await getSettings()).general.timezone;
}

/** SQL fragment: a timestamp column's local business date. */
const localDate = (col: string) => `(${col} AT TIME ZONE $2)::date`;

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------
export async function salesReport(actor: Actor, f: ReportFilters) {
  const params: unknown[] = [actor.branchId, await tz(), f.from, f.to];
  const where = [`s.branch_id = $1`, `${localDate('s.created_at')} BETWEEN $3::date AND $4::date`];
  if (f.staffId) { params.push(f.staffId); where.push(`s.cashier_id = $${params.length}`); }
  if (f.productId || f.categoryId) {
    const cond: string[] = [];
    if (f.productId) { params.push(f.productId); cond.push(`si.product_id = $${params.length}`); }
    if (f.categoryId) { params.push(f.categoryId); cond.push(`p.category_id = $${params.length}`); }
    where.push(`EXISTS (SELECT 1 FROM sale_items si JOIN products p ON p.id = si.product_id WHERE si.sale_id = s.id AND ${cond.join(' AND ')})`);
  }
  const { rows } = await pool.query(
    `SELECT s.id, s.invoice_no, s.created_at, c.full_name AS customer_name, u.full_name AS staff_name,
            s.subtotal, s.discount_total, s.tax_total, s.total, s.payment_type, s.status,
            (SELECT string_agg(DISTINCT p.name, ', ') FROM sale_items si JOIN products p ON p.id = si.product_id WHERE si.sale_id = s.id) AS products,
            (SELECT sum(net_amount) FROM sale_items si WHERE si.sale_id = s.id) AS revenue
       FROM sales s LEFT JOIN customers c ON c.id = s.customer_id JOIN users u ON u.id = s.cashier_id
      WHERE ${where.join(' AND ')} ORDER BY s.created_at DESC LIMIT 5000`,
    params,
  );
  const daily = await pool.query(
    `SELECT ${localDate('s.created_at')} AS day, count(*)::int AS transactions, sum(s.total) AS total
       FROM sales s WHERE ${where.join(' AND ')} GROUP BY 1 ORDER BY 1`,
    params,
  );
  const byPayment = await pool.query(
    `SELECT p.method, sum(p.amount) AS amount, count(*)::int AS count
       FROM payments p JOIN sales s ON s.id = p.sale_id WHERE ${where.join(' AND ')} GROUP BY p.method ORDER BY amount DESC`,
    params,
  );
  const sum = (k: string) => fromCents(rows.reduce((a, r) => a + toCents(r[k]), 0));
  return {
    range: f,
    summary: {
      transactions: rows.length,
      subtotal: sum('subtotal'),
      discount: sum('discount_total'),
      tax: sum('tax_total'),
      total: sum('total'),
      revenue: sum('revenue'),
      averageSale: rows.length ? fromCents(Math.round(toCents(sum('total')) / rows.length)) : 0,
    },
    daily: daily.rows,
    byPayment: byPayment.rows,
    rows,
  };
}

/** Product performance: units, revenue, cost and gross profit per product in the range. */
export async function productSales(actor: Actor, f: ReportFilters, limit = 500) {
  const params: unknown[] = [actor.branchId, await tz(), f.from, f.to];
  const where = [`s.branch_id = $1`, `${localDate('s.created_at')} BETWEEN $3::date AND $4::date`];
  if (f.staffId) { params.push(f.staffId); where.push(`s.cashier_id = $${params.length}`); }
  if (f.categoryId) { params.push(f.categoryId); where.push(`p.category_id = $${params.length}`); }
  if (f.productId) { params.push(f.productId); where.push(`p.id = $${params.length}`); }
  const { rows } = await pool.query(
    `SELECT p.id, p.sku, p.name, c.name AS category_name,
            sum(si.quantity)::int AS quantity, sum(si.net_amount) AS revenue, sum(si.quantity * si.unit_cost) AS cost,
            sum(si.net_amount) - sum(si.quantity * si.unit_cost) AS gross_profit
       FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id
       LEFT JOIN categories c ON c.id = p.category_id
      WHERE ${where.join(' AND ')}
      GROUP BY p.id, c.name ORDER BY revenue DESC LIMIT ${limit}`,
    params,
  );
  return rows.map((r) => ({ ...r, margin: Number(r.revenue) > 0 ? Number(r.gross_profit) / Number(r.revenue) : 0 }));
}

// ---------------------------------------------------------------------------
// Profit & loss
// ---------------------------------------------------------------------------
/**
 * Profit from actual transactions:
 *   Net revenue   = sales (ex tax, after discounts) − customer returns (ex tax)
 *   COGS          = batch cost of units sold − cost of units returned to stock
 *   Gross profit  = net revenue − COGS
 *   Stock losses  = cost of damaged/expired/missing stock net of stock found
 *   Net profit    = gross profit − stock losses − operating expenses
 */
export async function profitAndLoss(actor: Actor, f: { from: string; to: string }) {
  const timezone = await tz();
  const p = [actor.branchId, timezone, f.from, f.to];
  const [sales, returns, losses, expenses, monthly] = await Promise.all([
    pool.query(
      `SELECT COALESCE(sum(si.net_amount), 0) AS revenue, COALESCE(sum(si.tax_amount), 0) AS tax,
              COALESCE(sum(si.discount_amount), 0) AS discounts, COALESCE(sum(si.quantity * si.unit_cost), 0) AS cogs,
              count(DISTINCT s.id)::int AS transactions
         FROM sales s JOIN sale_items si ON si.sale_id = s.id
        WHERE s.branch_id = $1 AND ${localDate('s.created_at')} BETWEEN $3::date AND $4::date`,
      p,
    ),
    pool.query(
      `SELECT COALESCE(sum(net_amount), 0) AS revenue, COALESCE(sum(tax_amount), 0) AS tax, COALESCE(sum(cost_restocked), 0) AS cost_restocked,
              count(*)::int AS count
         FROM sale_returns r WHERE r.branch_id = $1 AND ${localDate('r.created_at')} BETWEEN $3::date AND $4::date`,
      p,
    ),
    pool.query(
      `SELECT movement_type, COALESCE(-sum(quantity * unit_cost), 0) AS value
         FROM inventory_movements m
        WHERE m.branch_id = $1 AND m.movement_type IN ('adjustment_in','adjustment_out','damaged','expired','correction')
          AND ${localDate('m.created_at')} BETWEEN $3::date AND $4::date
        GROUP BY movement_type`,
      p,
    ),
    pool.query(
      `SELECT ec.name AS category, sum(e.amount) AS amount
         FROM expenses e JOIN expense_categories ec ON ec.id = e.category_id
        WHERE e.branch_id = $1 AND e.voided_at IS NULL AND e.expense_date BETWEEN $2::date AND $3::date
        GROUP BY ec.name ORDER BY amount DESC`,
      [actor.branchId, f.from, f.to],
    ),
    pool.query(
      `WITH months AS (
         SELECT generate_series(date_trunc('month', $3::date), date_trunc('month', $4::date), interval '1 month')::date AS m),
       s AS (SELECT date_trunc('month', ${localDate('s.created_at')})::date AS m, sum(si.net_amount) AS revenue, sum(si.quantity * si.unit_cost) AS cogs
               FROM sales s JOIN sale_items si ON si.sale_id = s.id
              WHERE s.branch_id = $1 AND ${localDate('s.created_at')} BETWEEN $3::date AND $4::date GROUP BY 1),
       r AS (SELECT date_trunc('month', ${localDate('r.created_at')})::date AS m, sum(net_amount) AS revenue, sum(cost_restocked) AS cost
               FROM sale_returns r WHERE r.branch_id = $1 AND ${localDate('r.created_at')} BETWEEN $3::date AND $4::date GROUP BY 1),
       l AS (SELECT date_trunc('month', ${localDate('mv.created_at')})::date AS m, -sum(quantity * unit_cost) AS value
               FROM inventory_movements mv
              WHERE mv.branch_id = $1 AND mv.movement_type IN ('adjustment_in','adjustment_out','damaged','expired','correction')
                AND ${localDate('mv.created_at')} BETWEEN $3::date AND $4::date GROUP BY 1),
       e AS (SELECT date_trunc('month', expense_date)::date AS m, sum(amount) AS amount FROM expenses
              WHERE branch_id = $1 AND voided_at IS NULL AND expense_date BETWEEN $3::date AND $4::date GROUP BY 1)
       SELECT months.m AS month,
              COALESCE(s.revenue, 0) - COALESCE(r.revenue, 0) AS net_revenue,
              COALESCE(s.cogs, 0) - COALESCE(r.cost, 0) AS cogs,
              COALESCE(l.value, 0) AS stock_losses,
              COALESCE(e.amount, 0) AS expenses
         FROM months LEFT JOIN s ON s.m = months.m LEFT JOIN r ON r.m = months.m LEFT JOIN l ON l.m = months.m LEFT JOIN e ON e.m = months.m
        ORDER BY months.m`,
      p,
    ),
  ]);
  const s = sales.rows[0];
  const r = returns.rows[0];
  const c = (v: unknown) => toCents(v as number);
  const grossSales = c(s.revenue);
  const returnsNet = c(r.revenue);
  const netRevenue = grossSales - returnsNet;
  const cogs = c(s.cogs) - c(r.cost_restocked);
  const grossProfit = netRevenue - cogs;
  const lossLines = Object.fromEntries(losses.rows.map((l) => [l.movement_type, Number(l.value)]));
  const stockLosses = losses.rows.reduce((a, l) => a + c(l.value), 0);
  const opex = expenses.rows.reduce((a, e) => a + c(e.amount), 0);
  const netProfit = grossProfit - stockLosses - opex;
  return {
    range: f,
    grossSales: fromCents(grossSales),
    discounts: Number(s.discounts),
    returns: fromCents(returnsNet),
    returnCount: r.count,
    netRevenue: fromCents(netRevenue),
    cogs: fromCents(cogs),
    grossProfit: fromCents(grossProfit),
    grossMargin: netRevenue > 0 ? grossProfit / netRevenue : 0,
    stockLosses: fromCents(stockLosses),
    stockLossBreakdown: {
      damaged: lossLines.damaged ?? 0,
      expired: lossLines.expired ?? 0,
      missing: lossLines.adjustment_out ?? 0,
      found: lossLines.adjustment_in ?? 0,
      countCorrections: lossLines.correction ?? 0,
    },
    operatingExpenses: fromCents(opex),
    expensesByCategory: expenses.rows,
    netProfit: fromCents(netProfit),
    netMargin: netRevenue > 0 ? netProfit / netRevenue : 0,
    taxCollected: fromCents(c(s.tax) - c(r.tax)),
    transactions: s.transactions,
    monthly: monthly.rows.map((m) => {
      const gp = c(m.net_revenue) - c(m.cogs);
      return { ...m, gross_profit: fromCents(gp), net_profit: fromCents(gp - c(m.stock_losses) - c(m.expenses)) };
    }),
  };
}

// ---------------------------------------------------------------------------
// Inventory and expiry
// ---------------------------------------------------------------------------
export async function inventoryReport(actor: Actor, f: { categoryId?: number; supplierId?: number; productId?: number }) {
  const today = await businessToday();
  const params: unknown[] = [actor.branchId, today];
  const where = ['b.branch_id = $1', 'b.quantity_on_hand > 0'];
  if (f.categoryId) { params.push(f.categoryId); where.push(`p.category_id = $${params.length}`); }
  if (f.supplierId) { params.push(f.supplierId); where.push(`b.supplier_id = $${params.length}`); }
  if (f.productId) { params.push(f.productId); where.push(`p.id = $${params.length}`); }
  const { rows } = await pool.query(
    `SELECT p.sku, p.name AS product_name, c.name AS category_name, b.batch_number, b.expiry_date, b.quantity_on_hand AS quantity,
            b.unit_cost, (b.quantity_on_hand * b.unit_cost)::numeric(14,2) AS stock_value, p.selling_price,
            (b.quantity_on_hand * p.selling_price)::numeric(14,2) AS retail_value, (b.expiry_date < $2::date) AS expired
       FROM product_batches b JOIN products p ON p.id = b.product_id LEFT JOIN categories c ON c.id = p.category_id
      WHERE ${where.join(' AND ')} ORDER BY p.name, b.expiry_date NULLS LAST LIMIT 20000`,
    params,
  );
  const byCategory = new Map<string, { category: string; units: number; value: number; retailValue: number }>();
  for (const r of rows) {
    const key = r.category_name ?? 'Uncategorised';
    const agg = byCategory.get(key) ?? { category: key, units: 0, value: 0, retailValue: 0 };
    agg.units += r.quantity;
    agg.value = fromCents(toCents(agg.value) + toCents(r.stock_value));
    agg.retailValue = fromCents(toCents(agg.retailValue) + toCents(r.retail_value));
    byCategory.set(key, agg);
  }
  const total = (k: string) => fromCents(rows.reduce((a, r) => a + toCents(r[k]), 0));
  return {
    summary: {
      batches: rows.length,
      units: rows.reduce((a, r) => a + r.quantity, 0),
      stockValue: total('stock_value'),
      retailValue: total('retail_value'),
      expiredValue: fromCents(rows.filter((r) => r.expired).reduce((a, r) => a + toCents(r.stock_value), 0)),
    },
    byCategory: [...byCategory.values()].sort((a, b) => b.value - a.value),
    rows,
  };
}

export async function expiryReport(actor: Actor, f: { days: number; categoryId?: number; supplierId?: number }) {
  const today = await businessToday();
  const params: unknown[] = [actor.branchId, today, addDays(today, f.days)];
  const where = ['b.branch_id = $1', 'b.quantity_on_hand > 0', "b.status <> 'disposed'", 'b.expiry_date <= $3::date'];
  if (f.categoryId) { params.push(f.categoryId); where.push(`p.category_id = $${params.length}`); }
  if (f.supplierId) { params.push(f.supplierId); where.push(`b.supplier_id = $${params.length}`); }
  const { rows } = await pool.query(
    `SELECT p.sku, p.name AS product_name, c.name AS category_name, b.id AS batch_id, b.batch_number, b.expiry_date,
            b.quantity_on_hand AS quantity, b.unit_cost, (b.quantity_on_hand * b.unit_cost)::numeric(14,2) AS value_at_risk,
            (b.expiry_date - $2::date) AS days_to_expiry, s.name AS supplier_name
       FROM product_batches b JOIN products p ON p.id = b.product_id LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN suppliers s ON s.id = b.supplier_id
      WHERE ${where.join(' AND ')} ORDER BY b.expiry_date, p.name`,
    params,
  );
  const sumWhere = (pred: (r: (typeof rows)[number]) => boolean) =>
    fromCents(rows.filter(pred).reduce((a, r) => a + toCents(r.value_at_risk), 0));
  return {
    today,
    summary: {
      batches: rows.length,
      expiredValue: sumWhere((r) => r.days_to_expiry < 0),
      atRiskValue: sumWhere((r) => r.days_to_expiry >= 0),
      totalValue: sumWhere(() => true),
    },
    rows,
  };
}

// ---------------------------------------------------------------------------
// Purchases and expenses
// ---------------------------------------------------------------------------
export async function purchaseReport(actor: Actor, f: ReportFilters) {
  const params: unknown[] = [actor.branchId, f.from, f.to];
  let supplier = '';
  if (f.supplierId) { params.push(f.supplierId); supplier = `AND po.supplier_id = $4`; }
  const orders = await pool.query(
    `SELECT po.id, po.po_number, po.order_date, po.status, po.total, s.name AS supplier_name,
            COALESCE((SELECT sum(g.total_cost) FROM goods_receipts g WHERE g.purchase_order_id = po.id), 0) AS received_value
       FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
      WHERE po.branch_id = $1 AND po.order_date BETWEEN $2::date AND $3::date ${supplier}
      ORDER BY po.order_date DESC, po.id DESC`,
    params,
  );
  const receiptsSupplier = f.supplierId ? 'AND g.supplier_id = $4' : '';
  const bySupplier = await pool.query(
    `SELECT s.id, s.name AS supplier_name, count(g.id)::int AS deliveries, COALESCE(sum(g.total_cost), 0) AS received_value,
            COALESCE((SELECT sum(sp.amount) FROM supplier_payments sp WHERE sp.supplier_id = s.id AND sp.paid_date BETWEEN $2::date AND $3::date), 0) AS paid
       FROM goods_receipts g JOIN suppliers s ON s.id = g.supplier_id
      WHERE g.branch_id = $1 AND g.received_date BETWEEN $2::date AND $3::date ${receiptsSupplier}
      GROUP BY s.id ORDER BY received_value DESC`,
    params,
  );
  return {
    range: f,
    summary: {
      orders: orders.rowCount,
      orderedValue: fromCents(orders.rows.filter((o) => o.status !== 'cancelled').reduce((a, o) => a + toCents(o.total), 0)),
      receivedValue: fromCents(bySupplier.rows.reduce((a, r) => a + toCents(r.received_value), 0)),
      paid: fromCents(bySupplier.rows.reduce((a, r) => a + toCents(r.paid), 0)),
    },
    bySupplier: bySupplier.rows,
    rows: orders.rows,
  };
}

export async function expenseReport(actor: Actor, f: ReportFilters & { expenseCategoryId?: number }) {
  const params: unknown[] = [actor.branchId, f.from, f.to];
  let cat = '';
  if (f.expenseCategoryId) { params.push(f.expenseCategoryId); cat = 'AND e.category_id = $4'; }
  const { rows } = await pool.query(
    `SELECT e.expense_no, e.expense_date, ec.name AS category, e.description, e.amount, e.payment_method, e.paid_to,
            emp.full_name AS employee_name
       FROM expenses e JOIN expense_categories ec ON ec.id = e.category_id LEFT JOIN users emp ON emp.id = e.employee_id
      WHERE e.branch_id = $1 AND e.voided_at IS NULL AND e.expense_date BETWEEN $2::date AND $3::date ${cat}
      ORDER BY e.expense_date DESC, e.id DESC`,
    params,
  );
  const byCategory = new Map<string, number>();
  for (const r of rows) byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + toCents(r.amount));
  const total = rows.reduce((a, r) => a + toCents(r.amount), 0);
  return {
    range: f,
    summary: { count: rows.length, total: fromCents(total) },
    byCategory: [...byCategory.entries()]
      .map(([category, cents]) => ({ category, amount: fromCents(cents), share: total ? cents / total : 0 }))
      .sort((a, b) => b.amount - a.amount),
    rows,
  };
}

// ---------------------------------------------------------------------------
// Tax and staff
// ---------------------------------------------------------------------------
export async function taxReport(actor: Actor, f: { from: string; to: string }) {
  const p = [actor.branchId, await tz(), f.from, f.to];
  const sales = await pool.query(
    `SELECT si.tax_rate, sum(si.net_amount) AS taxable_amount, sum(si.tax_amount) AS tax, count(DISTINCT s.id)::int AS invoices
       FROM sale_items si JOIN sales s ON s.id = si.sale_id
      WHERE s.branch_id = $1 AND ${localDate('s.created_at')} BETWEEN $3::date AND $4::date
      GROUP BY si.tax_rate ORDER BY si.tax_rate`,
    p,
  );
  const returns = await pool.query(
    `SELECT si.tax_rate, sum(ri.net_amount) AS taxable_amount, sum(ri.tax_amount) AS tax
       FROM sale_return_items ri JOIN sale_returns r ON r.id = ri.return_id JOIN sale_items si ON si.id = ri.sale_item_id
      WHERE r.branch_id = $1 AND ${localDate('r.created_at')} BETWEEN $3::date AND $4::date
      GROUP BY si.tax_rate`,
    p,
  );
  const ret = new Map(returns.rows.map((r) => [Number(r.tax_rate), r]));
  const rows = sales.rows.map((r) => {
    const back = ret.get(Number(r.tax_rate));
    return {
      tax_rate: Number(r.tax_rate),
      invoices: r.invoices,
      taxable_amount: fromCents(toCents(r.taxable_amount) - toCents(back?.taxable_amount ?? 0)),
      tax: fromCents(toCents(r.tax) - toCents(back?.tax ?? 0)),
      returned_tax: Number(back?.tax ?? 0),
    };
  });
  const settings = await getSettings();
  return {
    range: f,
    taxInclusive: settings.sales.taxInclusive,
    summary: {
      taxableAmount: fromCents(rows.reduce((a, r) => a + toCents(r.taxable_amount), 0)),
      tax: fromCents(rows.reduce((a, r) => a + toCents(r.tax), 0)),
    },
    rows,
  };
}

export async function staffPerformance(actor: Actor, f: { from: string; to: string }) {
  const p = [actor.branchId, await tz(), f.from, f.to];
  const { rows } = await pool.query(
    `WITH s AS (
       SELECT cashier_id, count(*)::int AS transactions, sum(total) AS revenue, sum(discount_total) AS discounts,
              sum(cost_total) AS cost, sum((SELECT sum(net_amount) FROM sale_items si WHERE si.sale_id = sales.id)) AS net
         FROM sales WHERE branch_id = $1 AND ${localDate('created_at')} BETWEEN $3::date AND $4::date GROUP BY cashier_id),
     r AS (
       SELECT s2.cashier_id, count(r.id)::int AS returns, sum(r.total_amount) AS returns_value
         FROM sale_returns r JOIN sales s2 ON s2.id = r.sale_id
        WHERE r.branch_id = $1 AND ${localDate('r.created_at')} BETWEEN $3::date AND $4::date GROUP BY s2.cashier_id),
     rx AS (
       SELECT dispensed_by, count(DISTINCT prescription_id)::int AS prescriptions
         FROM prescription_dispensings d JOIN prescriptions p ON p.id = d.prescription_id
        WHERE p.branch_id = $1 AND ${localDate('d.dispensed_at')} BETWEEN $3::date AND $4::date GROUP BY dispensed_by)
     SELECT u.id, u.full_name, u.job_title, COALESCE(s.transactions, 0) AS transactions, COALESCE(s.revenue, 0) AS revenue,
            COALESCE(s.discounts, 0) AS discounts, COALESCE(r.returns, 0) AS returns, COALESCE(r.returns_value, 0) AS returns_value,
            COALESCE(rx.prescriptions, 0) AS prescriptions_dispensed,
            CASE WHEN COALESCE(s.transactions, 0) > 0 THEN round(s.revenue / s.transactions, 2) ELSE 0 END AS average_sale,
            CASE WHEN COALESCE(s.revenue, 0) > 0 THEN round(s.discounts / (s.revenue + s.discounts), 4) ELSE 0 END AS discount_rate
       FROM users u LEFT JOIN s ON s.cashier_id = u.id LEFT JOIN r ON r.cashier_id = u.id LEFT JOIN rx ON rx.dispensed_by = u.id
      WHERE s.cashier_id IS NOT NULL OR r.cashier_id IS NOT NULL OR rx.dispensed_by IS NOT NULL
      ORDER BY revenue DESC`,
    p,
  );
  return { range: f, rows };
}
