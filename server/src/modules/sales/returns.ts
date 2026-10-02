import { formatMoney, fromCents, RETURN_REASONS, toCents, type RefundMethod, type ReturnReason } from '@dawa/shared';
import { pool, withTransaction } from '../../db/pool';
import { can, occurredAt, type Actor } from '../../lib/actor';
import { audit } from '../../lib/audit';
import { forbidden, notFound, unprocessable } from '../../lib/errors';
import { likeParam, pageParams, paginated } from '../../lib/pagination';
import { nextDocumentNumber } from '../../lib/sequences';
import { applyMovement } from '../../lib/stock';
import { businessToday } from '../../lib/today';
import { getSettings } from '../settings/service';
import { refreshProductAlerts } from '../notifications/service';
import { recomputePrescriptionStatus } from '../prescriptions/service';
import { logger } from '../../lib/logger';

interface ReturnInput {
  saleId: number;
  reason: ReturnReason;
  refundMethod: RefundMethod;
  notes: string | null;
  items: { saleItemId: number; quantity: number; condition: 'resellable' | 'damaged' | 'opened' }[];
}

/**
 * Processes a customer return. Resellable, unexpired units go back into
 * their original batch; refunds first clear any unpaid balance on the
 * invoice, and the rest is paid out (or held as store credit).
 */
export async function processReturn(actor: Actor, d: ReturnInput) {
  const settings = await getSettings();
  const cur = settings.general.currency;
  const today = await businessToday(actor);
  const result = await withTransaction(async (tx) => {
    const { rows } = await tx.query('SELECT * FROM sales WHERE id = $1 AND branch_id = $2 FOR UPDATE', [d.saleId, actor.branchId]);
    const sale = rows[0];
    if (!sale) throw notFound('Sale');
    if (sale.status === 'returned') throw unprocessable(`Everything on ${sale.invoice_no} has already been returned.`);
    if (d.refundMethod === 'store_credit' && !sale.customer_id) throw unprocessable('Store credit needs a customer on the invoice.');

    const ids = d.items.map((i) => i.saleItemId);
    if (new Set(ids).size !== ids.length) throw unprocessable('Each line can appear only once.');
    const itemRows = await tx.query(
      `SELECT si.*, p.name AS product_name, b.batch_number, b.expiry_date, b.status AS batch_status,
              COALESCE((SELECT sum(ri.total_amount) FROM sale_return_items ri WHERE ri.sale_item_id = si.id), 0) AS refunded_total,
              COALESCE((SELECT sum(ri.net_amount) FROM sale_return_items ri WHERE ri.sale_item_id = si.id), 0) AS refunded_net,
              COALESCE((SELECT sum(ri.tax_amount) FROM sale_return_items ri WHERE ri.sale_item_id = si.id), 0) AS refunded_tax,
              COALESCE((SELECT sum(ri.insurance_amount) FROM sale_return_items ri WHERE ri.sale_item_id = si.id), 0) AS refunded_insurance
         FROM sale_items si JOIN products p ON p.id = si.product_id JOIN product_batches b ON b.id = si.batch_id
        WHERE si.sale_id = $1 AND si.id = ANY($2::int[]) FOR UPDATE OF si`,
      [sale.id, ids],
    );
    if (itemRows.rowCount !== ids.length) throw unprocessable('A selected line does not belong to this invoice.');
    const byId = new Map(itemRows.rows.map((r) => [r.id as number, r]));

    const at = occurredAt(actor);
    const returnNo = await nextDocumentNumber(tx, 'RET', at);
    const lines = d.items.map((input) => {
      const item = byId.get(input.saleItemId)!;
      const remaining = item.quantity - item.quantity_returned;
      if (input.quantity > remaining) {
        throw unprocessable(`${item.product_name}: only ${remaining} unit(s) can still be returned.`);
      }
      // Pro-rata share of the line; the final return of a line takes the exact remainder.
      const share = (field: 'line_total' | 'net_amount' | 'tax_amount' | 'insurance_amount', refunded: number) =>
        input.quantity === remaining
          ? toCents(item[field]) - toCents(refunded)
          : Math.round((toCents(item[field]) * input.quantity) / item.quantity);
      const totalCents = share('line_total', item.refunded_total);
      const netCents = share('net_amount', item.refunded_net);
      const taxCents = share('tax_amount', item.refunded_tax);
      // The insurer's part of the line comes off the claim, not out of the till.
      const insuranceCents = share('insurance_amount', item.refunded_insurance);
      const expired = item.expiry_date !== null && item.expiry_date < today;
      const restock = input.condition === 'resellable' && !expired && item.batch_status !== 'disposed';
      return { input, item, totalCents, netCents, taxCents, insuranceCents, restock };
    });

    const insuranceCents = lines.reduce((a, l) => a + l.insuranceCents, 0);
    let claim: { id: number; claim_no: string; status: string; amount: number } | null = null;
    if (insuranceCents > 0) {
      const c = await tx.query('SELECT id, claim_no, status, amount FROM insurance_claims WHERE sale_id = $1 FOR UPDATE', [sale.id]);
      claim = c.rows[0] ?? null;
      if (claim && claim.status !== 'pending') {
        throw unprocessable(`Insurance claim ${claim.claim_no} has already been submitted, so lines it covers cannot be returned here. Settle the return with the insurer, or return only lines the patient paid for in full.`);
      }
    }

    const totalCents = lines.reduce((a, l) => a + l.totalCents, 0);
    const netCents = lines.reduce((a, l) => a + l.netCents, 0);
    const taxCents = lines.reduce((a, l) => a + l.taxCents, 0);
    const patientCents = totalCents - insuranceCents;
    const balanceCents = toCents(sale.balance_due);
    const balanceReduction = Math.min(patientCents, balanceCents);
    const refundCents = patientCents - balanceReduction;
    const costRestocked = lines.filter((l) => l.restock).reduce((a, l) => a + l.input.quantity * toCents(l.item.unit_cost), 0);

    const ret = await tx.query(
      `INSERT INTO sale_returns (return_no, sale_id, branch_id, customer_id, reason, refund_method, total_amount, net_amount, tax_amount,
                                 balance_reduction, refund_amount, cost_restocked, notes, processed_by, created_at, insurance_amount)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
      [returnNo, sale.id, actor.branchId, sale.customer_id, d.reason, d.refundMethod, fromCents(totalCents), fromCents(netCents),
       fromCents(taxCents), fromCents(balanceReduction), fromCents(refundCents), fromCents(costRestocked), d.notes, actor.userId, at, fromCents(insuranceCents)],
    );
    const returnId = ret.rows[0].id as number;

    const rxItemsTouched = new Map<number, number>();
    for (const l of lines) {
      await tx.query(
        `INSERT INTO sale_return_items (return_id, sale_item_id, product_id, batch_id, quantity, net_amount, tax_amount, total_amount,
                                        unit_cost, condition, restocked, insurance_amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [returnId, l.item.id, l.item.product_id, l.item.batch_id, l.input.quantity, fromCents(l.netCents), fromCents(l.taxCents),
         fromCents(l.totalCents), l.item.unit_cost, l.input.condition, l.restock, fromCents(l.insuranceCents)],
      );
      await tx.query('UPDATE sale_items SET quantity_returned = quantity_returned + $2 WHERE id = $1', [l.item.id, l.input.quantity]);
      if (l.restock) {
        await applyMovement(tx, actor, {
          batchId: l.item.batch_id, quantity: l.input.quantity, type: 'sale_return',
          reason: `Customer return: ${RETURN_REASONS[d.reason]}`,
          referenceType: 'sale_return', referenceId: returnId, referenceNo: returnNo,
        });
      }
      if (l.item.prescription_item_id) {
        rxItemsTouched.set(l.item.prescription_item_id, (rxItemsTouched.get(l.item.prescription_item_id) ?? 0) + l.input.quantity);
      }
    }

    for (const [rxItemId, qty] of rxItemsTouched) {
      await tx.query('UPDATE prescription_items SET quantity_dispensed = GREATEST(quantity_dispensed - $2, 0) WHERE id = $1', [rxItemId, qty]);
    }
    if (sale.prescription_id && rxItemsTouched.size) await recomputePrescriptionStatus(tx, sale.prescription_id);

    if (d.refundMethod === 'store_credit' && refundCents > 0) {
      await tx.query('UPDATE customers SET store_credit_balance = store_credit_balance + $2 WHERE id = $1', [sale.customer_id, fromCents(refundCents)]);
    }

    if (insuranceCents > 0) {
      await tx.query('UPDATE sales SET insurance_amount = insurance_amount - $2::numeric WHERE id = $1', [sale.id, fromCents(insuranceCents)]);
      if (claim) {
        await tx.query(
          `UPDATE insurance_claims SET amount = amount - $2::numeric, status = CASE WHEN amount - $2::numeric = 0 THEN 'cancelled' ELSE status END,
                  closed_at = CASE WHEN amount - $2::numeric = 0 THEN now() ELSE closed_at END WHERE id = $1`,
          [claim.id, fromCents(insuranceCents)],
        );
      }
    }

    const left = await tx.query('SELECT bool_and(quantity_returned = quantity) AS all_returned FROM sale_items WHERE sale_id = $1', [sale.id]);
    const newBalance = balanceCents - balanceReduction;
    await tx.query(
      `UPDATE sales SET status = $2, balance_due = $3::numeric, payment_status = CASE WHEN $3::numeric = 0 THEN 'paid' ELSE payment_status END WHERE id = $1`,
      [sale.id, left.rows[0].all_returned ? 'returned' : 'partially_returned', fromCents(newBalance)],
    );

    const restockedSummary = lines.filter((l) => l.restock).map((l) => `${l.input.quantity} × ${l.item.product_name}`);
    await audit(tx, actor, {
      action: 'return', module: 'sales', entityType: 'sale', entityId: sale.id,
      summary: `${actor.userName} processed return ${returnNo} on ${sale.invoice_no}: ${formatMoney(fromCents(totalCents), cur)} (${RETURN_REASONS[d.reason]})${refundCents > 0 ? `, refunded ${formatMoney(fromCents(refundCents), cur)} by ${d.refundMethod.replace('_', ' ')}` : ''}${balanceReduction > 0 ? `, balance reduced by ${formatMoney(fromCents(balanceReduction), cur)}` : ''}${insuranceCents > 0 ? `, ${formatMoney(fromCents(insuranceCents), cur)} taken off ${claim ? `claim ${claim.claim_no}` : 'the insurance claim'}` : ''}${restockedSummary.length ? `; restocked ${restockedSummary.join(', ')}` : '; nothing restocked'}`,
      newValues: { returnNo, total: fromCents(totalCents), refund: fromCents(refundCents), refundMethod: d.refundMethod },
    });
    return { id: returnId, returnNo, refundAmount: fromCents(refundCents), balanceReduction: fromCents(balanceReduction), productIds: lines.map((l) => l.item.product_id) };
  });
  if (!actor.occurredAt) {
    refreshProductAlerts(actor.branchId, result.productIds).catch((err) => logger.warn({ err }, 'Alert refresh failed'));
  }
  const { productIds: _p, ...response } = result;
  return response;
}

export async function listReturns(actor: Actor, q: { page: number; pageSize: number; search?: string; from?: string | null; to?: string | null }) {
  const tz = (await getSettings()).general.timezone;
  const params: unknown[] = [actor.branchId];
  const where = ['r.branch_id = $1'];
  let tzIndex = 0;
  const localDay = () => `(r.created_at AT TIME ZONE $${(tzIndex ||= params.push(tz))})::date`;
  if (!can(actor, 'sales.view_all')) { params.push(actor.userId); where.push(`r.processed_by = $${params.length}`); }
  if (q.search) { params.push(likeParam(q.search)); where.push(`(r.return_no ILIKE $${params.length} OR s.invoice_no ILIKE $${params.length} OR c.full_name ILIKE $${params.length})`); }
  if (q.from) { const day = localDay(); params.push(q.from); where.push(`${day} >= $${params.length}::date`); }
  if (q.to) { const day = localDay(); params.push(q.to); where.push(`${day} <= $${params.length}::date`); }
  const { limit, offset } = pageParams(q.page, q.pageSize);
  const { rows } = await pool.query(
    `SELECT r.id, r.return_no, r.created_at, r.reason, r.refund_method, r.total_amount, r.refund_amount, r.balance_reduction,
            s.id AS sale_id, s.invoice_no, c.full_name AS customer_name, u.full_name AS processed_by_name,
            (SELECT sum(quantity)::int FROM sale_return_items ri WHERE ri.return_id = r.id) AS units,
            (SELECT bool_or(restocked) FROM sale_return_items ri WHERE ri.return_id = r.id) AS any_restocked,
            count(*) OVER() AS total_count
       FROM sale_returns r JOIN sales s ON s.id = r.sale_id LEFT JOIN customers c ON c.id = r.customer_id JOIN users u ON u.id = r.processed_by
      WHERE ${where.join(' AND ')} ORDER BY r.created_at DESC, r.id DESC LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  return paginated(rows.map(({ total_count: _t, ...r }) => r), rows[0]?.total_count ?? 0, q.page, q.pageSize);
}

export async function getReturn(actor: Actor, id: number) {
  const { rows } = await pool.query(
    `SELECT r.*, s.invoice_no, c.full_name AS customer_name, u.full_name AS processed_by_name
       FROM sale_returns r JOIN sales s ON s.id = r.sale_id LEFT JOIN customers c ON c.id = r.customer_id JOIN users u ON u.id = r.processed_by
      WHERE r.id = $1 AND r.branch_id = $2`,
    [id, actor.branchId],
  );
  if (!rows[0]) throw notFound('Return');
  if (!can(actor, 'sales.view_all') && rows[0].processed_by !== actor.userId) throw forbidden();
  const items = await pool.query(
    `SELECT ri.*, p.name AS product_name, p.sku, b.batch_number FROM sale_return_items ri
       JOIN products p ON p.id = ri.product_id JOIN product_batches b ON b.id = ri.batch_id WHERE ri.return_id = $1 ORDER BY ri.id`,
    [id],
  );
  return { ...rows[0], items: items.rows };
}
