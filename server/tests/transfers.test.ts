import { beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import { addDays, batchQty, cashSale, makeProduct, makeSupplier, prepare, receive, today, userWithRole, type Client } from './helpers';

describe('branches and stock transfers', () => {
  let admin: Client;
  let branchB: number;
  beforeAll(async () => {
    await prepare();
    admin = await userWithRole('super_admin');
    const r = await admin.post('/api/branches', { code: `B${Date.now().toString().slice(-6)}`, name: `Mwenge ${Date.now()}`, isActive: true });
    expect(r.status).toBe(201);
    branchB = r.body.id;
  });

  it('moves a batch to another branch with the same batch number, expiry and cost', async () => {
    const supplierId = await makeSupplier(admin);
    const productId = await makeProduct(admin);
    const expiry = addDays(today(), 200);
    const src = await receive(admin, supplierId, productId, `TR-${productId}`, 30, expiry, 4200);
    const res = await admin.post('/api/inventory/transfers', { toBranchId: branchB, items: [{ batchId: src, quantity: 12 }] });
    expect(res.status).toBe(201);
    expect(await batchQty(src)).toBe(18);
    const dest = (await pool.query('SELECT * FROM product_batches WHERE product_id = $1 AND branch_id = $2', [productId, branchB])).rows[0];
    expect(dest.quantity_on_hand).toBe(12);
    expect(dest.batch_number).toBe(`TR-${productId}`);
    expect(dest.expiry_date).toBe(expiry);
    expect(Number(dest.unit_cost)).toBe(4200);
    const moves = await pool.query(`SELECT movement_type, quantity FROM inventory_movements WHERE reference_type = 'transfer' AND reference_id = $1 ORDER BY id`, [res.body.id]);
    expect(moves.rows).toEqual([{ movement_type: 'transfer_out', quantity: -12 }, { movement_type: 'transfer_in', quantity: 12 }]);
  });

  it('refuses to transfer more than is on hand, expired stock, or to the same branch', async () => {
    const supplierId = await makeSupplier(admin);
    const productId = await makeProduct(admin);
    const src = await receive(admin, supplierId, productId, `TX-${productId}`, 5, addDays(today(), 100));
    expect((await admin.post('/api/inventory/transfers', { toBranchId: branchB, items: [{ batchId: src, quantity: 6 }] })).status).toBe(422);
    const main = (await pool.query(`SELECT id FROM branches WHERE code = 'MAIN'`)).rows[0].id;
    expect((await admin.post('/api/inventory/transfers', { toBranchId: main, items: [{ batchId: src, quantity: 1 }] })).status).toBe(422);
    await pool.query('UPDATE product_batches SET expiry_date = $2 WHERE id = $1', [src, addDays(today(), -1)]);
    expect((await admin.post('/api/inventory/transfers', { toBranchId: branchB, items: [{ batchId: src, quantity: 1 }] })).status).toBe(422);
    expect(await batchQty(src)).toBe(5);
  });

  it('keeps each branch’s stock separate: a user in branch B sells only branch B stock', async () => {
    const supplierId = await makeSupplier(admin);
    const productId = await makeProduct(admin);
    const src = await receive(admin, supplierId, productId, `TB-${productId}`, 10, addDays(today(), 300));
    await admin.post('/api/inventory/transfers', { toBranchId: branchB, items: [{ batchId: src, quantity: 4 }] });
    const cashier = await userWithRole('cashier');
    const roles = (await admin.get('/api/roles')).body.roles as { id: number; code: string }[];
    const moved = await admin.put(`/api/users/${cashier.userId}`, {
      fullName: 'Branch B cashier', email: cashier.email, roleIds: [roles.find((r) => r.code === 'cashier')!.id], status: 'active', branchId: branchB,
    });
    expect(moved.status).toBe(200);
    expect((await cashSale(cashier, [{ productId, quantity: 5 }], 50000)).status).toBe(422);
    expect((await cashSale(cashier, [{ productId, quantity: 4 }], 40000)).status).toBe(201);
    expect(await batchQty(src)).toBe(6);
  });
});
