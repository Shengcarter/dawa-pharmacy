import { beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import { addDays, batchQty, cashSale, makeProduct, makeSupplier, prepare, receive, today, userWithRole, type Client } from './helpers';

describe('POS sales, FEFO and stock rules', () => {
  let admin: Client;
  let cashier: Client;
  let pharmacist: Client;
  let supplierId: number;
  beforeAll(async () => {
    await prepare();
    admin = await userWithRole('super_admin');
    cashier = await userWithRole('cashier');
    pharmacist = await userWithRole('pharmacist');
    supplierId = await makeSupplier(admin);
  });

  it('sells from the earliest-expiring batch first and splits across batches (FEFO)', async () => {
    const productId = await makeProduct(admin);
    const late = await receive(admin, supplierId, productId, `LATE-${productId}`, 250, addDays(today(), 400));
    const early = await receive(admin, supplierId, productId, `EARLY-${productId}`, 100, addDays(today(), 150));
    const sale = await cashSale(cashier, [{ productId, quantity: 120 }], 1_200_000);
    expect(sale.status).toBe(201);
    expect(await batchQty(early)).toBe(0);
    expect(await batchQty(late)).toBe(230);
    const lines = await pool.query('SELECT batch_id, quantity FROM sale_items WHERE sale_id = $1 ORDER BY id', [sale.body.id]);
    expect(lines.rows).toEqual([{ batch_id: early, quantity: 100 }, { batch_id: late, quantity: 20 }]);
  });

  it('never sells expired stock, even when it is the only stock', async () => {
    const productId = await makeProduct(admin);
    const batchId = await receive(admin, supplierId, productId, `EXP-${productId}`, 10, addDays(today(), 30));
    await pool.query(`UPDATE product_batches SET expiry_date = $2 WHERE id = $1`, [batchId, addDays(today(), -1)]);
    const fefo = await cashSale(cashier, [{ productId, quantity: 1 }], 10000);
    expect(fefo.status).toBe(422);
    const chosen = await cashSale(cashier, [{ productId, quantity: 1, batchId }], 10000);
    expect(chosen.status).toBe(422);
    expect(chosen.body.error.message).toMatch(/expired/i);
    expect(await batchQty(batchId)).toBe(10);
  });

  it('refuses to oversell and leaves stock untouched', async () => {
    const productId = await makeProduct(admin);
    const batchId = await receive(admin, supplierId, productId, `S-${productId}`, 3, addDays(today(), 300));
    const res = await cashSale(cashier, [{ productId, quantity: 4 }], 40000);
    expect(res.status).toBe(422);
    expect(await batchQty(batchId)).toBe(3);
  });

  it('records sale movements and cost of goods at batch cost', async () => {
    const productId = await makeProduct(admin);
    await receive(admin, supplierId, productId, `C-${productId}`, 10, addDays(today(), 300), 6000);
    const sale = await cashSale(cashier, [{ productId, quantity: 2 }], 20000);
    const row = (await pool.query('SELECT total, cost_total, payment_status FROM sales WHERE id = $1', [sale.body.id])).rows[0];
    expect(Number(row.total)).toBe(20000);
    expect(Number(row.cost_total)).toBe(12000);
    expect(row.payment_status).toBe('paid');
    const mv = await pool.query(`SELECT quantity, quantity_before, quantity_after FROM inventory_movements WHERE reference_type = 'sale' AND reference_id = $1`, [sale.body.id]);
    expect(mv.rows).toEqual([{ quantity: -2, quantity_before: 10, quantity_after: 8 }]);
  });

  it('rejects short payment and computes change on cash tendered', async () => {
    const productId = await makeProduct(admin);
    await receive(admin, supplierId, productId, `P-${productId}`, 10, addDays(today(), 300));
    expect((await cashSale(cashier, [{ productId, quantity: 1 }], 5000)).status).toBe(422);
    const ok = await cashSale(cashier, [{ productId, quantity: 1 }], 10000, { cashTendered: 20000 });
    expect(ok.status).toBe(201);
    const row = (await pool.query('SELECT change_given FROM sales WHERE id = $1', [ok.body.id])).rows[0];
    expect(Number(row.change_given)).toBe(10000);
  });

  it('applies tax-inclusive VAT per product', async () => {
    const productId = await makeProduct(admin, { taxRate: 18, sellingPrice: 11800 });
    await receive(admin, supplierId, productId, `V-${productId}`, 5, addDays(today(), 300));
    const sale = await cashSale(cashier, [{ productId, quantity: 1 }], 11800);
    const row = (await pool.query('SELECT total, tax_total FROM sales WHERE id = $1', [sale.body.id])).rows[0];
    expect(Number(row.total)).toBe(11800);
    expect(Number(row.tax_total)).toBe(1800);
  });

  it('enforces the discount limit for cashiers and minimum selling price', async () => {
    const productId = await makeProduct(admin, { minSellingPrice: 9000 });
    await receive(admin, supplierId, productId, `D-${productId}`, 10, addDays(today(), 300));
    expect((await cashSale(cashier, [{ productId, quantity: 1, discount: 500 }], 9500)).status).toBe(403); // cashier has no discount right
    expect((await cashSale(pharmacist, [{ productId, quantity: 1, discount: 2000 }], 8000)).status).toBe(403); // 20% > 10% limit
    expect((await cashSale(pharmacist, [{ productId, quantity: 1, discount: 1000 }], 9000)).status).toBe(201);
    expect((await cashSale(admin, [{ productId, quantity: 1, discount: 1500 }], 8500)).status).toBe(201); // override permission
  });

  it('requires a prescription and a pharmacist for prescription-only medicines', async () => {
    const productId = await makeProduct(admin, { requiresPrescription: true });
    await receive(admin, supplierId, productId, `RX-${productId}`, 20, addDays(today(), 300));
    expect((await cashSale(cashier, [{ productId, quantity: 1 }], 10000)).status).toBe(422);
    const customer = await admin.post('/api/customers', { fullName: 'Patient Rx', phone: `+2557${Date.now().toString().slice(-8)}` });
    const rx = await pharmacist.post('/api/prescriptions', {
      customerId: customer.body.id, prescriberName: 'Dr. Test', prescriptionDate: today(),
      items: [{ productId, dosageInstructions: '1 x 3', quantity: 2, refillsAllowed: 1 }],
    });
    expect(rx.status).toBe(201);
    expect((await cashSale(cashier, [{ productId, quantity: 1 }], 10000, { prescriptionId: rx.body.id })).status).toBe(403);
    const first = await cashSale(pharmacist, [{ productId, quantity: 2 }], 20000, { prescriptionId: rx.body.id });
    expect(first.status).toBe(201);
    let detail = (await pharmacist.get(`/api/prescriptions/${rx.body.id}`)).body;
    expect(detail.status).toBe('partially_dispensed');
    expect(detail.items[0].quantityRemaining).toBe(2);
    expect((await cashSale(pharmacist, [{ productId, quantity: 3 }], 30000, { prescriptionId: rx.body.id })).status).toBe(422);
    expect((await cashSale(pharmacist, [{ productId, quantity: 2 }], 20000, { prescriptionId: rx.body.id })).status).toBe(201);
    detail = (await pharmacist.get(`/api/prescriptions/${rx.body.id}`)).body;
    expect(detail.status).toBe('dispensed');
    expect(detail.dispensings).toHaveLength(2);
  });

  it('credit sales need a customer within their credit limit, and payments clear the balance', async () => {
    const productId = await makeProduct(admin);
    await receive(admin, supplierId, productId, `CR-${productId}`, 50, addDays(today(), 300));
    const customer = await admin.post('/api/customers', { fullName: 'Credit Customer', creditLimit: 25000 });
    expect((await cashSale(admin, [{ productId, quantity: 1 }], 0, { onCredit: true })).status).toBe(422);
    expect((await cashSale(admin, [{ productId, quantity: 3 }], 0, { onCredit: true, customerId: customer.body.id })).status).toBe(422);
    const sale = await cashSale(admin, [{ productId, quantity: 2 }], 0, { onCredit: true, customerId: customer.body.id });
    expect(sale.status).toBe(201);
    expect((await cashier.post(`/api/sales/${sale.body.id}/payments`, { method: 'cash', amount: 1000 })).status).toBe(403);
    expect((await admin.post(`/api/sales/${sale.body.id}/payments`, { method: 'cash', amount: 30000 })).status).toBe(422);
    expect((await admin.post(`/api/sales/${sale.body.id}/payments`, { method: 'mobile_money', amount: 20000 })).status).toBe(201);
    const row = (await pool.query('SELECT balance_due, payment_status FROM sales WHERE id = $1', [sale.body.id])).rows[0];
    expect(Number(row.balance_due)).toBe(0);
    expect(row.payment_status).toBe('paid');
  });

  it('is idempotent: retrying with the same key does not sell twice', async () => {
    const productId = await makeProduct(admin);
    const batchId = await receive(admin, supplierId, productId, `I-${productId}`, 10, addDays(today(), 300));
    const key = `key-${productId}-abcdef`;
    const a = await cashSale(cashier, [{ productId, quantity: 1 }], 10000, { idempotencyKey: key });
    const b = await cashSale(cashier, [{ productId, quantity: 1 }], 10000, { idempotencyKey: key });
    expect(a.body.id).toBe(b.body.id);
    expect(await batchQty(batchId)).toBe(9);
  });

  it('serves a digital receipt by token without customer contact details', async () => {
    const productId = await makeProduct(admin);
    await receive(admin, supplierId, productId, `R-${productId}`, 10, addDays(today(), 300));
    const customer = await admin.post('/api/customers', { fullName: 'Receipt Person', phone: `+2556${Date.now().toString().slice(-8)}` });
    const sale = await cashSale(cashier, [{ productId, quantity: 1 }], 10000, { customerId: customer.body.id });
    const token = (await pool.query('SELECT receipt_token FROM sales WHERE id = $1', [sale.body.id])).rows[0].receipt_token;
    const { default: request } = await import('supertest');
    const { app } = await import('./helpers');
    const res = await request(app).get(`/api/public/receipts/${token}`);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('+2556');
    expect(res.body.sale.items[0].quantity).toBe(1);
  });
});
