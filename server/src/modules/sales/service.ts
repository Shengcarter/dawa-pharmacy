import { randomBytes } from 'node:crypto';
import {
  allocateCents, computeCart, formatMoney, fromCents, resolvePrice, toCents, type PaymentMethod, type PriceBreak,
} from '@dawa/shared';
import type { z } from 'zod';
import type { saleSchema } from '@dawa/shared';
import { pool, withTransaction, type Tx } from '../../db/pool';
import { can, occurredAt, type Actor } from '../../lib/actor';
import { audit } from '../../lib/audit';
import { AppError, forbidden, notFound, unprocessable } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { likeParam, pageParams, paginated } from '../../lib/pagination';
import { nextDocumentNumber } from '../../lib/sequences';
import { allocateChosenBatch, allocateFefo, applyMovement, type Allocation } from '../../lib/stock';
import { businessToday } from '../../lib/today';
import { getSettings } from '../settings/service';
import { refreshProductAlerts, raiseNotification } from '../notifications/service';
import { recomputePrescriptionStatus } from '../prescriptions/service';

type SaleData = z.output<typeof saleSchema>;

interface ProductRow {
  id: number;
  name: string;
  sku: string;
  status: string;
  selling_price: number;
  min_selling_price: number | null;
  pack_size: number;
  pack_selling_price: number | null;
  wholesale_price: number | null;
  price_breaks: PriceBreak[];
  tax_rate: number;
  requires_prescription: boolean;
}

interface RxItemRow {
  id: number;
  product_id: number;
  quantity: number;
  refills_allowed: number;
  quantity_dispensed: number;
}

/**
 * Completes a sale in one transaction:
 * validate prices/discounts/prescriptions → allocate batches FEFO → write
 * sale, lines, payments, stock movements, dispensing records and audit.
 */
export async function createSale(actor: Actor, input: SaleData) {
  if (input.idempotencyKey) {
    const existing = await pool.query('SELECT id, invoice_no FROM sales WHERE idempotency_key = $1', [input.idempotencyKey]);
    if (existing.rows[0]) return { id: existing.rows[0].id as number, invoiceNo: existing.rows[0].invoice_no as string, duplicate: true };
  }
  try {
    const result = await withTransaction((tx) => createSaleTx(tx, actor, input));
    // Back-dated (seed/import) sales skip live alert refresh; alerts are recomputed afterwards.
    if (!actor.occurredAt) {
      refreshProductAlerts(actor.branchId, result.productIds).catch((err) => logger.warn({ err }, 'Alert refresh failed'));
    }
    return { id: result.id, invoiceNo: result.invoiceNo, duplicate: false };
  } catch (err) {
    if (!(err instanceof AppError) && !(err as { code?: string }).code?.startsWith('23')) {
      await raiseNotification({
        type: 'sale_failed',
        severity: 'critical',
        title: 'A sale failed to complete',
        message: `${actor.userName}'s sale could not be saved because of a system error. No stock or money was recorded.`,
        link: '/sales',
        audiencePermission: 'sales.view_all',
      }).catch(() => undefined);
    }
    throw err;
  }
}

async function createSaleTx(tx: Tx, actor: Actor, input: SaleData) {
  const settings = await getSettings();
  const cur = settings.general.currency;
  const today = await businessToday(actor);
  const at = occurredAt(actor);

  // ---- Products -----------------------------------------------------------
  const productIds = [...new Set(input.items.map((i) => i.productId))];
  const { rows: productRows } = await tx.query<ProductRow>(
    `SELECT id, name, sku, status, selling_price, min_selling_price, pack_size, pack_selling_price, wholesale_price, tax_rate, requires_prescription,
            (SELECT COALESCE(json_agg(json_build_object('minQuantity', pb.min_quantity, 'unitPrice', pb.unit_price::float8)), '[]')
               FROM product_price_breaks pb WHERE pb.product_id = products.id) AS price_breaks
       FROM products WHERE id = ANY($1::int[]) FOR SHARE`,
    [productIds],
  );
  const products = new Map(productRows.map((p) => [p.id, p]));
  for (const item of input.items) {
    const p = products.get(item.productId);
    if (!p) throw unprocessable('A product in the cart no longer exists.');
    if (p.status !== 'active') throw unprocessable(`${p.name} is ${p.status} and cannot be sold.`);
    if (item.sellBy === 'pack' && (p.pack_selling_price === null || p.pack_size < 2)) {
      throw unprocessable(`${p.name} is not sold by the pack.`);
    }
  }

  // ---- Customer -----------------------------------------------------------
  let customerId = input.customerId;
  let customer: { id: number; full_name: string; status: string; customer_type: string; credit_limit: number; store_credit_balance: number } | null = null;

  // ---- Prescription -------------------------------------------------------
  let prescription: { id: number; rx_number: string; customer_id: number; status: string; valid_until: string | null } | null = null;
  const rxItems = new Map<number, RxItemRow>();
  if (input.prescriptionId) {
    if (!can(actor, 'prescriptions.dispense')) throw forbidden('You do not have permission to dispense prescriptions.');
    const r = await tx.query(
      'SELECT id, rx_number, customer_id, status, valid_until FROM prescriptions WHERE id = $1 AND branch_id = $2 FOR UPDATE',
      [input.prescriptionId, actor.branchId],
    );
    prescription = r.rows[0] ?? null;
    if (!prescription) throw notFound('Prescription');
    if (prescription.status === 'cancelled') throw unprocessable(`Prescription ${prescription.rx_number} was cancelled.`);
    if (prescription.status === 'dispensed') throw unprocessable(`Prescription ${prescription.rx_number} has been fully dispensed.`);
    if (prescription.valid_until && prescription.valid_until < today) throw unprocessable(`Prescription ${prescription.rx_number} expired on ${prescription.valid_until}.`);
    if (customerId && customerId !== prescription.customer_id) throw unprocessable('The prescription belongs to a different patient.');
    customerId = prescription.customer_id;
    const items = await tx.query<RxItemRow>(
      'SELECT id, product_id, quantity, refills_allowed, quantity_dispensed FROM prescription_items WHERE prescription_id = $1 FOR UPDATE',
      [prescription.id],
    );
    for (const i of items.rows) rxItems.set(i.product_id, i);
  }
  if (customerId) {
    const r = await tx.query(
      'SELECT id, full_name, status, customer_type, credit_limit, store_credit_balance FROM customers WHERE id = $1 FOR UPDATE',
      [customerId],
    );
    customer = r.rows[0] ?? null;
    if (!customer) throw notFound('Customer');
    if (customer.status !== 'active') throw unprocessable(`${customer.full_name}'s account is inactive.`);
  }

  // ---- Merge duplicate cart lines (same product + same batch choice) -------
  const merged = new Map<string, (typeof input.items)[number]>();
  for (const item of input.items) {
    const key = `${item.productId}:${item.sellBy}:${item.batchId ?? 'fefo'}:${item.unitPrice ?? ''}`;
    const prev = merged.get(key);
    if (prev) merged.set(key, { ...prev, quantity: prev.quantity + item.quantity, discount: prev.discount + item.discount });
    else merged.set(key, { ...item });
  }
  // Consistent lock order (by product, then batch) avoids deadlocks between tills.
  const lines = [...merged.values()]
    .sort((a, b) => a.productId - b.productId || (a.batchId ?? 0) - (b.batchId ?? 0))
    .map((l) => {
      // quantity counts sold units (single units or whole packs); baseQuantity is what leaves the shelf.
      const unitsPer = l.sellBy === 'pack' ? products.get(l.productId)!.pack_size : 1;
      return { ...l, unitsPer, baseQuantity: l.quantity * unitsPer };
    });

  // ---- Prices, discounts and prescription rules ---------------------------
  // Quantity prices look at the product's total base units in the cart.
  const productBase = new Map<number, number>();
  for (const l of lines) productBase.set(l.productId, (productBase.get(l.productId) ?? 0) + l.baseQuantity);
  const wholesaleCustomer = customer?.customer_type === 'wholesale';
  const priced = lines.map((l) => {
    const p = products.get(l.productId)!;
    const list = resolvePrice(
      {
        sellingPrice: Number(p.selling_price), packSize: p.pack_size, packSellingPrice: p.pack_selling_price === null ? null : Number(p.pack_selling_price),
        wholesalePrice: p.wholesale_price === null ? null : Number(p.wholesale_price), priceBreaks: p.price_breaks,
      },
      { sellBy: l.sellBy, productBaseQuantity: productBase.get(l.productId)!, wholesaleCustomer },
    );
    const unitPrice = l.unitPrice ?? list.price;
    const manual = toCents(unitPrice) !== toCents(list.price);
    if (manual && !can(actor, 'pos.discount_override')) {
      throw forbidden(`You cannot change the price of ${p.name}.`);
    }
    return { listPrice: list.price, source: manual ? ('manual' as const) : list.source, unitPrice };
  });
  const cartInput = lines.map((l, i) => {
    const p = products.get(l.productId)!;
    return { quantity: l.quantity, unitPriceCents: toCents(priced[i].unitPrice), discountCents: toCents(l.discount), taxRate: Number(p.tax_rate) };
  });
  const totals = computeCart(cartInput, toCents(input.cartDiscount), settings.sales.taxInclusive);
  if (totals.discountCents > 0 && !can(actor, 'pos.discount') && !can(actor, 'pos.discount_override')) {
    throw forbidden('You do not have permission to give discounts.');
  }
  lines.forEach((l, i) => {
    const p = products.get(l.productId)!;
    const t = totals.lines[i];
    const pct = t.grossCents > 0 ? (t.discountCents / t.grossCents) * 100 : 0;
    if (pct > settings.sales.maxDiscountPercent + 1e-9 && !can(actor, 'pos.discount_override')) {
      throw forbidden(`Discount on ${p.name} is ${pct.toFixed(1)}%, above your limit of ${settings.sales.maxDiscountPercent}%.`);
    }
    const effectiveUnit = (t.grossCents - t.discountCents) / l.baseQuantity;
    // A price rule the manager set (wholesale, quantity, pack) may itself sit below the minimum; only discounts below it are blocked.
    const floor = p.min_selling_price === null ? null : Math.min(toCents(p.min_selling_price), toCents(priced[i].listPrice) / l.unitsPer);
    if (floor !== null && effectiveUnit < floor - 1e-9 && !can(actor, 'pos.discount_override')) {
      throw forbidden(`${p.name} cannot be sold below its minimum price of ${formatMoney(p.min_selling_price, cur)}.`);
    }
  });

  const rxQuantities = new Map<number, number>();
  for (const l of lines) rxQuantities.set(l.productId, (rxQuantities.get(l.productId) ?? 0) + l.baseQuantity);
  for (const [productId, qty] of rxQuantities) {
    const p = products.get(productId)!;
    const rxItem = rxItems.get(productId);
    if (p.requires_prescription && settings.sales.requirePrescriptionForRx) {
      if (!prescription) throw unprocessable(`${p.name} is prescription-only. Attach the patient's prescription to sell it.`);
      if (!rxItem) throw unprocessable(`${p.name} is not on prescription ${prescription.rx_number}.`);
      if (!can(actor, 'prescriptions.dispense')) throw forbidden('Only a pharmacist can dispense prescription-only medicines.');
    }
    if (rxItem) {
      const remaining = rxItem.quantity * (rxItem.refills_allowed + 1) - rxItem.quantity_dispensed;
      if (qty > remaining) throw unprocessable(`Prescription allows ${remaining} more of ${p.name}; ${qty} in the cart.`);
    }
  }

  // ---- Payments -----------------------------------------------------------
  const totalCents = totals.totalCents;
  const payments = input.payments.map((p) => ({ ...p, cents: toCents(p.amount) }));
  const paidCents = payments.reduce((a, p) => a + p.cents, 0);
  if (paidCents > totalCents) throw unprocessable('Payments add up to more than the sale total. Enter the cash handed over as "cash tendered" instead.');
  const storeCreditCents = payments.filter((p) => p.method === 'store_credit').reduce((a, p) => a + p.cents, 0);
  if (storeCreditCents > 0) {
    if (!customer) throw unprocessable('Select the customer to pay with store credit.');
    if (storeCreditCents > toCents(customer.store_credit_balance)) {
      throw unprocessable(`${customer.full_name} has only ${formatMoney(customer.store_credit_balance, cur)} store credit.`);
    }
  }
  const balanceCents = totalCents - paidCents;
  if (balanceCents > 0) {
    if (!input.onCredit) throw unprocessable(`Payment is short by ${formatMoney(fromCents(balanceCents), cur)}.`);
    if (!settings.sales.allowCreditSales) throw unprocessable('Credit sales are switched off in Settings.');
    if (!can(actor, 'pos.credit_sale')) throw forbidden('You do not have permission to sell on credit.');
    if (!customer) throw unprocessable('Select the customer who will owe the balance.');
    if (toCents(customer.credit_limit) <= 0) throw unprocessable(`${customer.full_name} has no credit limit set. A manager can set one on the customer record.`);
    const owing = await tx.query('SELECT COALESCE(sum(balance_due), 0) AS owing FROM sales WHERE customer_id = $1', [customer.id]);
    const newOwing = toCents(owing.rows[0].owing) + balanceCents;
    if (newOwing > toCents(customer.credit_limit)) {
      throw unprocessable(
        `This would take ${customer.full_name}'s balance to ${formatMoney(fromCents(newOwing), cur)}, over their limit of ${formatMoney(customer.credit_limit, cur)}.`,
      );
    }
  }
  const cashCents = payments.filter((p) => p.method === 'cash').reduce((a, p) => a + p.cents, 0);
  let changeCents: number | null = null;
  if (input.cashTendered !== null && cashCents > 0) {
    const tendered = toCents(input.cashTendered);
    if (tendered < cashCents) throw unprocessable('Cash tendered is less than the cash amount.');
    changeCents = tendered - cashCents;
  }
  const methods = new Set(payments.map((p) => p.method));
  const paymentType =
    payments.length === 0 ? 'credit' : methods.size === 1 && balanceCents === 0 ? [...methods][0] : 'split';
  const paymentStatus = balanceCents === 0 ? 'paid' : paidCents > 0 ? 'partial' : 'unpaid';

  // ---- Batch allocation (FEFO unless a batch was chosen) -------------------
  const allocations: Allocation[][] = [];
  for (const l of lines) {
    allocations.push(
      l.batchId
        ? await allocateChosenBatch(tx, l.productId, actor.branchId, l.batchId, l.baseQuantity, today)
        : await allocateFefo(tx, l.productId, actor.branchId, l.baseQuantity, today),
    );
  }

  // ---- Write the sale -----------------------------------------------------
  const invoiceNo = await nextDocumentNumber(tx, 'INV', at);
  const costCents = allocations.flat().reduce((a, x) => a + x.quantity * toCents(x.unitCost), 0);
  const sale = await tx.query(
    `INSERT INTO sales (invoice_no, branch_id, customer_id, prescription_id, cashier_id, status, payment_type, payment_status,
                        subtotal, discount_total, tax_total, total, amount_paid, balance_due, cost_total, tax_inclusive,
                        cash_tendered, change_given, notes, receipt_token, idempotency_key, created_at)
     VALUES ($1,$2,$3,$4,$5,'completed',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING id`,
    [
      invoiceNo, actor.branchId, customer?.id ?? null, prescription?.id ?? null, actor.userId, paymentType, paymentStatus,
      fromCents(totals.subtotalCents), fromCents(totals.discountCents), fromCents(totals.taxCents), fromCents(totalCents),
      fromCents(paidCents), fromCents(balanceCents), fromCents(costCents), settings.sales.taxInclusive,
      input.cashTendered, changeCents === null ? null : fromCents(changeCents), input.notes,
      randomBytes(16).toString('hex'), input.idempotencyKey, at,
    ],
  );
  const saleId = sale.rows[0].id as number;

  for (const [i, l] of lines.entries()) {
    const t = totals.lines[i];
    const parts = allocations[i];
    const weights = parts.map((p) => p.quantity);
    const discount = allocateCents(t.discountCents, weights);
    const tax = allocateCents(t.taxCents, weights);
    const net = allocateCents(t.netCents, weights);
    const total = allocateCents(t.totalCents, weights);
    const rxItem = rxItems.get(l.productId) ?? null;
    for (const [j, part] of parts.entries()) {
      await tx.query(
        `INSERT INTO sale_items (sale_id, product_id, batch_id, quantity, unit_price, discount_amount, tax_rate, net_amount, tax_amount,
                                 line_total, unit_cost, prescription_item_id, units_per_sale_unit, price_source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [saleId, l.productId, part.batchId, part.quantity, fromCents(cartInput[i].unitPriceCents), fromCents(discount[j]),
         cartInput[i].taxRate, fromCents(net[j]), fromCents(tax[j]), fromCents(total[j]), part.unitCost, rxItem?.id ?? null, l.unitsPer, priced[i].source],
      );
      await applyMovement(tx, actor, {
        batchId: part.batchId, quantity: -part.quantity, type: 'sale',
        referenceType: 'sale', referenceId: saleId, referenceNo: invoiceNo,
      });
    }
  }

  for (const p of payments) {
    const paymentNo = await nextDocumentNumber(tx, 'PAY', at);
    await tx.query(
      `INSERT INTO payments (payment_no, sale_id, customer_id, method, amount, reference, received_by, received_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [paymentNo, saleId, customer?.id ?? null, p.method, fromCents(p.cents), p.reference, actor.userId, at],
    );
  }
  if (storeCreditCents > 0 && customer) {
    await tx.query('UPDATE customers SET store_credit_balance = store_credit_balance - $2 WHERE id = $1', [customer.id, fromCents(storeCreditCents)]);
  }

  if (prescription) {
    for (const [productId, qty] of rxQuantities) {
      const rxItem = rxItems.get(productId);
      if (!rxItem) continue;
      await tx.query('UPDATE prescription_items SET quantity_dispensed = quantity_dispensed + $2 WHERE id = $1', [rxItem.id, qty]);
      await tx.query(
        `INSERT INTO prescription_dispensings (prescription_id, prescription_item_id, sale_id, quantity, dispensed_by, dispensed_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [prescription.id, rxItem.id, saleId, qty, actor.userId, at],
      );
    }
    await recomputePrescriptionStatus(tx, prescription.id);
  }

  await audit(tx, actor, {
    action: 'sale', module: 'sales', entityType: 'sale', entityId: saleId,
    summary: `${actor.userName} completed sale ${invoiceNo} for ${formatMoney(fromCents(totalCents), cur)}${customer ? ` to ${customer.full_name}` : ''}${balanceCents > 0 ? ` (${formatMoney(fromCents(balanceCents), cur)} on credit)` : ''}${totals.discountCents > 0 ? `, discount ${formatMoney(fromCents(totals.discountCents), cur)}` : ''}`,
    newValues: { invoiceNo, total: fromCents(totalCents), paymentType, prescription: prescription?.rx_number ?? null },
  });
  return { id: saleId, invoiceNo, productIds };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------
export interface SaleListQuery {
  page: number;
  pageSize: number;
  search?: string;
  from?: string | null;
  to?: string | null;
  cashierId?: number;
  customerId?: number;
  paymentStatus?: string;
  paymentType?: string;
  status?: string;
}

export async function listSales(actor: Actor, q: SaleListQuery) {
  const tz = (await getSettings()).general.timezone;
  const params: unknown[] = [actor.branchId];
  const where = ['s.branch_id = $1'];
  const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replaceAll('$?', `$${params.length}`)); };
  let tzIndex = 0;
  const localDay = () => `(s.created_at AT TIME ZONE $${(tzIndex ||= params.push(tz))})::date`;
  if (!can(actor, 'sales.view_all')) add('s.cashier_id = $?', actor.userId);
  else if (q.cashierId) add('s.cashier_id = $?', q.cashierId);
  if (q.search) add('(s.invoice_no ILIKE $? OR c.full_name ILIKE $? OR c.phone ILIKE $?)', likeParam(q.search));
  if (q.from) { const day = localDay(); add(`${day} >= $?::date`, q.from); }
  if (q.to) { const day = localDay(); add(`${day} <= $?::date`, q.to); }
  if (q.customerId) add('s.customer_id = $?', q.customerId);
  if (q.paymentStatus) add('s.payment_status = $?', q.paymentStatus);
  if (q.paymentType) add('s.payment_type = $?', q.paymentType);
  if (q.status) add('s.status = $?', q.status);
  const { limit, offset } = pageParams(q.page, q.pageSize);
  const { rows } = await pool.query(
    `SELECT s.id, s.invoice_no, s.created_at, s.total, s.discount_total, s.tax_total, s.amount_paid, s.balance_due, s.payment_type,
            s.payment_status, s.status, c.id AS customer_id, c.full_name AS customer_name, u.full_name AS cashier_name,
            (SELECT COALESCE(sum(quantity), 0)::int FROM sale_items si WHERE si.sale_id = s.id) AS units,
            count(*) OVER() AS total_count, sum(s.total) OVER() AS sum_total
       FROM sales s LEFT JOIN customers c ON c.id = s.customer_id JOIN users u ON u.id = s.cashier_id
      WHERE ${where.join(' AND ')} ORDER BY s.created_at DESC, s.id DESC LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  return {
    ...paginated(rows.map(({ total_count: _t, sum_total: _s, ...r }) => r), rows[0]?.total_count ?? 0, q.page, q.pageSize),
    sumTotal: Number(rows[0]?.sum_total ?? 0),
  };
}

export async function getSale(actor: Actor, id: number) {
  const { rows } = await pool.query(
    `SELECT s.*, c.full_name AS customer_name, c.phone AS customer_phone, c.code AS customer_code, u.full_name AS cashier_name,
            rx.rx_number
       FROM sales s LEFT JOIN customers c ON c.id = s.customer_id JOIN users u ON u.id = s.cashier_id
       LEFT JOIN prescriptions rx ON rx.id = s.prescription_id
      WHERE s.id = $1 AND s.branch_id = $2`,
    [id, actor.branchId],
  );
  const sale = rows[0];
  if (!sale) throw notFound('Sale');
  if (!can(actor, 'sales.view_all') && sale.cashier_id !== actor.userId) throw forbidden('You can only view your own sales.');
  const [items, payments, returns] = await Promise.all([
    pool.query(
      `SELECT si.id, si.product_id, si.batch_id, si.quantity, si.quantity_returned, si.unit_price, si.units_per_sale_unit, si.price_source, p.pack_size, si.discount_amount, si.tax_rate,
              si.net_amount, si.tax_amount, si.line_total, si.unit_cost, p.name AS product_name, p.sku, p.unit, p.strength,
              b.batch_number, b.expiry_date
         FROM sale_items si JOIN products p ON p.id = si.product_id JOIN product_batches b ON b.id = si.batch_id
        WHERE si.sale_id = $1 ORDER BY si.id`,
      [id],
    ),
    pool.query(
      `SELECT p.id, p.payment_no, p.method, p.amount, p.reference, p.received_at, u.full_name AS received_by_name
         FROM payments p JOIN users u ON u.id = p.received_by WHERE p.sale_id = $1 ORDER BY p.received_at, p.id`,
      [id],
    ),
    pool.query(
      `SELECT r.id, r.return_no, r.reason, r.refund_method, r.total_amount, r.refund_amount, r.balance_reduction, r.created_at,
              u.full_name AS processed_by_name
         FROM sale_returns r JOIN users u ON u.id = r.processed_by WHERE r.sale_id = $1 ORDER BY r.created_at`,
      [id],
    ),
  ]);
  const showCost = can(actor, 'reports.financial');
  if (!showCost) delete sale.cost_total;
  return {
    ...sale,
    items: items.rows.map((i) => (showCost ? i : { ...i, unit_cost: undefined })),
    payments: payments.rows,
    returns: returns.rows,
  };
}

/** Receipt payload: the sale plus the pharmacy header from settings. */
export async function receiptData(actor: Actor, id: number) {
  const settings = await getSettings();
  const sale = await getSale(actor, id);
  return { sale, pharmacy: receiptHeader(settings) };
}

function receiptHeader(settings: Awaited<ReturnType<typeof getSettings>>) {
  return {
    name: settings.general.pharmacyName,
    address: settings.general.address,
    phone: settings.general.phone,
    email: settings.general.email,
    tin: settings.sales.showTinOnReceipt ? settings.general.tin : null,
    vrn: settings.sales.showTinOnReceipt ? settings.general.vrn : null,
    logoPath: settings.general.logoPath,
    currency: settings.general.currency,
    timezone: settings.general.timezone,
    footer: settings.sales.receiptFooter,
    paper: settings.sales.receiptPaper,
  };
}

/** Digital receipt by unguessable token: no customer contact details. */
export async function publicReceipt(token: string) {
  if (!/^[a-f0-9]{32}$/.test(token)) throw notFound('Receipt');
  const settings = await getSettings();
  const { rows } = await pool.query(
    `SELECT s.id, s.invoice_no, s.created_at, s.subtotal, s.discount_total, s.tax_total, s.total, s.amount_paid, s.balance_due,
            s.payment_type, s.tax_inclusive, s.cash_tendered, s.change_given, s.status, u.full_name AS cashier_name,
            c.full_name AS customer_name
       FROM sales s JOIN users u ON u.id = s.cashier_id LEFT JOIN customers c ON c.id = s.customer_id
      WHERE s.receipt_token = $1`,
    [token],
  );
  if (!rows[0]) throw notFound('Receipt');
  const items = await pool.query(
    `SELECT p.name AS product_name, p.strength, sum(si.quantity)::int AS quantity, si.unit_price, si.units_per_sale_unit,
            sum(si.discount_amount) AS discount_amount, sum(si.line_total) AS line_total
       FROM sale_items si JOIN products p ON p.id = si.product_id WHERE si.sale_id = $1
      GROUP BY p.id, p.name, p.strength, si.unit_price, si.units_per_sale_unit ORDER BY min(si.id)`,
    [rows[0].id],
  );
  const payments = await pool.query('SELECT method, amount FROM payments WHERE sale_id = $1 ORDER BY id', [rows[0].id]);
  const { id: _id, ...sale } = rows[0];
  return { sale: { ...sale, items: items.rows, payments: payments.rows }, pharmacy: receiptHeader(settings) };
}

// ---------------------------------------------------------------------------
// Payments against credit sales
// ---------------------------------------------------------------------------
export async function recordPayment(
  actor: Actor,
  saleId: number,
  d: { method: Exclude<PaymentMethod, 'store_credit'>; amount: number; reference: string | null; notes: string | null },
) {
  const settings = await getSettings();
  return withTransaction(async (tx) => {
    const { rows } = await tx.query('SELECT * FROM sales WHERE id = $1 AND branch_id = $2 FOR UPDATE', [saleId, actor.branchId]);
    const sale = rows[0];
    if (!sale) throw notFound('Sale');
    const amount = toCents(d.amount);
    const balance = toCents(sale.balance_due);
    if (balance === 0) throw unprocessable('This invoice is already fully paid.');
    if (amount > balance) throw unprocessable(`Payment exceeds the balance of ${formatMoney(sale.balance_due, settings.general.currency)}.`);
    const at = occurredAt(actor);
    const paymentNo = await nextDocumentNumber(tx, 'PAY', at);
    await tx.query(
      `INSERT INTO payments (payment_no, sale_id, customer_id, method, amount, reference, notes, received_by, received_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [paymentNo, saleId, sale.customer_id, d.method, fromCents(amount), d.reference, d.notes, actor.userId, at],
    );
    const newBalance = balance - amount;
    await tx.query(
      `UPDATE sales SET amount_paid = amount_paid + $2, balance_due = $3, payment_status = $4 WHERE id = $1`,
      [saleId, fromCents(amount), fromCents(newBalance), newBalance === 0 ? 'paid' : 'partial'],
    );
    await audit(tx, actor, {
      action: 'payment', module: 'sales', entityType: 'sale', entityId: saleId,
      summary: `${actor.userName} received ${formatMoney(fromCents(amount), settings.general.currency)} (${d.method}) against ${sale.invoice_no}; balance now ${formatMoney(fromCents(newBalance), settings.general.currency)}`,
      oldValues: { balanceDue: fromCents(balance) }, newValues: { balanceDue: fromCents(newBalance), paymentNo },
    });
    return { paymentNo, balanceDue: fromCents(newBalance) };
  });
}
