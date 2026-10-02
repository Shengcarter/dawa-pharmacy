import { beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import { ean13CheckDigit } from '@dawa/shared';
import { addDays, batchQty, cashSale, makeProduct, makeSupplier, prepare, receive, today, userWithRole, type Client } from './helpers';

describe('purchasing, receiving and stock control', () => {
  let admin: Client;
  let inventory: Client;
  let supplierId: number;
  beforeAll(async () => {
    await prepare();
    admin = await userWithRole('super_admin');
    inventory = await userWithRole('inventory_officer');
    supplierId = await makeSupplier(admin);
  });

  it('runs a purchase order through approval, partial and full receipt, creating batches', async () => {
    const productId = await makeProduct(admin);
    const po = await inventory.post('/api/purchasing/orders', {
      supplierId, orderDate: today(), items: [{ productId, quantity: 100, unitCost: 5500, discount: 5000, taxRate: 0 }],
    });
    expect(po.status).toBe(201);
    const detail = (await inventory.get(`/api/purchasing/orders/${po.body.id}`)).body;
    expect(Number(detail.total)).toBe(545000);
    // Cannot receive before it is placed.
    const item = detail.items[0];
    const receipt = (qty: number, batch: string) => inventory.post('/api/purchasing/receipts', {
      purchaseOrderId: po.body.id, supplierId, receivedDate: today(),
      items: [{ purchaseOrderItemId: item.id, productId, batchNumber: batch, expiryDate: addDays(today(), 500), quantity: qty, unitCost: 5500 }],
    });
    expect((await receipt(10, 'X1')).status).toBe(422);
    await inventory.post(`/api/purchasing/orders/${po.body.id}/transition`, { action: 'submit' });
    await admin.post(`/api/purchasing/orders/${po.body.id}/transition`, { action: 'approve' });
    expect((await receipt(60, `A-${productId}`)).status).toBe(201);
    expect((await inventory.get(`/api/purchasing/orders/${po.body.id}`)).body.status).toBe('partially_received');
    expect((await receipt(41, `B-${productId}`)).status).toBe(422); // over-receipt
    expect((await receipt(40, `B-${productId}`)).status).toBe(201);
    expect((await inventory.get(`/api/purchasing/orders/${po.body.id}`)).body.status).toBe('received');
    const batches = await pool.query('SELECT batch_number, quantity_on_hand FROM product_batches WHERE product_id = $1 ORDER BY id', [productId]);
    expect(batches.rows).toEqual([
      { batch_number: `A-${productId}`, quantity_on_hand: 60 },
      { batch_number: `B-${productId}`, quantity_on_hand: 40 },
    ]);
    const supplier = (await admin.get(`/api/suppliers/${supplierId}`)).body;
    expect(Number(supplier.outstanding)).toBeGreaterThanOrEqual(550000);
  });

  it('refuses expired deliveries and requires expiry for batch-tracked products', async () => {
    const productId = await makeProduct(admin);
    const post = (expiryDate: string | null) => inventory.post('/api/purchasing/receipts', {
      supplierId, receivedDate: today(), items: [{ productId, batchNumber: `E-${productId}`, expiryDate, quantity: 5, unitCost: 100 }],
    });
    expect((await post(addDays(today(), -3))).status).toBe(422);
    expect((await post(null)).status).toBe(422);
  });

  it('records adjustments with reasons, and a count correction sets the counted quantity', async () => {
    const productId = await makeProduct(admin);
    const batchId = await receive(admin, supplierId, productId, `ADJ-${productId}`, 20, addDays(today(), 300));
    const damaged = await inventory.post('/api/inventory/adjustments', { batchId, type: 'damaged', quantity: 5, reason: 'Water damage' });
    expect(damaged.status).toBe(201);
    expect(await batchQty(batchId)).toBe(15);
    expect((await inventory.post('/api/inventory/adjustments', { batchId, type: 'adjustment_out', quantity: 16, reason: 'x' })).status).toBe(422);
    expect((await inventory.post('/api/inventory/adjustments', { batchId, type: 'expired', quantity: 1, reason: 'x' })).status).toBe(422);
    await inventory.post('/api/inventory/adjustments', { batchId, type: 'correction', quantity: 12, reason: 'Stock count' });
    expect(await batchQty(batchId)).toBe(12);
    const moves = (await inventory.get(`/api/inventory/movements?batchId=${batchId}`)).body.data;
    expect(moves.map((m: { movementType: string; quantity: number }) => [m.movementType, m.quantity])).toEqual([
      ['correction', -3], ['damaged', -5], ['purchase', 20],
    ]);
    const audit = await pool.query(`SELECT summary FROM audit_logs WHERE entity_type = 'batch' AND entity_id = $1 ORDER BY id`, [String(batchId)]);
    expect(audit.rows[0].summary).toMatch(/from 20 to 15.*Water damage/);
  });

  it('keeps the stock movement ledger append-only', async () => {
    await expect(pool.query('UPDATE inventory_movements SET quantity = 999 WHERE id = (SELECT min(id) FROM inventory_movements)')).rejects.toThrow(/append-only/);
    await expect(pool.query('DELETE FROM inventory_movements WHERE id = (SELECT min(id) FROM inventory_movements)')).rejects.toThrow(/append-only/);
  });

  it('rejects duplicate SKUs and barcodes', async () => {
    const sku = `DUP-${Date.now()}`;
    const body12 = `62099${String(Date.now()).slice(-7)}`;
    const valid = body12 + ean13CheckDigit(body12);
    const invalid = body12 + ((ean13CheckDigit(body12) + 1) % 10);
    await makeProduct(admin, { sku, barcode: valid });
    const again = await admin.post('/api/products', { sku, name: 'Dup', productType: 'tablet', unit: 'strip', purchasePrice: 1, sellingPrice: 2, reorderLevel: 0 });
    expect(again.status).toBe(409);
    const barcode = await admin.post('/api/products', { name: 'Dup2', barcode: valid, productType: 'tablet', unit: 'strip', purchasePrice: 1, sellingPrice: 2, reorderLevel: 0 });
    expect(barcode.status).toBe(409);
    const badCheck = await admin.post('/api/products', { name: 'Dup3', barcode: invalid, productType: 'tablet', unit: 'strip', purchasePrice: 1, sellingPrice: 2, reorderLevel: 0 });
    expect(badCheck.status).toBe(400);
  });

  it('finds products at the till by barcode', async () => {
    const productId = await makeProduct(admin);
    const { body } = await admin.post(`/api/products/${productId}/barcode`);
    expect(body.barcode).toMatch(/^\d{13}$/);
    await receive(admin, supplierId, productId, `BC-${productId}`, 5, addDays(today(), 200));
    const found = await admin.get(`/api/products/pos-search?q=${body.barcode}`);
    expect(found.body.exactMatch).toBe(true);
    expect(found.body.results[0].id).toBe(productId);
    expect(found.body.results[0].sellable).toBe(5);
    const s = await cashSale(admin, [{ productId, quantity: 5 }], 50000);
    expect(s.status).toBe(201);
  });
});
