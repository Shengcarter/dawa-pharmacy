import { addDays, formatMoney, fromCents, PO_STATUSES, toCents, type PurchaseOrderStatus } from '@dawa/shared';
import { pool, withTransaction, type Tx } from '../../db/pool';
import { can, occurredAt, type Actor } from '../../lib/actor';
import { audit } from '../../lib/audit';
import { forbidden, notFound, unprocessable } from '../../lib/errors';
import { likeParam, pageParams, paginated } from '../../lib/pagination';
import { nextDocumentNumber } from '../../lib/sequences';
import { receiveIntoBatch, upsertBatch, UNTRACKED_BATCH } from '../../lib/stock';
import { businessToday } from '../../lib/today';
import { getSettings } from '../settings/service';

interface PoItemInput {
  productId: number;
  quantity: number;
  unitCost: number;
  discount: number;
  taxRate: number;
}

/** Purchase prices are tax-exclusive: line = qty × cost − discount; tax on top. */
function computePoLines(items: PoItemInput[]) {
  const lines = items.map((i) => {
    const gross = i.quantity * toCents(i.unitCost);
    const discount = toCents(i.discount);
    const net = gross - discount;
    const tax = Math.round((net * i.taxRate) / 100);
    return { ...i, gross, discountCents: discount, taxCents: tax, totalCents: net + tax };
  });
  const sum = (k: 'gross' | 'discountCents' | 'taxCents' | 'totalCents') => lines.reduce((a, l) => a + l[k], 0);
  return { lines, subtotal: sum('gross'), discount: sum('discountCents'), tax: sum('taxCents'), total: sum('totalCents') };
}

export async function listPurchaseOrders(
  actor: Actor,
  q: { page: number; pageSize: number; search?: string; status?: string; supplierId?: number; from?: string | null; to?: string | null },
) {
  const params: unknown[] = [actor.branchId];
  const where = ['po.branch_id = $1'];
  const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replace('$?', `$${params.length}`)); };
  if (q.search) {
    params.push(likeParam(q.search));
    where.push(`(po.po_number ILIKE $${params.length} OR s.name ILIKE $${params.length})`);
  }
  if (q.status) add('po.status = $?', q.status);
  if (q.supplierId) add('po.supplier_id = $?', q.supplierId);
  if (q.from) add('po.order_date >= $?::date', q.from);
  if (q.to) add('po.order_date <= $?::date', q.to);
  const { limit, offset } = pageParams(q.page, q.pageSize);
  const { rows } = await pool.query(
    `SELECT po.id, po.po_number, po.status, po.order_date, po.expected_date, po.total, po.created_at,
            s.id AS supplier_id, s.name AS supplier_name, u.full_name AS created_by_name,
            (SELECT count(*)::int FROM purchase_order_items i WHERE i.purchase_order_id = po.id) AS item_count,
            (SELECT COALESCE(sum(i.quantity_received)::float / NULLIF(sum(i.quantity_ordered), 0), 0) FROM purchase_order_items i WHERE i.purchase_order_id = po.id) AS received_ratio,
            count(*) OVER() AS total_count
       FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id JOIN users u ON u.id = po.created_by
      WHERE ${where.join(' AND ')} ORDER BY po.order_date DESC, po.id DESC LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  return paginated(rows.map(({ total_count: _t, ...r }) => r), rows[0]?.total_count ?? 0, q.page, q.pageSize);
}

export async function getPurchaseOrder(actor: Actor, id: number) {
  const { rows } = await pool.query(
    `SELECT po.*, s.name AS supplier_name, s.phone AS supplier_phone, s.email AS supplier_email, s.address AS supplier_address,
            s.payment_terms_days, cu.full_name AS created_by_name, au.full_name AS approved_by_name
       FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id JOIN users cu ON cu.id = po.created_by
       LEFT JOIN users au ON au.id = po.approved_by
      WHERE po.id = $1 AND po.branch_id = $2`,
    [id, actor.branchId],
  );
  if (!rows[0]) throw notFound('Purchase order');
  const items = await pool.query(
    `SELECT i.*, p.name AS product_name, p.sku, p.unit, p.pack_size, p.is_batch_tracked, p.selling_price AS current_selling_price
       FROM purchase_order_items i JOIN products p ON p.id = i.product_id WHERE i.purchase_order_id = $1 ORDER BY i.id`,
    [id],
  );
  const receipts = await pool.query(
    `SELECT g.id, g.grn_number, g.received_date, g.total_cost, u.full_name AS received_by_name
       FROM goods_receipts g JOIN users u ON u.id = g.received_by WHERE g.purchase_order_id = $1 ORDER BY g.id`,
    [id],
  );
  return { ...rows[0], items: items.rows, receipts: receipts.rows };
}

async function writeItems(tx: Tx, poId: number, items: PoItemInput[]) {
  const ids = items.map((i) => i.productId);
  const found = await tx.query(`SELECT id FROM products WHERE id = ANY($1::int[])`, [ids]);
  if (found.rowCount !== new Set(ids).size) throw unprocessable('One of the products no longer exists.');
  const calc = computePoLines(items);
  await tx.query('DELETE FROM purchase_order_items WHERE purchase_order_id = $1', [poId]);
  for (const l of calc.lines) {
    await tx.query(
      `INSERT INTO purchase_order_items (purchase_order_id, product_id, quantity_ordered, unit_cost, discount_amount, tax_rate, tax_amount, line_total)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [poId, l.productId, l.quantity, l.unitCost, fromCents(l.discountCents), l.taxRate, fromCents(l.taxCents), fromCents(l.totalCents)],
    );
  }
  await tx.query(
    `UPDATE purchase_orders SET subtotal=$2, discount_total=$3, tax_total=$4, total=$5, updated_at=now() WHERE id=$1`,
    [poId, fromCents(calc.subtotal), fromCents(calc.discount), fromCents(calc.tax), fromCents(calc.total)],
  );
  return calc;
}

async function assertSupplier(tx: Tx, supplierId: number) {
  const s = await tx.query(`SELECT name, status FROM suppliers WHERE id = $1`, [supplierId]);
  if (!s.rows[0]) throw unprocessable('Supplier not found.');
  if (s.rows[0].status !== 'active') throw unprocessable(`${s.rows[0].name} is inactive.`);
  return s.rows[0].name as string;
}

export async function createPurchaseOrder(
  actor: Actor,
  d: { supplierId: number; orderDate: string; expectedDate: string | null; notes: string | null; items: PoItemInput[] },
) {
  const settings = await getSettings();
  return withTransaction(async (tx) => {
    const supplierName = await assertSupplier(tx, d.supplierId);
    const at = occurredAt(actor);
    const poNumber = await nextDocumentNumber(tx, 'PO', at);
    const { rows } = await tx.query(
      `INSERT INTO purchase_orders (po_number, branch_id, supplier_id, order_date, expected_date, notes, created_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING id`,
      [poNumber, actor.branchId, d.supplierId, d.orderDate, d.expectedDate, d.notes, actor.userId, at],
    );
    const calc = await writeItems(tx, rows[0].id, d.items);
    await audit(tx, actor, {
      action: 'create', module: 'purchasing', entityType: 'purchase_order', entityId: rows[0].id,
      summary: `${actor.userName} created purchase order ${poNumber} for ${supplierName} (${formatMoney(fromCents(calc.total), settings.general.currency)})`,
    });
    return { id: rows[0].id, poNumber };
  });
}

export async function updatePurchaseOrder(
  actor: Actor,
  id: number,
  d: { supplierId: number; orderDate: string; expectedDate: string | null; notes: string | null; items: PoItemInput[] },
) {
  return withTransaction(async (tx) => {
    const { rows } = await tx.query('SELECT * FROM purchase_orders WHERE id = $1 AND branch_id = $2 FOR UPDATE', [id, actor.branchId]);
    const po = rows[0];
    if (!po) throw notFound('Purchase order');
    if (!['draft', 'pending'].includes(po.status)) throw unprocessable(`A ${PO_STATUSES[po.status as PurchaseOrderStatus].toLowerCase()} order cannot be edited.`);
    await assertSupplier(tx, d.supplierId);
    await tx.query(
      `UPDATE purchase_orders SET supplier_id=$2, order_date=$3, expected_date=$4, notes=$5, updated_at=now() WHERE id=$1`,
      [id, d.supplierId, d.orderDate, d.expectedDate, d.notes],
    );
    await writeItems(tx, id, d.items);
    await audit(tx, actor, { action: 'update', module: 'purchasing', entityType: 'purchase_order', entityId: id, summary: `${actor.userName} edited purchase order ${po.po_number}` });
    return { id };
  });
}

const TRANSITIONS: Record<string, { from: PurchaseOrderStatus[]; to: PurchaseOrderStatus; permission: 'purchasing.manage' | 'purchasing.approve'; verb: string }> = {
  submit: { from: ['draft'], to: 'pending', permission: 'purchasing.manage', verb: 'submitted for approval' },
  approve: { from: ['draft', 'pending'], to: 'ordered', permission: 'purchasing.approve', verb: 'approved and placed' },
  cancel: { from: ['draft', 'pending', 'ordered'], to: 'cancelled', permission: 'purchasing.manage', verb: 'cancelled' },
  reopen: { from: ['cancelled'], to: 'draft', permission: 'purchasing.manage', verb: 'reopened' },
};

export async function transitionPurchaseOrder(actor: Actor, id: number, action: keyof typeof TRANSITIONS, reason: string | null) {
  const t = TRANSITIONS[action];
  if (!can(actor, t.permission)) throw forbidden();
  return withTransaction(async (tx) => {
    const { rows } = await tx.query('SELECT * FROM purchase_orders WHERE id = $1 AND branch_id = $2 FOR UPDATE', [id, actor.branchId]);
    const po = rows[0];
    if (!po) throw notFound('Purchase order');
    if (!t.from.includes(po.status)) {
      throw unprocessable(`Cannot ${action} an order that is ${PO_STATUSES[po.status as PurchaseOrderStatus].toLowerCase()}.`);
    }
    if (action === 'cancel') {
      if (!reason) throw unprocessable('Give a reason for cancelling.');
      const received = await tx.query('SELECT 1 FROM goods_receipts WHERE purchase_order_id = $1 LIMIT 1', [id]);
      if (received.rowCount) throw unprocessable('Stock has already been received against this order.');
    }
    const at = occurredAt(actor);
    await tx.query(
      `UPDATE purchase_orders SET status = $2, updated_at = $3,
              submitted_at = CASE WHEN $2 = 'pending' THEN $3 ELSE submitted_at END,
              approved_by = CASE WHEN $2 = 'ordered' THEN $4 ELSE approved_by END,
              approved_at = CASE WHEN $2 = 'ordered' THEN $3 ELSE approved_at END,
              cancelled_reason = CASE WHEN $2 = 'cancelled' THEN $5 ELSE cancelled_reason END
        WHERE id = $1`,
      [id, t.to, at, actor.userId, reason],
    );
    await audit(tx, actor, {
      action: `po_${action}`, module: 'purchasing', entityType: 'purchase_order', entityId: id,
      summary: `${actor.userName} ${t.verb} purchase order ${po.po_number}${reason ? `: ${reason}` : ''}`,
      oldValues: { status: po.status }, newValues: { status: t.to },
    });
    return { id, status: t.to };
  });
}

interface ReceiveLine {
  purchaseOrderItemId: number | null;
  productId: number;
  batchNumber: string;
  manufactureDate: string | null;
  expiryDate: string | null;
  quantity: number;
  unitCost: number;
  sellingPrice: number | null;
}

/**
 * Receives stock. Every line creates or tops up a batch (with expiry), writes
 * a purchase movement, updates last cost, and advances the purchase order.
 */
export async function receiveGoods(
  actor: Actor,
  d: {
    purchaseOrderId: number | null;
    supplierId: number;
    supplierInvoiceNo: string | null;
    receivedDate: string;
    notes: string | null;
    updateSellingPrices: boolean;
    items: ReceiveLine[];
  },
) {
  const settings = await getSettings();
  const today = await businessToday(actor);
  const cur = settings.general.currency;
  if (d.receivedDate > today) throw unprocessable('Received date cannot be in the future.');
  if (d.updateSellingPrices && !can(actor, 'products.manage_prices')) throw forbidden('You do not have permission to change selling prices.');
  return withTransaction(async (tx) => {
    const supplier = await tx.query('SELECT id, name, payment_terms_days FROM suppliers WHERE id = $1', [d.supplierId]);
    if (!supplier.rows[0]) throw unprocessable('Supplier not found.');
    let po: { id: number; po_number: string; status: string; supplier_id: number } | null = null;
    const poItems = new Map<number, { id: number; product_id: number; quantity_ordered: number; quantity_received: number }>();
    if (d.purchaseOrderId) {
      const r = await tx.query('SELECT * FROM purchase_orders WHERE id = $1 AND branch_id = $2 FOR UPDATE', [d.purchaseOrderId, actor.branchId]);
      po = r.rows[0] ?? null;
      if (!po) throw notFound('Purchase order');
      if (po.supplier_id !== d.supplierId) throw unprocessable('Supplier does not match the purchase order.');
      if (!['ordered', 'partially_received'].includes(po.status)) {
        throw unprocessable(`Purchase order ${po.po_number} is ${PO_STATUSES[po.status as PurchaseOrderStatus].toLowerCase()}; only placed orders can be received.`);
      }
      const items = await tx.query('SELECT * FROM purchase_order_items WHERE purchase_order_id = $1 FOR UPDATE', [po.id]);
      for (const i of items.rows) poItems.set(i.id, i);
    }
    const productIds = [...new Set(d.items.map((i) => i.productId))];
    const products = await tx.query(
      `SELECT id, name, is_batch_tracked, purchase_price, selling_price, min_selling_price FROM products WHERE id = ANY($1::int[])`,
      [productIds],
    );
    const productMap = new Map(products.rows.map((p) => [p.id as number, p]));
    const at = occurredAt(actor);
    const grnNumber = await nextDocumentNumber(tx, 'GRN', at);
    const totalCents = d.items.reduce((a, i) => a + i.quantity * toCents(i.unitCost), 0);
    const grn = await tx.query(
      `INSERT INTO goods_receipts (grn_number, branch_id, purchase_order_id, supplier_id, supplier_invoice_no, received_date, due_date,
                                   total_cost, notes, received_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [grnNumber, actor.branchId, po?.id ?? null, d.supplierId, d.supplierInvoiceNo, d.receivedDate,
       addDays(d.receivedDate, supplier.rows[0].payment_terms_days), fromCents(totalCents), d.notes, actor.userId, at],
    );
    const grnId = grn.rows[0].id as number;
    const receivedPerPoItem = new Map<number, number>();

    for (const [index, line] of d.items.entries()) {
      const product = productMap.get(line.productId);
      if (!product) throw unprocessable(`Line ${index + 1}: product not found.`);
      if (product.is_batch_tracked && !line.expiryDate) throw unprocessable(`Line ${index + 1} (${product.name}): expiry date is required.`);
      if (line.expiryDate && line.expiryDate <= d.receivedDate) {
        throw unprocessable(`Line ${index + 1} (${product.name}): batch ${line.batchNumber} is already expired. Do not receive expired stock.`);
      }
      if (line.purchaseOrderItemId) {
        const poItem = poItems.get(line.purchaseOrderItemId);
        if (!poItem || poItem.product_id !== line.productId) throw unprocessable(`Line ${index + 1}: does not match the purchase order.`);
        const already = poItem.quantity_received + (receivedPerPoItem.get(poItem.id) ?? 0);
        if (already + line.quantity > poItem.quantity_ordered) {
          throw unprocessable(`Line ${index + 1} (${product.name}): receiving ${line.quantity} exceeds the ${poItem.quantity_ordered - already} still outstanding on the order.`);
        }
        receivedPerPoItem.set(poItem.id, (receivedPerPoItem.get(poItem.id) ?? 0) + line.quantity);
      }

      const batchNumber = product.is_batch_tracked ? line.batchNumber : UNTRACKED_BATCH;
      const batchId = await upsertBatch(tx, actor, {
        productId: line.productId,
        branchId: actor.branchId,
        batchNumber,
        manufactureDate: line.manufactureDate,
        expiryDate: product.is_batch_tracked ? line.expiryDate : null,
        unitCost: line.unitCost,
        sellingPrice: line.sellingPrice,
        supplierId: d.supplierId,
      });
      if (!product.is_batch_tracked) {
        // One running batch: keep its cost as the weighted average so COGS stays true.
        await tx.query(
          `UPDATE product_batches SET unit_cost = CASE WHEN quantity_on_hand + $2 = 0 THEN $3
                 ELSE round((quantity_on_hand * unit_cost + $2 * $3) / (quantity_on_hand + $2), 2) END
            WHERE id = $1`,
          [batchId, line.quantity, line.unitCost],
        );
      }
      await receiveIntoBatch(tx, actor, batchId, line.quantity, 'purchase', {
        referenceType: 'goods_receipt', referenceId: grnId, referenceNo: grnNumber,
        reason: `Received from ${supplier.rows[0].name}`,
      });
      await tx.query(
        `INSERT INTO goods_receipt_items (goods_receipt_id, purchase_order_item_id, product_id, batch_id, quantity, unit_cost, selling_price, line_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [grnId, line.purchaseOrderItemId, line.productId, batchId, line.quantity, line.unitCost, line.sellingPrice,
         fromCents(line.quantity * toCents(line.unitCost))],
      );
      await tx.query(
        `INSERT INTO supplier_products (supplier_id, product_id, last_cost, last_supplied_at) VALUES ($1,$2,$3,$4)
         ON CONFLICT (supplier_id, product_id) DO UPDATE SET last_cost = EXCLUDED.last_cost, last_supplied_at = EXCLUDED.last_supplied_at`,
        [d.supplierId, line.productId, line.unitCost, at],
      );
      if (Number(product.purchase_price) !== line.unitCost) {
        await tx.query('UPDATE products SET purchase_price = $2, updated_at = now() WHERE id = $1', [line.productId, line.unitCost]);
        await audit(tx, actor, {
          action: 'price_change', module: 'products', entityType: 'product', entityId: line.productId,
          summary: `Purchase price of ${product.name} changed from ${formatMoney(product.purchase_price, cur)} to ${formatMoney(line.unitCost, cur)} on receipt ${grnNumber}`,
          oldValues: { purchasePrice: Number(product.purchase_price) }, newValues: { purchasePrice: line.unitCost },
        });
        product.purchase_price = line.unitCost;
      }
      if (d.updateSellingPrices && line.sellingPrice && Number(product.selling_price) !== line.sellingPrice) {
        if (product.min_selling_price !== null && line.sellingPrice < Number(product.min_selling_price)) {
          throw unprocessable(`${product.name}: new selling price is below its minimum selling price.`);
        }
        await tx.query('UPDATE products SET selling_price = $2, updated_at = now(), updated_by = $3 WHERE id = $1', [line.productId, line.sellingPrice, actor.userId]);
        await audit(tx, actor, {
          action: 'price_change', module: 'products', entityType: 'product', entityId: line.productId,
          summary: `${actor.userName} changed selling price of ${product.name} from ${formatMoney(product.selling_price, cur)} to ${formatMoney(line.sellingPrice, cur)} on receipt ${grnNumber}`,
          oldValues: { sellingPrice: Number(product.selling_price) }, newValues: { sellingPrice: line.sellingPrice },
        });
        product.selling_price = line.sellingPrice;
      }
    }

    if (po) {
      for (const [itemId, qty] of receivedPerPoItem) {
        await tx.query('UPDATE purchase_order_items SET quantity_received = quantity_received + $2 WHERE id = $1', [itemId, qty]);
      }
      const status = await tx.query(
        `SELECT bool_and(quantity_received >= quantity_ordered) AS complete FROM purchase_order_items WHERE purchase_order_id = $1`,
        [po.id],
      );
      const next = status.rows[0].complete ? 'received' : 'partially_received';
      await tx.query('UPDATE purchase_orders SET status = $2, updated_at = now() WHERE id = $1', [po.id, next]);
    }

    await audit(tx, actor, {
      action: 'receive', module: 'purchasing', entityType: 'goods_receipt', entityId: grnId,
      summary: `${actor.userName} received ${d.items.length} line(s) from ${supplier.rows[0].name} on ${grnNumber}${po ? ` against ${po.po_number}` : ''} (${formatMoney(fromCents(totalCents), cur)})`,
      newValues: { grnNumber, total: fromCents(totalCents), supplierInvoiceNo: d.supplierInvoiceNo },
    });
    return { id: grnId, grnNumber };
  });
}

export async function listGoodsReceipts(
  actor: Actor,
  q: { page: number; pageSize: number; search?: string; supplierId?: number; from?: string | null; to?: string | null },
) {
  const params: unknown[] = [actor.branchId];
  const where = ['g.branch_id = $1'];
  if (q.search) {
    params.push(likeParam(q.search));
    where.push(`(g.grn_number ILIKE $${params.length} OR s.name ILIKE $${params.length} OR g.supplier_invoice_no ILIKE $${params.length} OR po.po_number ILIKE $${params.length})`);
  }
  if (q.supplierId) { params.push(q.supplierId); where.push(`g.supplier_id = $${params.length}`); }
  if (q.from) { params.push(q.from); where.push(`g.received_date >= $${params.length}::date`); }
  if (q.to) { params.push(q.to); where.push(`g.received_date <= $${params.length}::date`); }
  const { limit, offset } = pageParams(q.page, q.pageSize);
  const { rows } = await pool.query(
    `SELECT g.id, g.grn_number, g.received_date, g.due_date, g.total_cost, g.supplier_invoice_no, s.id AS supplier_id, s.name AS supplier_name,
            po.id AS purchase_order_id, po.po_number, u.full_name AS received_by_name,
            (SELECT count(*)::int FROM goods_receipt_items i WHERE i.goods_receipt_id = g.id) AS line_count,
            COALESCE((SELECT sum(amount) FROM supplier_payments sp WHERE sp.goods_receipt_id = g.id), 0) AS paid,
            count(*) OVER() AS total_count
       FROM goods_receipts g JOIN suppliers s ON s.id = g.supplier_id LEFT JOIN purchase_orders po ON po.id = g.purchase_order_id
       JOIN users u ON u.id = g.received_by
      WHERE ${where.join(' AND ')} ORDER BY g.received_date DESC, g.id DESC LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  return paginated(rows.map(({ total_count: _t, ...r }) => r), rows[0]?.total_count ?? 0, q.page, q.pageSize);
}

export async function getGoodsReceipt(actor: Actor, id: number) {
  const { rows } = await pool.query(
    `SELECT g.*, s.name AS supplier_name, po.po_number, u.full_name AS received_by_name
       FROM goods_receipts g JOIN suppliers s ON s.id = g.supplier_id LEFT JOIN purchase_orders po ON po.id = g.purchase_order_id
       JOIN users u ON u.id = g.received_by WHERE g.id = $1 AND g.branch_id = $2`,
    [id, actor.branchId],
  );
  if (!rows[0]) throw notFound('Goods receipt');
  const items = await pool.query(
    `SELECT i.*, p.name AS product_name, p.sku, p.unit, b.batch_number, b.expiry_date, b.manufacture_date
       FROM goods_receipt_items i JOIN products p ON p.id = i.product_id JOIN product_batches b ON b.id = i.batch_id
      WHERE i.goods_receipt_id = $1 ORDER BY i.id`,
    [id],
  );
  return { ...rows[0], items: items.rows };
}

/** Suggested reorder list: products at or below reorder level, with last supplier and cost. */
export async function reorderSuggestions(actor: Actor, supplierId?: number) {
  const today = await businessToday();
  const params: unknown[] = [actor.branchId, today];
  let supplierFilter = '';
  if (supplierId) { params.push(supplierId); supplierFilter = `AND p.default_supplier_id = $3`; }
  const { rows } = await pool.query(
    `SELECT p.id, p.sku, p.name, p.unit, p.pack_size, p.reorder_level, p.max_stock_level, p.purchase_price, p.default_supplier_id,
            sup.name AS supplier_name, s.sellable,
            GREATEST(COALESCE(NULLIF(p.max_stock_level, 0), p.reorder_level * 2) - s.sellable, p.pack_size) AS suggested_quantity,
            EXISTS (SELECT 1 FROM purchase_order_items i JOIN purchase_orders po ON po.id = i.purchase_order_id
                     WHERE i.product_id = p.id AND po.status IN ('draft','pending','ordered','partially_received')) AS on_open_order
       FROM products p
       LEFT JOIN suppliers sup ON sup.id = p.default_supplier_id
       LEFT JOIN LATERAL (
         SELECT COALESCE(sum(b.quantity_on_hand), 0)::int AS sellable FROM product_batches b
          WHERE b.product_id = p.id AND b.branch_id = $1 AND b.status = 'active' AND (b.expiry_date IS NULL OR b.expiry_date >= $2::date)
       ) s ON TRUE
      WHERE p.status = 'active' AND s.sellable <= p.reorder_level ${supplierFilter}
      ORDER BY (s.sellable::float / NULLIF(p.reorder_level, 0)) ASC NULLS LAST, p.name
      LIMIT 200`,
    params,
  );
  return rows;
}
