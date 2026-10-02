import type { MovementType } from '@dawa/shared';
import type { Tx } from '../db/pool';
import type { Actor } from './actor';
import { occurredAt } from './actor';
import { unprocessable } from './errors';

/**
 * Stock primitives. Every change to batch quantity goes through
 * `applyMovement`, which locks the batch row, enforces non-negative stock and
 * writes the matching append-only movement record.
 */

export interface MovementInput {
  batchId: number;
  /** Signed: positive adds stock, negative removes it. */
  quantity: number;
  type: MovementType;
  reason?: string | null;
  referenceType?: string | null;
  referenceId?: number | null;
  referenceNo?: string | null;
}

export interface MovementResult {
  productId: number;
  before: number;
  after: number;
  unitCost: number;
}

export async function applyMovement(tx: Tx, actor: Actor, m: MovementInput): Promise<MovementResult> {
  if (m.quantity === 0) throw unprocessable('Quantity must not be zero.');
  const { rows } = await tx.query(
    `SELECT b.id, b.product_id, b.branch_id, b.quantity_on_hand, b.unit_cost, p.name
       FROM product_batches b JOIN products p ON p.id = b.product_id
      WHERE b.id = $1 FOR UPDATE OF b`,
    [m.batchId],
  );
  const batch = rows[0];
  if (!batch) throw unprocessable('Batch not found.');
  if (batch.branch_id !== actor.branchId) throw unprocessable('This batch belongs to another branch.');
  const before = batch.quantity_on_hand as number;
  const after = before + m.quantity;
  if (after < 0) {
    throw unprocessable(`Not enough stock of ${batch.name}: ${before} available in this batch, ${-m.quantity} requested.`);
  }
  const at = occurredAt(actor);
  await tx.query(`UPDATE product_batches SET quantity_on_hand = $2, updated_at = $3 WHERE id = $1`, [m.batchId, after, at]);
  await tx.query(
    `INSERT INTO inventory_movements (branch_id, product_id, batch_id, movement_type, quantity, quantity_before, quantity_after,
                                      unit_cost, reason, reference_type, reference_id, reference_no, user_id, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      batch.branch_id, batch.product_id, m.batchId, m.type, m.quantity, before, after, batch.unit_cost,
      m.reason ?? null, m.referenceType ?? null, m.referenceId ?? null, m.referenceNo ?? null, actor.userId, at,
    ],
  );
  return { productId: batch.product_id, before, after, unitCost: Number(batch.unit_cost) };
}

export interface Allocation {
  batchId: number;
  batchNumber: string;
  expiryDate: string | null;
  quantity: number;
  unitCost: number;
  sellingPrice: number | null;
}

/** Condition for a batch that may be sold today. */
export const SELLABLE_BATCH_SQL = `b.status = 'active' AND b.quantity_on_hand > 0 AND (b.expiry_date IS NULL OR b.expiry_date >= $TODAY::date)`;

/**
 * First-Expired-First-Out allocation. Locks candidate batches so two tills
 * cannot sell the same units. Expired and quarantined batches are never used.
 */
export async function allocateFefo(
  tx: Tx,
  productId: number,
  branchId: number,
  quantity: number,
  today: string,
): Promise<Allocation[]> {
  const { rows } = await tx.query(
    `SELECT b.id, b.batch_number, b.expiry_date, b.quantity_on_hand, b.unit_cost, b.selling_price
       FROM product_batches b
      WHERE b.product_id = $1 AND b.branch_id = $2 AND ${SELLABLE_BATCH_SQL.replace('$TODAY', '$3')}
      ORDER BY b.expiry_date ASC NULLS LAST, b.received_at ASC, b.id ASC
      FOR UPDATE OF b`,
    [productId, branchId, today],
  );
  const allocations: Allocation[] = [];
  let remaining = quantity;
  for (const b of rows) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, b.quantity_on_hand);
    allocations.push({
      batchId: b.id,
      batchNumber: b.batch_number,
      expiryDate: b.expiry_date,
      quantity: take,
      unitCost: Number(b.unit_cost),
      sellingPrice: b.selling_price === null ? null : Number(b.selling_price),
    });
    remaining -= take;
  }
  if (remaining > 0) {
    const available = quantity - remaining;
    throw unprocessable(`Only ${available} unit(s) are available to sell (expired and quarantined stock excluded).`, {
      productId,
      available,
    });
  }
  return allocations;
}

/** Validates and locks a manually chosen batch for sale. */
export async function allocateChosenBatch(
  tx: Tx,
  productId: number,
  branchId: number,
  batchId: number,
  quantity: number,
  today: string,
): Promise<Allocation[]> {
  const { rows } = await tx.query(
    `SELECT b.id, b.batch_number, b.expiry_date, b.quantity_on_hand, b.unit_cost, b.selling_price, b.status
       FROM product_batches b WHERE b.id = $1 AND b.product_id = $2 AND b.branch_id = $3 FOR UPDATE`,
    [batchId, productId, branchId],
  );
  const b = rows[0];
  if (!b) throw unprocessable('The selected batch does not belong to this product.');
  if (b.status !== 'active') throw unprocessable(`Batch ${b.batch_number} is ${b.status} and cannot be sold.`);
  if (b.expiry_date && b.expiry_date < today) throw unprocessable(`Batch ${b.batch_number} expired on ${b.expiry_date} and cannot be sold.`);
  if (b.quantity_on_hand < quantity) throw unprocessable(`Batch ${b.batch_number} has only ${b.quantity_on_hand} unit(s).`);
  return [{
    batchId: b.id, batchNumber: b.batch_number, expiryDate: b.expiry_date, quantity,
    unitCost: Number(b.unit_cost), sellingPrice: b.selling_price === null ? null : Number(b.selling_price),
  }];
}

export interface BatchUpsert {
  productId: number;
  branchId: number;
  batchNumber: string;
  manufactureDate: string | null;
  expiryDate: string | null;
  unitCost: number;
  sellingPrice?: number | null;
  supplierId?: number | null;
}

/**
 * Finds or creates a batch for incoming stock. An existing batch number must
 * carry the same expiry; receiving more of it tops it up.
 */
export async function upsertBatch(tx: Tx, actor: Actor, b: BatchUpsert): Promise<number> {
  const { rows } = await tx.query(
    `SELECT id, expiry_date, status FROM product_batches WHERE product_id = $1 AND branch_id = $2 AND batch_number = $3 FOR UPDATE`,
    [b.productId, b.branchId, b.batchNumber],
  );
  const at = occurredAt(actor);
  if (rows[0]) {
    const existing = rows[0];
    if ((existing.expiry_date ?? null) !== (b.expiryDate ?? null)) {
      throw unprocessable(
        `Batch ${b.batchNumber} already exists with expiry ${existing.expiry_date ?? 'none'}. Check the batch number or expiry date.`,
      );
    }
    if (existing.status === 'disposed') throw unprocessable(`Batch ${b.batchNumber} was disposed and cannot receive stock.`);
    return existing.id;
  }
  const inserted = await tx.query(
    `INSERT INTO product_batches (product_id, branch_id, batch_number, manufacture_date, expiry_date, unit_cost, selling_price,
                                  supplier_id, received_at, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$9) RETURNING id`,
    [b.productId, b.branchId, b.batchNumber, b.manufactureDate, b.expiryDate, b.unitCost.toFixed(2),
     b.sellingPrice ? b.sellingPrice.toFixed(2) : null, b.supplierId ?? null, at],
  );
  return inserted.rows[0].id;
}

/** Receives stock into a batch: increments received + on-hand and records the movement. */
export async function receiveIntoBatch(
  tx: Tx,
  actor: Actor,
  batchId: number,
  quantity: number,
  type: 'purchase' | 'opening',
  ref: { referenceType?: string; referenceId?: number; referenceNo?: string; reason?: string },
) {
  await tx.query(`UPDATE product_batches SET quantity_received = quantity_received + $2 WHERE id = $1`, [batchId, quantity]);
  return applyMovement(tx, actor, { batchId, quantity, type, ...ref });
}

/** Internal batch number used for products whose stock is not batch-tracked. */
export const UNTRACKED_BATCH = 'NO-BATCH';
