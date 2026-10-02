import type { z } from 'zod';
import { CLAIM_SHORTFALL_OUTCOMES, formatMoney, fromCents, toCents, type claimListQuery, type insuranceSchemeSchema } from '@dawa/shared';
import { pool, withTransaction, type Tx } from '../../db/pool';
import type { Actor } from '../../lib/actor';
import { audit, diff } from '../../lib/audit';
import { conflict, notFound, unprocessable } from '../../lib/errors';
import { likeParam, pageParams, paginated } from '../../lib/pagination';
import { nextDocumentNumber } from '../../lib/sequences';
import { getSettings } from '../settings/service';

type SchemeData = z.output<typeof insuranceSchemeSchema>;
type ClaimQuery = z.output<typeof claimListQuery>;

// ---------------------------------------------------------------------------
// Schemes
// ---------------------------------------------------------------------------
export async function listSchemes(includeInactive = true) {
  const { rows } = await pool.query(
    `SELECT s.*,
            (SELECT count(*)::int FROM insurance_scheme_prices p WHERE p.scheme_id = s.id) AS price_count,
            (SELECT count(*)::int FROM customers c WHERE c.insurance_scheme_id = s.id) AS member_count,
            (SELECT COALESCE(sum(c.amount - c.amount_paid - c.written_off - c.billed_to_patient), 0)
               FROM insurance_claims c WHERE c.scheme_id = s.id AND c.status IN ('pending', 'submitted', 'partially_paid')) AS outstanding
       FROM insurance_schemes s
      ${includeInactive ? '' : `WHERE s.status = 'active'`}
      ORDER BY s.status, s.name`,
  );
  return rows;
}

export async function getScheme(id: number) {
  const { rows } = await pool.query('SELECT * FROM insurance_schemes WHERE id = $1', [id]);
  if (!rows[0]) throw notFound('Insurance scheme');
  return rows[0];
}

const schemeCols = (d: SchemeData) => [
  d.code, d.name, d.contactName, d.phone, d.email, d.address, d.copayPercent, d.coverage, d.requiresPrescription,
  d.claimTermsDays, d.status, d.notes,
];

async function assertSchemeUnique(db: Tx, d: SchemeData, excludeId = 0) {
  const { rows } = await db.query(
    'SELECT code, name FROM insurance_schemes WHERE (upper(code) = upper($1) OR lower(name) = lower($2)) AND id <> $3',
    [d.code, d.name, excludeId],
  );
  if (rows[0]) throw conflict(rows[0].code.toUpperCase() === d.code ? `Code ${d.code} is already used.` : `${d.name} already exists.`);
}

export async function createScheme(actor: Actor, d: SchemeData) {
  return withTransaction(async (tx) => {
    await assertSchemeUnique(tx, d);
    const { rows } = await tx.query(
      `INSERT INTO insurance_schemes (code, name, contact_name, phone, email, address, copay_percent, coverage, requires_prescription,
                                      claim_terms_days, status, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [...schemeCols(d), actor.userId],
    );
    await audit(tx, actor, {
      action: 'create', module: 'insurance', entityType: 'insurance_scheme', entityId: rows[0].id,
      summary: `${actor.userName} added insurance scheme ${d.name} (co-pay ${d.copayPercent}%)`,
      newValues: d,
    });
    return { id: rows[0].id as number };
  });
}

export async function updateScheme(actor: Actor, id: number, d: SchemeData) {
  return withTransaction(async (tx) => {
    const { rows } = await tx.query('SELECT * FROM insurance_schemes WHERE id = $1 FOR UPDATE', [id]);
    const before = rows[0];
    if (!before) throw notFound('Insurance scheme');
    await assertSchemeUnique(tx, d, id);
    await tx.query(
      `UPDATE insurance_schemes SET code=$1, name=$2, contact_name=$3, phone=$4, email=$5, address=$6, copay_percent=$7, coverage=$8,
              requires_prescription=$9, claim_terms_days=$10, status=$11, notes=$12, updated_at=now() WHERE id=$13`,
      [...schemeCols(d), id],
    );
    // Keep the customer-facing provider name in step with the scheme.
    if (before.name !== d.name) await tx.query('UPDATE customers SET insurance_provider = $2 WHERE insurance_scheme_id = $1', [id, d.name]);
    const changes = diff(
      { name: before.name, code: before.code, copayPercent: Number(before.copay_percent), coverage: before.coverage, requiresPrescription: before.requires_prescription, claimTermsDays: before.claim_terms_days, status: before.status },
      { name: d.name, code: d.code, copayPercent: d.copayPercent, coverage: d.coverage, requiresPrescription: d.requiresPrescription, claimTermsDays: d.claimTermsDays, status: d.status },
    );
    await audit(tx, actor, {
      action: 'update', module: 'insurance', entityType: 'insurance_scheme', entityId: id,
      summary: `${actor.userName} updated insurance scheme ${d.name}${changes ? ` (${Object.keys(changes.new).join(', ')})` : ''}`,
      oldValues: changes?.old, newValues: changes?.new,
    });
    return { id };
  });
}

// ---------------------------------------------------------------------------
// Price lists
// ---------------------------------------------------------------------------
export async function listSchemePrices(schemeId: number, q: { search?: string; page: number; pageSize: number }) {
  await getScheme(schemeId);
  const params: unknown[] = [schemeId];
  let filter = '';
  if (q.search) {
    params.push(likeParam(q.search));
    filter = `AND (p.name ILIKE $2 OR p.sku ILIKE $2 OR p.generic_name ILIKE $2)`;
  }
  const { limit, offset } = pageParams(q.page, q.pageSize);
  const { rows } = await pool.query(
    `SELECT p.id AS product_id, p.sku, p.name, p.strength, p.unit, p.selling_price, sp.unit_price, sp.updated_at,
            u.full_name AS updated_by_name, count(*) OVER() AS total_count
       FROM insurance_scheme_prices sp JOIN products p ON p.id = sp.product_id LEFT JOIN users u ON u.id = sp.updated_by
      WHERE sp.scheme_id = $1 ${filter}
      ORDER BY p.name LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  return paginated(rows.map(({ total_count: _t, ...r }) => r), rows[0]?.total_count ?? 0, q.page, q.pageSize);
}

/** Every agreed price, for CSV export. */
export async function allSchemePrices(schemeId: number) {
  const { rows } = await pool.query(
    `SELECT p.sku, p.name, p.strength, p.unit, p.selling_price, sp.unit_price
       FROM insurance_scheme_prices sp JOIN products p ON p.id = sp.product_id WHERE sp.scheme_id = $1 ORDER BY p.name`,
    [schemeId],
  );
  return rows;
}

/** Agreed prices for the products in a till cart (any user who can sell may read them). */
export async function pricesForProducts(schemeId: number, productIds: number[]) {
  const { rows } = await pool.query(
    `SELECT sp.product_id, sp.unit_price::float8 AS unit_price FROM insurance_scheme_prices sp
       JOIN insurance_schemes s ON s.id = sp.scheme_id AND s.status = 'active'
      WHERE sp.scheme_id = $1 AND sp.product_id = ANY($2::int[])`,
    [schemeId, productIds],
  );
  return rows as { product_id: number; unit_price: number }[];
}

export async function saveSchemePrices(actor: Actor, schemeId: number, prices: { productId: number; unitPrice: number | null }[]) {
  const settings = await getSettings();
  const cur = settings.general.currency;
  return withTransaction(async (tx) => {
    const { rows } = await tx.query('SELECT id, name FROM insurance_schemes WHERE id = $1 FOR UPDATE', [schemeId]);
    const scheme = rows[0];
    if (!scheme) throw notFound('Insurance scheme');
    const ids = [...new Set(prices.map((p) => p.productId))];
    if (ids.length !== prices.length) throw unprocessable('A product is listed twice.');
    const products = await tx.query('SELECT id, name FROM products WHERE id = ANY($1::int[])', [ids]);
    if (products.rowCount !== ids.length) throw unprocessable('A product on the list no longer exists.');
    const names = new Map(products.rows.map((p) => [p.id as number, p.name as string]));
    const current = await tx.query('SELECT product_id, unit_price FROM insurance_scheme_prices WHERE scheme_id = $1 AND product_id = ANY($2::int[])', [schemeId, ids]);
    const before = new Map(current.rows.map((r) => [r.product_id as number, Number(r.unit_price)]));
    const changes: string[] = [];
    for (const p of prices) {
      const old = before.get(p.productId);
      if (p.unitPrice === null) {
        if (old === undefined) continue;
        await tx.query('DELETE FROM insurance_scheme_prices WHERE scheme_id = $1 AND product_id = $2', [schemeId, p.productId]);
        changes.push(`removed ${names.get(p.productId)} (was ${formatMoney(old, cur)})`);
      } else if (old !== p.unitPrice) {
        await tx.query(
          `INSERT INTO insurance_scheme_prices (scheme_id, product_id, unit_price, updated_by, updated_at) VALUES ($1,$2,$3,$4,now())
           ON CONFLICT (scheme_id, product_id) DO UPDATE SET unit_price = EXCLUDED.unit_price, updated_by = EXCLUDED.updated_by, updated_at = now()`,
          [schemeId, p.productId, p.unitPrice, actor.userId],
        );
        changes.push(`${names.get(p.productId)} ${old === undefined ? '' : `${formatMoney(old, cur)} → `}${formatMoney(p.unitPrice, cur)}`);
      }
    }
    if (changes.length) {
      await audit(tx, actor, {
        action: 'price_change', module: 'insurance', entityType: 'insurance_scheme', entityId: schemeId,
        summary: `${actor.userName} changed ${changes.length} ${scheme.name} price${changes.length === 1 ? '' : 's'}: ${changes.slice(0, 8).join('; ')}${changes.length > 8 ? `; and ${changes.length - 8} more` : ''}`,
        newValues: { prices },
      });
    }
    return { changed: changes.length };
  });
}

/** Imports a price list keyed by SKU (from the CSV export format). */
export async function importSchemePrices(actor: Actor, schemeId: number, rows: { sku: string; unitPrice: number | null }[]) {
  const skus = [...new Set(rows.map((r) => r.sku.trim().toUpperCase()))];
  const { rows: found } = await pool.query('SELECT id, upper(sku) AS sku FROM products WHERE upper(sku) = ANY($1::text[])', [skus]);
  const bySku = new Map(found.map((p) => [p.sku as string, p.id as number]));
  const unknown = skus.filter((s) => !bySku.has(s));
  if (unknown.length) throw unprocessable(`Unknown SKU${unknown.length === 1 ? '' : 's'}: ${unknown.slice(0, 10).join(', ')}${unknown.length > 10 ? ` and ${unknown.length - 10} more` : ''}. Nothing was imported.`);
  const latest = new Map<number, number | null>();
  for (const r of rows) latest.set(bySku.get(r.sku.trim().toUpperCase())!, r.unitPrice);
  return saveSchemePrices(actor, schemeId, [...latest].map(([productId, unitPrice]) => ({ productId, unitPrice })));
}

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------
const OPEN = `('pending', 'submitted', 'partially_paid')`;
const outstandingSql = (c: string) => `(${c}.amount - ${c}.amount_paid - ${c}.written_off - ${c}.billed_to_patient)`;
const overdueSql = (c: string, s: string) =>
  `(${c}.status IN ('submitted', 'partially_paid') AND ${c}.submitted_at + make_interval(days => ${s}.claim_terms_days) < now())`;

export async function claimSummary(actor: Actor) {
  const { rows } = await pool.query(
    `SELECT COALESCE(sum(${outstandingSql('c')}) FILTER (WHERE c.status = 'pending'), 0) AS pending_amount,
            count(*) FILTER (WHERE c.status = 'pending')::int AS pending_count,
            COALESCE(sum(${outstandingSql('c')}) FILTER (WHERE c.status IN ('submitted', 'partially_paid')), 0) AS submitted_amount,
            count(*) FILTER (WHERE c.status IN ('submitted', 'partially_paid'))::int AS submitted_count,
            COALESCE(sum(${outstandingSql('c')}) FILTER (WHERE ${overdueSql('c', 's')}), 0) AS overdue_amount,
            count(*) FILTER (WHERE ${overdueSql('c', 's')})::int AS overdue_count,
            (SELECT COALESCE(sum(p.amount), 0) FROM insurance_claim_payments p JOIN insurance_claims c2 ON c2.id = p.claim_id
              WHERE c2.branch_id = $1 AND p.paid_on >= date_trunc('month', now())::date) AS paid_this_month
       FROM insurance_claims c JOIN insurance_schemes s ON s.id = c.scheme_id
      WHERE c.branch_id = $1 AND c.status IN ${OPEN}`,
    [actor.branchId],
  );
  return rows[0];
}

export async function listClaims(actor: Actor, q: ClaimQuery) {
  const params: unknown[] = [actor.branchId];
  const where = ['c.branch_id = $1'];
  const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
  if (q.schemeId) add('c.scheme_id = ?', q.schemeId);
  if (q.status === 'open') where.push(`c.status IN ${OPEN}`);
  else if (q.status === 'overdue') where.push(overdueSql('c', 's'));
  else if (q.status) add('c.status = ?', q.status);
  if (q.from) add(`c.created_at >= (?::date)::timestamptz`, q.from);
  if (q.to) add(`c.created_at < (?::date + 1)::timestamptz`, q.to);
  if (q.search) add(`(c.claim_no ILIKE ? OR sa.invoice_no ILIKE ? OR cu.full_name ILIKE ? OR c.member_no ILIKE ?)`.replaceAll('?', `$${params.length + 1}`), likeParam(q.search));
  const { limit, offset } = pageParams(q.page, q.pageSize);
  const { rows } = await pool.query(
    `SELECT c.id, c.claim_no, c.status, c.amount, c.amount_paid, c.written_off, c.billed_to_patient, ${outstandingSql('c')} AS outstanding,
            c.member_no, c.submission_ref, c.submitted_at, c.created_at, ${overdueSql('c', 's')} AS overdue,
            s.id AS scheme_id, s.name AS scheme_name, s.code AS scheme_code,
            sa.id AS sale_id, sa.invoice_no, cu.id AS customer_id, cu.full_name AS customer_name,
            count(*) OVER() AS total_count
       FROM insurance_claims c
       JOIN insurance_schemes s ON s.id = c.scheme_id
       JOIN sales sa ON sa.id = c.sale_id
       JOIN customers cu ON cu.id = c.customer_id
      WHERE ${where.join(' AND ')}
      ORDER BY c.created_at DESC, c.id DESC LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  return paginated(rows.map(({ total_count: _t, ...r }) => r), rows[0]?.total_count ?? 0, q.page, q.pageSize);
}

export async function getClaim(actor: Actor, id: number) {
  const { rows } = await pool.query(
    `SELECT c.*, ${outstandingSql('c')} AS outstanding, ${overdueSql('c', 's')} AS overdue, s.name AS scheme_name, s.code AS scheme_code,
            s.claim_terms_days, sa.invoice_no, sa.total AS sale_total, sa.created_at AS sale_date, cu.full_name AS customer_name,
            cu.code AS customer_code, sb.full_name AS submitted_by_name, rx.rx_number, rx.prescriber_name
       FROM insurance_claims c
       JOIN insurance_schemes s ON s.id = c.scheme_id
       JOIN sales sa ON sa.id = c.sale_id
       JOIN customers cu ON cu.id = c.customer_id
       LEFT JOIN users sb ON sb.id = c.submitted_by
       LEFT JOIN prescriptions rx ON rx.id = sa.prescription_id
      WHERE c.id = $1 AND c.branch_id = $2`,
    [id, actor.branchId],
  );
  if (!rows[0]) throw notFound('Claim');
  const items = await pool.query(
    `SELECT p.name AS product_name, p.strength, p.unit, sum(si.quantity)::int AS quantity, sum(si.quantity_returned)::int AS quantity_returned,
            si.unit_price, si.units_per_sale_unit, sum(si.line_total) AS line_total, sum(si.insurance_amount) AS insurance_amount
       FROM sale_items si JOIN products p ON p.id = si.product_id
      WHERE si.sale_id = $1 AND si.insurance_amount > 0
      GROUP BY p.id, p.name, p.strength, p.unit, si.unit_price, si.units_per_sale_unit ORDER BY min(si.id)`,
    [rows[0].sale_id],
  );
  const payments = await pool.query(
    `SELECT p.id, p.amount, p.paid_on, p.method, p.reference, p.created_at, u.full_name AS recorded_by_name
       FROM insurance_claim_payments p JOIN users u ON u.id = p.recorded_by WHERE p.claim_id = $1 ORDER BY p.paid_on, p.id`,
    [id],
  );
  return { ...rows[0], items: items.rows, payments: payments.rows };
}

export async function submitClaims(actor: Actor, claimIds: number[], submissionRef: string | null) {
  return withTransaction(async (tx) => {
    const { rows } = await tx.query(
      `SELECT c.id, c.claim_no, c.status, c.amount, s.name AS scheme_name FROM insurance_claims c JOIN insurance_schemes s ON s.id = c.scheme_id
        WHERE c.id = ANY($1::int[]) AND c.branch_id = $2 ORDER BY c.id FOR UPDATE OF c`,
      [claimIds, actor.branchId],
    );
    if (rows.length !== new Set(claimIds).size) throw notFound('Claim');
    const notPending = rows.filter((r) => r.status !== 'pending');
    if (notPending.length) throw unprocessable(`Only claims not yet submitted can be submitted (${notPending.map((r) => r.claim_no).join(', ')}).`);
    const schemes = new Set(rows.map((r) => r.scheme_name));
    if (schemes.size > 1) throw unprocessable('Submit claims for one insurance scheme at a time.');
    await tx.query(
      `UPDATE insurance_claims SET status = 'submitted', submitted_at = now(), submitted_by = $2, submission_ref = $3 WHERE id = ANY($1::int[])`,
      [claimIds, actor.userId, submissionRef],
    );
    const settings = await getSettings();
    const total = rows.reduce((a, r) => a + toCents(r.amount), 0);
    await audit(tx, actor, {
      action: 'claims_submitted', module: 'insurance', entityType: 'insurance_claim', entityId: rows[0].id,
      summary: `${actor.userName} submitted ${rows.length} ${[...schemes][0]} claim${rows.length === 1 ? '' : 's'} for ${formatMoney(fromCents(total), settings.general.currency)}${submissionRef ? ` (ref ${submissionRef})` : ''}`,
      newValues: { claims: rows.map((r) => r.claim_no), submissionRef },
    });
    return { submitted: rows.length };
  });
}

export async function recordClaimPayment(actor: Actor, id: number, d: { amount: number; paidOn: string; method: string; reference: string | null }) {
  const settings = await getSettings();
  const cur = settings.general.currency;
  return withTransaction(async (tx) => {
    const { rows } = await tx.query(`SELECT *, ${outstandingSql('insurance_claims')} AS outstanding FROM insurance_claims WHERE id = $1 AND branch_id = $2 FOR UPDATE`, [id, actor.branchId]);
    const claim = rows[0];
    if (!claim) throw notFound('Claim');
    if (claim.status === 'pending') throw unprocessable('Submit the claim before recording the insurer’s payment.');
    if (!['submitted', 'partially_paid'].includes(claim.status)) throw unprocessable(`Claim ${claim.claim_no} is closed.`);
    const amount = toCents(d.amount);
    if (amount > toCents(claim.outstanding)) throw unprocessable(`The claim has only ${formatMoney(claim.outstanding, cur)} outstanding.`);
    await tx.query(
      `INSERT INTO insurance_claim_payments (claim_id, amount, paid_on, method, reference, recorded_by) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, d.amount, d.paidOn, d.method, d.reference, actor.userId],
    );
    const fully = amount === toCents(claim.outstanding);
    await tx.query(
      `UPDATE insurance_claims SET amount_paid = amount_paid + $2, status = $3::varchar, closed_at = CASE WHEN $3::varchar = 'paid' THEN now() ELSE closed_at END WHERE id = $1`,
      [id, d.amount, fully ? 'paid' : 'partially_paid'],
    );
    await audit(tx, actor, {
      action: 'claim_payment', module: 'insurance', entityType: 'insurance_claim', entityId: id,
      summary: `${actor.userName} recorded ${formatMoney(d.amount, cur)} from the insurer on claim ${claim.claim_no}${d.reference ? ` (ref ${d.reference})` : ''}${fully ? ' — claim paid in full' : ''}`,
      newValues: d,
    });
    return { status: fully ? 'paid' : 'partially_paid' };
  });
}

/**
 * Closes a claim the insurer rejected or short-paid. The unpaid remainder is
 * either written off (a loss in the P&L) or added to the patient's account.
 */
export async function closeClaim(actor: Actor, id: number, d: { outcome: 'write_off' | 'bill_patient'; reason: string }) {
  const settings = await getSettings();
  const cur = settings.general.currency;
  return withTransaction(async (tx) => {
    const { rows } = await tx.query(`SELECT *, ${outstandingSql('insurance_claims')} AS outstanding FROM insurance_claims WHERE id = $1 AND branch_id = $2 FOR UPDATE`, [id, actor.branchId]);
    const claim = rows[0];
    if (!claim) throw notFound('Claim');
    if (!['pending', 'submitted', 'partially_paid'].includes(claim.status)) throw unprocessable(`Claim ${claim.claim_no} is already closed.`);
    const remaining = toCents(claim.outstanding);
    if (remaining <= 0) throw unprocessable('Nothing is outstanding on this claim.');
    const status = toCents(claim.amount_paid) > 0 ? 'closed' : 'rejected';
    if (d.outcome === 'bill_patient') {
      await tx.query('SELECT id FROM sales WHERE id = $1 FOR UPDATE', [claim.sale_id]);
      await tx.query(
        `UPDATE sales SET insurance_amount = insurance_amount - $2::numeric, balance_due = balance_due + $2::numeric,
                payment_status = CASE WHEN amount_paid > 0 THEN 'partial' ELSE 'unpaid' END WHERE id = $1`,
        [claim.sale_id, fromCents(remaining)],
      );
      await tx.query(`UPDATE insurance_claims SET billed_to_patient = billed_to_patient + $2, status = $3, closed_at = now(), close_reason = $4 WHERE id = $1`, [id, fromCents(remaining), status, d.reason]);
    } else {
      await tx.query(`UPDATE insurance_claims SET written_off = written_off + $2, status = $3, closed_at = now(), close_reason = $4 WHERE id = $1`, [id, fromCents(remaining), status, d.reason]);
    }
    await audit(tx, actor, {
      action: 'claim_closed', module: 'insurance', entityType: 'insurance_claim', entityId: id,
      summary: `${actor.userName} closed claim ${claim.claim_no}: ${formatMoney(fromCents(remaining), cur)} ${d.outcome === 'bill_patient' ? 'billed to the patient' : 'written off'} — ${d.reason}`,
      newValues: { outcome: CLAIM_SHORTFALL_OUTCOMES[d.outcome], amount: fromCents(remaining), reason: d.reason },
    });
    return { status };
  });
}

/** Creates the claim for the insurer's share of a sale (inside the sale transaction). */
export async function createClaimForSale(tx: Tx, at: Date, d: { schemeId: number; saleId: number; branchId: number; customerId: number; memberNo: string; amountCents: number }) {
  const claimNo = await nextDocumentNumber(tx, 'CLM', at);
  await tx.query(
    `INSERT INTO insurance_claims (claim_no, scheme_id, sale_id, branch_id, customer_id, member_no, amount, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [claimNo, d.schemeId, d.saleId, d.branchId, d.customerId, d.memberNo, fromCents(d.amountCents), at],
  );
  return claimNo;
}
