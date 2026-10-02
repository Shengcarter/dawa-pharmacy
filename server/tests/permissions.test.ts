import { beforeAll, describe, expect, it } from 'vitest';
import { cashSale, makeProduct, makeSupplier, prepare, receive, today, addDays, userWithRole, type Client } from './helpers';

describe('role-based access control (enforced by the API)', () => {
  let admin: Client;
  let cashier: Client;
  let accountant: Client;
  let inventory: Client;
  beforeAll(async () => {
    await prepare();
    admin = await userWithRole('super_admin');
    cashier = await userWithRole('cashier');
    accountant = await userWithRole('accountant');
    inventory = await userWithRole('inventory_officer');
  });

  it('cashier cannot see financial reports, adjust stock, manage products or users', async () => {
    expect((await cashier.get('/api/reports/profit-loss')).status).toBe(403);
    expect((await cashier.post('/api/inventory/adjustments', { batchId: 1, type: 'damaged', quantity: 1, reason: 'x' })).status).toBe(403);
    expect((await cashier.post('/api/products', { name: 'x' })).status).toBe(403);
    expect((await cashier.get('/api/users')).status).toBe(403);
    expect((await cashier.get('/api/audit-logs')).status).toBe(403);
  });

  it('accountant can read P&L but cannot sell or receive stock', async () => {
    expect((await accountant.get('/api/reports/profit-loss')).status).toBe(200);
    expect((await accountant.post('/api/sales', { items: [] })).status).toBe(403);
    expect((await accountant.post('/api/purchasing/receipts', {})).status).toBe(403);
  });

  it('inventory officer can receive stock but not approve purchase orders', async () => {
    const supplierId = await makeSupplier(admin);
    const productId = await makeProduct(admin);
    const po = await inventory.post('/api/purchasing/orders', {
      supplierId, orderDate: today(), items: [{ productId, quantity: 10, unitCost: 5000 }],
    });
    expect(po.status).toBe(201);
    expect((await inventory.post(`/api/purchasing/orders/${po.body.id}/transition`, { action: 'approve' })).status).toBe(403);
    expect((await admin.post(`/api/purchasing/orders/${po.body.id}/transition`, { action: 'approve' })).status).toBe(200);
  });

  it('cashier only sees their own sales', async () => {
    const supplierId = await makeSupplier(admin);
    const productId = await makeProduct(admin);
    await receive(admin, supplierId, productId, `B-${Date.now()}`, 10, addDays(today(), 300));
    const mine = await cashSale(cashier, [{ productId, quantity: 1 }], 10000);
    const theirs = await cashSale(admin, [{ productId, quantity: 1 }], 10000);
    expect(mine.status).toBe(201);
    const list = await cashier.get('/api/sales?pageSize=200');
    const ids = list.body.data.map((s: { id: number }) => s.id);
    expect(ids).toContain(mine.body.id);
    expect(ids).not.toContain(theirs.body.id);
    expect((await cashier.get(`/api/sales/${theirs.body.id}`)).status).toBe(403);
  });

  it('price changes require the price permission', async () => {
    const productId = await makeProduct(admin);
    const product = (await admin.get(`/api/products/${productId}`)).body;
    const pharmacist = await userWithRole('inventory_officer');
    const res = await pharmacist.put(`/api/products/${productId}`, { ...product, sellingPrice: 12000, productType: 'tablet' });
    expect(res.status).toBe(403);
  });
});
