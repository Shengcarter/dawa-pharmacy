import { pool, withTransaction } from '../../db/pool';
import { can, type Actor } from '../../lib/actor';
import { audit, diff } from '../../lib/audit';
import { conflict, notFound } from '../../lib/errors';
import { likeParam, orderBy, pageParams, paginated } from '../../lib/pagination';
import { nextCode } from '../../lib/sequences';

export interface CustomerData {
  fullName: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  customerType: string;
  insuranceProvider: string | null;
  insuranceMemberNo: string | null;
  creditLimit: number;
  notes: string | null;
  status: string;
}

const normalisePhone = (phone: string | null) => (phone ? phone.replace(/[\s-]/g, '') : null);

const SORTS: Record<string, string> = { name: 'c.full_name', code: 'c.code', balance: 'bal.outstanding', lastPurchase: 'bal.last_purchase', createdAt: 'c.created_at' };

const BALANCE = `LEFT JOIN LATERAL (
    SELECT COALESCE(sum(s.balance_due), 0) AS outstanding, max(s.created_at) AS last_purchase,
           COALESCE(sum(s.total), 0) AS lifetime_value, count(s.id)::int AS visits
      FROM sales s WHERE s.customer_id = c.id
  ) bal ON TRUE`;

export async function listCustomers(q: { page: number; pageSize: number; search?: string; sort?: string; order?: 'asc' | 'desc'; type?: string; withBalance?: boolean; status?: string }) {
  const params: unknown[] = [];
  const where: string[] = [];
  if (q.search) {
    params.push(likeParam(q.search), likeParam(q.search.replace(/[\s-]/g, '')));
    where.push(`(c.full_name ILIKE $1 OR c.code ILIKE $1 OR c.email ILIKE $1 OR c.phone ILIKE $2)`);
  }
  if (q.type) { params.push(q.type); where.push(`c.customer_type = $${params.length}`); }
  if (q.status) { params.push(q.status); where.push(`c.status = $${params.length}`); }
  if (q.withBalance) where.push('bal.outstanding > 0');
  const { limit, offset } = pageParams(q.page, q.pageSize);
  const { rows } = await pool.query(
    `SELECT c.id, c.code, c.full_name, c.phone, c.email, c.customer_type, c.status, c.credit_limit, c.store_credit_balance, c.created_at,
            bal.outstanding, bal.last_purchase, bal.lifetime_value, bal.visits, count(*) OVER() AS total_count
       FROM customers c ${BALANCE}
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ${orderBy(SORTS, q.sort, q.order, 'c.full_name ASC')}, c.id LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  return paginated(rows.map(({ total_count: _t, ...r }) => r), rows[0]?.total_count ?? 0, q.page, q.pageSize);
}

/** Small, fast lookup for the POS and prescription forms. */
export async function quickSearch(term: string) {
  const { rows } = await pool.query(
    `SELECT c.id, c.code, c.full_name, c.phone, c.customer_type, c.credit_limit, c.store_credit_balance,
            COALESCE((SELECT sum(balance_due) FROM sales s WHERE s.customer_id = c.id), 0) AS outstanding
       FROM customers c
      WHERE c.status = 'active' AND (c.full_name ILIKE $1 OR c.code ILIKE $1 OR c.phone ILIKE $2)
      ORDER BY c.full_name LIMIT 10`,
    [likeParam(term), likeParam(term.replace(/[\s-]/g, ''))],
  );
  return rows;
}

export async function getCustomer(actor: Actor, id: number) {
  const { rows } = await pool.query(`SELECT c.*, bal.outstanding, bal.last_purchase, bal.lifetime_value, bal.visits FROM customers c ${BALANCE} WHERE c.id = $1`, [id]);
  if (!rows[0]) throw notFound('Customer');
  const sales = await pool.query(
    `SELECT s.id, s.invoice_no, s.created_at, s.total, s.balance_due, s.payment_type, s.payment_status, s.status,
            (SELECT count(*)::int FROM sale_items si WHERE si.sale_id = s.id) AS line_count
       FROM sales s WHERE s.customer_id = $1 ORDER BY s.created_at DESC LIMIT 50`,
    [id],
  );
  const prescriptions = can(actor, 'prescriptions.view')
    ? (await pool.query(
        `SELECT id, rx_number, prescriber_name, prescription_date, status FROM prescriptions WHERE customer_id = $1 ORDER BY prescription_date DESC LIMIT 20`,
        [id],
      )).rows
    : null;
  const customer = rows[0];
  // Clinical/insurance details are only shown to staff who handle prescriptions.
  if (!can(actor, 'prescriptions.view')) {
    delete customer.insurance_member_no;
  }
  return { ...customer, sales: sales.rows, prescriptions };
}

const cols = (d: CustomerData) => [
  d.fullName, normalisePhone(d.phone), d.email, d.address, d.dateOfBirth, d.gender, d.customerType, d.insuranceProvider,
  d.insuranceMemberNo, d.creditLimit, d.notes, d.status,
];

async function assertPhoneFree(db: { query: typeof pool.query }, phone: string | null, excludeId = 0) {
  const p = normalisePhone(phone);
  if (!p) return;
  const r = await db.query('SELECT full_name FROM customers WHERE phone = $1 AND id <> $2', [p, excludeId]);
  if (r.rowCount) throw conflict(`This phone number is already registered to ${r.rows[0].full_name}.`);
}

export async function createCustomer(actor: Actor, d: CustomerData) {
  if (!can(actor, 'sales.record_payment') && !can(actor, 'users.manage') && d.creditLimit > 0) d.creditLimit = 0;
  return withTransaction(async (tx) => {
    await assertPhoneFree(tx, d.phone);
    const code = await nextCode(tx, 'CUS', 5);
    const { rows } = await tx.query(
      `INSERT INTO customers (code, full_name, phone, email, address, date_of_birth, gender, customer_type, insurance_provider,
                              insurance_member_no, credit_limit, notes, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id, code, full_name, phone, customer_type, credit_limit, store_credit_balance`,
      [code, ...cols(d), actor.userId],
    );
    await audit(tx, actor, { action: 'create', module: 'customers', entityType: 'customer', entityId: rows[0].id, summary: `${actor.userName} registered customer ${d.fullName} (${code})` });
    return { ...rows[0], outstanding: 0 };
  });
}

export async function updateCustomer(actor: Actor, id: number, d: CustomerData) {
  return withTransaction(async (tx) => {
    const { rows } = await tx.query('SELECT * FROM customers WHERE id = $1 FOR UPDATE', [id]);
    const before = rows[0];
    if (!before) throw notFound('Customer');
    await assertPhoneFree(tx, d.phone, id);
    // Only finance-capable roles may change a credit limit.
    if (Number(before.credit_limit) !== d.creditLimit && !can(actor, 'sales.record_payment') && !can(actor, 'users.manage')) {
      d.creditLimit = Number(before.credit_limit);
    }
    await tx.query(
      `UPDATE customers SET full_name=$1, phone=$2, email=$3, address=$4, date_of_birth=$5, gender=$6, customer_type=$7,
              insurance_provider=$8, insurance_member_no=$9, credit_limit=$10, notes=$11, status=$12, updated_at=now() WHERE id=$13`,
      [...cols(d), id],
    );
    const changes = diff(
      { fullName: before.full_name, phone: before.phone, creditLimit: Number(before.credit_limit), status: before.status, customerType: before.customer_type },
      { fullName: d.fullName, phone: normalisePhone(d.phone), creditLimit: d.creditLimit, status: d.status, customerType: d.customerType },
    );
    await audit(tx, actor, {
      action: 'update', module: 'customers', entityType: 'customer', entityId: id,
      summary: `${actor.userName} updated customer ${d.fullName}${changes ? ` (${Object.keys(changes.new).join(', ')})` : ''}`,
      oldValues: changes?.old, newValues: changes?.new,
    });
    return { id };
  });
}
