import { formatMoney, type SupplierInput } from '@dawa/shared';
import { pool, withTransaction } from '../../db/pool';
import type { Actor } from '../../lib/actor';
import { occurredAt } from '../../lib/actor';
import { audit, diff } from '../../lib/audit';
import { conflict, notFound, unprocessable } from '../../lib/errors';
import { likeParam, orderBy, pageParams, paginated } from '../../lib/pagination';
import { nextCode, nextDocumentNumber } from '../../lib/sequences';
import { getSettings } from '../settings/service';
import { businessToday } from '../../lib/today';

type SupplierData = Omit<Required<SupplierInput>, 'email'> & { email: string | null };

/** Outstanding = value of goods received − payments made. Overdue = unpaid receipts past their due date. */
const BALANCE_LATERAL = `LEFT JOIN LATERAL (
    SELECT COALESCE((SELECT sum(g.total_cost) FROM goods_receipts g WHERE g.supplier_id = s.id), 0)
         - COALESCE((SELECT sum(sp.amount) FROM supplier_payments sp WHERE sp.supplier_id = s.id), 0) AS outstanding,
           (SELECT max(g.received_date) FROM goods_receipts g WHERE g.supplier_id = s.id) AS last_delivery
  ) bal ON TRUE`;

const SORTS: Record<string, string> = { name: 's.name', outstanding: 'bal.outstanding', code: 's.code', lastDelivery: 'bal.last_delivery' };

export async function listSuppliers(q: { page: number; pageSize: number; search?: string; status?: string; sort?: string; order?: 'asc' | 'desc' }) {
  const params: unknown[] = [];
  const where: string[] = [];
  if (q.search) {
    params.push(likeParam(q.search));
    where.push(`(s.name ILIKE $1 OR s.code ILIKE $1 OR s.contact_person ILIKE $1 OR s.phone ILIKE $1 OR s.email ILIKE $1)`);
  }
  if (q.status) { params.push(q.status); where.push(`s.status = $${params.length}`); }
  const { limit, offset } = pageParams(q.page, q.pageSize);
  const { rows } = await pool.query(
    `SELECT s.id, s.code, s.name, s.contact_person, s.phone, s.email, s.payment_terms_days, s.credit_limit, s.status,
            bal.outstanding, bal.last_delivery, count(*) OVER() AS total_count
       FROM suppliers s ${BALANCE_LATERAL}
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ${orderBy(SORTS, q.sort, q.order, 's.name ASC')} LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  return paginated(rows.map(({ total_count: _t, ...r }) => r), rows[0]?.total_count ?? 0, q.page, q.pageSize);
}

export async function supplierOptions() {
  const { rows } = await pool.query(`SELECT id, code, name, payment_terms_days FROM suppliers WHERE status = 'active' ORDER BY name`);
  return rows;
}

export async function getSupplier(id: number) {
  const today = await businessToday();
  const { rows } = await pool.query(`SELECT s.*, bal.outstanding, bal.last_delivery FROM suppliers s ${BALANCE_LATERAL} WHERE s.id = $1`, [id]);
  if (!rows[0]) throw notFound('Supplier');
  const [receipts, payments, orders, products, overdue] = await Promise.all([
    pool.query(
      `SELECT g.id, g.grn_number, g.received_date, g.due_date, g.total_cost, g.supplier_invoice_no, po.po_number,
              COALESCE((SELECT sum(amount) FROM supplier_payments sp WHERE sp.goods_receipt_id = g.id), 0) AS paid
         FROM goods_receipts g LEFT JOIN purchase_orders po ON po.id = g.purchase_order_id
        WHERE g.supplier_id = $1 ORDER BY g.received_date DESC, g.id DESC LIMIT 50`,
      [id],
    ),
    pool.query(
      `SELECT sp.id, sp.payment_no, sp.amount, sp.method, sp.reference, sp.paid_date, sp.notes, g.grn_number, u.full_name AS recorded_by_name
         FROM supplier_payments sp LEFT JOIN goods_receipts g ON g.id = sp.goods_receipt_id JOIN users u ON u.id = sp.recorded_by
        WHERE sp.supplier_id = $1 ORDER BY sp.paid_date DESC, sp.id DESC LIMIT 50`,
      [id],
    ),
    pool.query(
      `SELECT id, po_number, status, order_date, expected_date, total FROM purchase_orders WHERE supplier_id = $1 ORDER BY order_date DESC, id DESC LIMIT 20`,
      [id],
    ),
    pool.query(
      `SELECT p.id, p.sku, p.name, sp.last_cost, sp.last_supplied_at FROM supplier_products sp JOIN products p ON p.id = sp.product_id
        WHERE sp.supplier_id = $1 ORDER BY sp.last_supplied_at DESC NULLS LAST LIMIT 50`,
      [id],
    ),
    // Oldest-first allocation of payments against receipts gives the overdue amount.
    pool.query(
      `WITH r AS (
         SELECT g.id, g.due_date, g.total_cost, sum(g.total_cost) OVER (ORDER BY g.received_date, g.id) AS running
           FROM goods_receipts g WHERE g.supplier_id = $1),
       paid AS (SELECT COALESCE(sum(amount), 0) AS total FROM supplier_payments WHERE supplier_id = $1)
       SELECT COALESCE(sum(LEAST(r.total_cost, GREATEST(r.running - paid.total, 0))) FILTER (WHERE r.due_date < $2::date), 0) AS overdue
         FROM r, paid`,
      [id, today],
    ),
  ]);
  return {
    ...rows[0],
    overdue: overdue.rows[0].overdue,
    receipts: receipts.rows,
    payments: payments.rows,
    purchaseOrders: orders.rows,
    products: products.rows,
  };
}

const cols = (d: SupplierData) => [
  d.name, d.contactPerson, d.phone, d.email, d.address, d.tin, d.vrn, d.paymentTermsDays, d.creditLimit, d.status, d.notes,
];

export async function createSupplier(actor: Actor, d: SupplierData) {
  return withTransaction(async (tx) => {
    if ((await tx.query('SELECT 1 FROM suppliers WHERE lower(name) = lower($1)', [d.name])).rowCount) {
      throw conflict('A supplier with this name already exists.');
    }
    const code = await nextCode(tx, 'SUP', 4);
    const { rows } = await tx.query(
      `INSERT INTO suppliers (code, name, contact_person, phone, email, address, tin, vrn, payment_terms_days, credit_limit, status, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [code, ...cols(d)],
    );
    await audit(tx, actor, {
      action: 'create', module: 'suppliers', entityType: 'supplier', entityId: rows[0].id,
      summary: `${actor.userName} added supplier ${d.name} (${code})`,
    });
    return { id: rows[0].id, code };
  });
}

export async function updateSupplier(actor: Actor, id: number, d: SupplierData) {
  return withTransaction(async (tx) => {
    const { rows } = await tx.query('SELECT * FROM suppliers WHERE id = $1 FOR UPDATE', [id]);
    if (!rows[0]) throw notFound('Supplier');
    if ((await tx.query('SELECT 1 FROM suppliers WHERE lower(name) = lower($1) AND id <> $2', [d.name, id])).rowCount) {
      throw conflict('A supplier with this name already exists.');
    }
    await tx.query(
      `UPDATE suppliers SET name=$1, contact_person=$2, phone=$3, email=$4, address=$5, tin=$6, vrn=$7, payment_terms_days=$8,
              credit_limit=$9, status=$10, notes=$11, updated_at=now() WHERE id=$12`,
      [...cols(d), id],
    );
    const b = rows[0];
    const changes = diff(
      { name: b.name, phone: b.phone, paymentTermsDays: b.payment_terms_days, creditLimit: Number(b.credit_limit), status: b.status },
      { name: d.name, phone: d.phone, paymentTermsDays: d.paymentTermsDays, creditLimit: d.creditLimit, status: d.status },
    );
    await audit(tx, actor, {
      action: 'update', module: 'suppliers', entityType: 'supplier', entityId: id,
      summary: `${actor.userName} updated supplier ${d.name}${changes ? ` (${Object.keys(changes.new).join(', ')})` : ''}`,
      oldValues: changes?.old, newValues: changes?.new,
    });
    return { id };
  });
}

export async function recordSupplierPayment(
  actor: Actor,
  d: { supplierId: number; goodsReceiptId: number | null; amount: number; method: string; reference: string | null; paidDate: string; notes: string | null },
) {
  const settings = await getSettings();
  return withTransaction(async (tx) => {
    const { rows } = await tx.query(`SELECT s.id, s.name, bal.outstanding FROM suppliers s ${BALANCE_LATERAL} WHERE s.id = $1 FOR UPDATE OF s`, [d.supplierId]);
    const supplier = rows[0];
    if (!supplier) throw notFound('Supplier');
    if (d.amount > Number(supplier.outstanding) + 0.001) {
      throw unprocessable(`Payment exceeds the outstanding balance of ${formatMoney(supplier.outstanding, settings.general.currency)}.`);
    }
    if (d.goodsReceiptId) {
      const g = await tx.query(
        `SELECT g.total_cost - COALESCE((SELECT sum(amount) FROM supplier_payments WHERE goods_receipt_id = g.id), 0) AS due
           FROM goods_receipts g WHERE g.id = $1 AND g.supplier_id = $2`,
        [d.goodsReceiptId, d.supplierId],
      );
      if (!g.rows[0]) throw unprocessable('That delivery does not belong to this supplier.');
      if (d.amount > Number(g.rows[0].due) + 0.001) throw unprocessable(`Payment exceeds the unpaid amount of that delivery (${formatMoney(g.rows[0].due, settings.general.currency)}).`);
    }
    const at = occurredAt(actor);
    const paymentNo = await nextDocumentNumber(tx, 'SPY', at);
    const ins = await tx.query(
      `INSERT INTO supplier_payments (payment_no, supplier_id, goods_receipt_id, amount, method, reference, paid_date, notes, recorded_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [paymentNo, d.supplierId, d.goodsReceiptId, d.amount, d.method, d.reference, d.paidDate, d.notes, actor.userId, at],
    );
    await audit(tx, actor, {
      action: 'payment', module: 'suppliers', entityType: 'supplier', entityId: d.supplierId,
      summary: `${actor.userName} recorded payment ${paymentNo} of ${formatMoney(d.amount, settings.general.currency)} to ${supplier.name} (${d.method})`,
      newValues: { paymentNo, amount: d.amount, method: d.method, reference: d.reference },
    });
    return { id: ins.rows[0].id, paymentNo };
  });
}
