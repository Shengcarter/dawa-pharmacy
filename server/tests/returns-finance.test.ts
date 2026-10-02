import { beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import { addDays, batchQty, cashSale, makeProduct, makeSupplier, prepare, receive, today, userWithRole, type Client } from './helpers';

describe('returns and financial reporting', () => {
  let admin: Client;
  let pharmacist: Client;
  let supplierId: number;
  beforeAll(async () => {
    await prepare();
    admin = await userWithRole('super_admin');
    pharmacist = await userWithRole('pharmacist');
    supplierId = await makeSupplier(admin);
  });

  async function saleOf(qty: number) {
    const productId = await makeProduct(admin);
    const batchId = await receive(admin, supplierId, productId, `RT-${productId}`, 10, addDays(today(), 300));
    const sale = await cashSale(admin, [{ productId, quantity: qty }], qty * 10000);
    const items = (await admin.get(`/api/sales/${sale.body.id}`)).body.items;
    return { productId, batchId, saleId: sale.body.id as number, saleItemId: items[0].id as number };
  }

  it('restocks resellable returns, not damaged ones, and refunds pro rata', async () => {
    const s = await saleOf(4);
    expect(await batchQty(s.batchId)).toBe(6);
    const r1 = await pharmacist.post('/api/sales/returns', {
      saleId: s.saleId, reason: 'not_needed', refundMethod: 'cash', items: [{ saleItemId: s.saleItemId, quantity: 2, condition: 'resellable' }],
    });
    expect(r1.status).toBe(201);
    expect(r1.body.refundAmount).toBe(20000);
    expect(await batchQty(s.batchId)).toBe(8);
    const r2 = await pharmacist.post('/api/sales/returns', {
      saleId: s.saleId, reason: 'damaged_packaging', refundMethod: 'cash', items: [{ saleItemId: s.saleItemId, quantity: 1, condition: 'damaged' }],
    });
    expect(r2.status).toBe(201);
    expect(await batchQty(s.batchId)).toBe(8);
    const over = await pharmacist.post('/api/sales/returns', {
      saleId: s.saleId, reason: 'other', refundMethod: 'cash', items: [{ saleItemId: s.saleItemId, quantity: 2, condition: 'resellable' }],
    });
    expect(over.status).toBe(422);
    const sale = (await pool.query('SELECT status FROM sales WHERE id = $1', [s.saleId])).rows[0];
    expect(sale.status).toBe('partially_returned');
  });

  it('cashiers cannot process returns', async () => {
    const s = await saleOf(1);
    const cashier = await userWithRole('cashier');
    const res = await cashier.post('/api/sales/returns', {
      saleId: s.saleId, reason: 'other', refundMethod: 'cash', items: [{ saleItemId: s.saleItemId, quantity: 1, condition: 'resellable' }],
    });
    expect(res.status).toBe(403);
  });

  it('store credit refunds can pay for a later sale', async () => {
    const productId = await makeProduct(admin);
    await receive(admin, supplierId, productId, `SC-${productId}`, 10, addDays(today(), 300));
    const customer = await admin.post('/api/customers', { fullName: 'Credit Holder' });
    const sale = await cashSale(admin, [{ productId, quantity: 2 }], 20000, { customerId: customer.body.id });
    const item = (await admin.get(`/api/sales/${sale.body.id}`)).body.items[0];
    await pharmacist.post('/api/sales/returns', {
      saleId: sale.body.id, reason: 'not_needed', refundMethod: 'store_credit', items: [{ saleItemId: item.id, quantity: 1, condition: 'resellable' }],
    });
    const c = (await admin.get(`/api/customers/${customer.body.id}`)).body;
    expect(Number(c.storeCreditBalance)).toBe(10000);
    const paid = await admin.post('/api/sales', {
      customerId: customer.body.id, items: [{ productId, quantity: 1 }], payments: [{ method: 'store_credit', amount: 10000 }],
    });
    expect(paid.status).toBe(201);
    expect(Number((await admin.get(`/api/customers/${customer.body.id}`)).body.storeCreditBalance)).toBe(0);
  });

  it('profit & loss uses batch cost, returns, stock losses and expenses', async () => {
    // Isolated period: everything below happens "today" in a fresh product set.
    const before = (await admin.get(`/api/reports/profit-loss?from=${today()}&to=${today()}`)).body;
    const productId = await makeProduct(admin);
    const batchId = await receive(admin, supplierId, productId, `PL-${productId}`, 10, addDays(today(), 300), 6000);
    await cashSale(admin, [{ productId, quantity: 1 }], 10000); // revenue 10,000, cost 6,000
    await admin.post('/api/inventory/adjustments', { batchId, type: 'damaged', quantity: 1, reason: 'Broken' }); // loss 6,000
    const category = (await admin.get('/api/expenses/categories')).body.find((c: { name: string }) => c.name === 'Electricity');
    await admin.post('/api/expenses', { categoryId: category.id, description: 'Tokens', amount: 1500, paymentMethod: 'cash', expenseDate: today() });
    const after = (await admin.get(`/api/reports/profit-loss?from=${today()}&to=${today()}`)).body;
    const delta = (k: string) => Math.round((after[k] - before[k]) * 100) / 100;
    expect(delta('netRevenue')).toBe(10000);
    expect(delta('cogs')).toBe(6000);
    expect(delta('grossProfit')).toBe(4000);
    expect(delta('stockLosses')).toBe(6000);
    expect(delta('operatingExpenses')).toBe(1500);
    expect(delta('netProfit')).toBe(4000 - 6000 - 1500);
    // Identity holds for the whole period.
    expect(after.netProfit).toBeCloseTo(after.netRevenue - after.cogs - after.stockLosses - after.operatingExpenses, 2);
  });

  it('expenses are voided, never deleted, and drop out of totals', async () => {
    const category = (await admin.get('/api/expenses/categories')).body[0];
    const e = await admin.post('/api/expenses', { categoryId: category.id, description: 'Mistake', amount: 999, paymentMethod: 'cash', expenseDate: today() });
    const before = (await admin.get(`/api/reports/expenses?from=${today()}&to=${today()}`)).body.summary.total;
    await admin.post(`/api/expenses/${e.body.id}/void`, { reason: 'Entered twice' });
    const after = (await admin.get(`/api/reports/expenses?from=${today()}&to=${today()}`)).body.summary.total;
    expect(before - after).toBe(999);
    expect((await pool.query('SELECT voided_at FROM expenses WHERE id = $1', [e.body.id])).rows[0].voided_at).not.toBeNull();
  });

  it('exports reports as CSV with formula injection neutralised', async () => {
    const customer = await admin.post('/api/customers', { fullName: '=HYPERLINK("http://evil")' });
    const productId = await makeProduct(admin);
    await receive(admin, supplierId, productId, `CSV-${productId}`, 2, addDays(today(), 300));
    await cashSale(admin, [{ productId, quantity: 1 }], 10000, { customerId: customer.body.id });
    const res = await admin.get(`/api/reports/sales?from=${today()}&to=${today()}&format=csv`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text).toContain(`"'=HYPERLINK(""http://evil"")"`);
  });

  it('dashboard figures come from live data and hide profit from cashiers', async () => {
    const cashier = await userWithRole('cashier');
    const forCashier = (await cashier.get('/api/dashboard?period=7d')).body;
    expect(forCashier.kpis.todayGrossProfit).toBeUndefined();
    expect(forCashier.scope).toBe('own');
    const forAdmin = (await admin.get('/api/dashboard?period=today')).body;
    const salesToday = await pool.query(
      `SELECT COALESCE(sum(total), 0) AS t FROM sales WHERE (created_at AT TIME ZONE 'Africa/Dar_es_Salaam')::date = $1::date`, [today()],
    );
    expect(forAdmin.kpis.todaySales.value).toBe(Number(salesToday.rows[0].t));
    expect(forAdmin.chart.points).toHaveLength(24);
  });

  it('writes human-readable audit entries for price changes', async () => {
    const productId = await makeProduct(admin, { sellingPrice: 800, purchasePrice: 400 });
    const product = (await admin.get(`/api/products/${productId}`)).body;
    const res = await admin.put(`/api/products/${productId}`, { ...product, sellingPrice: 1000 });
    expect(res.status).toBe(200);
    const log = await pool.query(`SELECT summary FROM audit_logs WHERE action = 'price_change' AND entity_id = $1`, [String(productId)]);
    expect(log.rows[0].summary).toMatch(/changed selling price of .* from TZS 800 to TZS 1,000/);
  });
});
