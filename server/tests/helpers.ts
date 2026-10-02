import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app';
import { pool } from '../src/db/pool';
import { runMigrations } from '../src/db/migrate';
import { syncSystemData } from '../src/db/bootstrap';
import { invalidateSettingsCache } from '../src/modules/settings/service';
import { todayIn, addDays } from '@dawa/shared';

export const app = createApp();
export const PASSWORD = 'TestPass123';
export const today = () => todayIn('Africa/Dar_es_Salaam');
export { addDays };

let ready: Promise<void> | null = null;
export function prepare() {
  ready ??= (async () => {
    await runMigrations();
    await syncSystemData();
    invalidateSettingsCache();
  })();
  return ready;
}

let counter = 0;
const hash = bcrypt.hashSync(PASSWORD, 4);

/** Creates a user with the given built-in role and returns a signed-in client. */
export async function userWithRole(role: string) {
  await prepare();
  counter += 1;
  const email = `${role}${counter}-${Date.now()}@test.local`;
  const branch = (await pool.query(`SELECT id FROM branches WHERE code = 'MAIN'`)).rows[0].id;
  const { rows } = await pool.query(
    `INSERT INTO users (branch_id, full_name, email, password_hash) VALUES ($1,$2,$3,$4) RETURNING id`,
    [branch, `${role} user ${counter}`, email, hash],
  );
  await pool.query(`INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = $2`, [rows[0].id, role]);
  const res = await request(app).post('/api/auth/login').set('x-dawa-client', 'web').send({ email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed: ${JSON.stringify(res.body)}`);
  return client(res.body.accessToken, rows[0].id, email);
}

export function client(token: string, userId = 0, email = '') {
  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
  return {
    userId,
    email,
    token,
    get: (url: string) => auth(request(app).get(url)),
    post: (url: string, body?: object) => auth(request(app).post(url)).send(body ?? {}),
    put: (url: string, body?: object) => auth(request(app).put(url)).send(body ?? {}),
    del: (url: string) => auth(request(app).delete(url)),
  };
}
export type Client = Awaited<ReturnType<typeof userWithRole>>;

let skuSeq = 0;
export async function makeProduct(admin: Client, overrides: Record<string, unknown> = {}) {
  skuSeq += 1;
  const res = await admin.post('/api/products', {
    sku: `T-${Date.now()}-${skuSeq}`, name: `Test product ${skuSeq}`, productType: 'tablet', unit: 'strip', packSize: 10,
    purchasePrice: 6000, sellingPrice: 10000, reorderLevel: 5, requiresPrescription: false, isBatchTracked: true, taxRate: 0,
    ...overrides,
  });
  if (res.status !== 201) throw new Error(`product: ${JSON.stringify(res.body)}`);
  return res.body.id as number;
}

export async function makeSupplier(admin: Client) {
  skuSeq += 1;
  const res = await admin.post('/api/suppliers', { name: `Supplier ${Date.now()}-${skuSeq}`, phone: '+255700000000', paymentTermsDays: 30 });
  if (res.status !== 201) throw new Error(`supplier: ${JSON.stringify(res.body)}`);
  return res.body.id as number;
}

/** Receives stock directly (no PO) into a new batch; returns the batch id. */
export async function receive(admin: Client, supplierId: number, productId: number, batchNumber: string, quantity: number, expiryDate: string | null, unitCost = 6000) {
  const res = await admin.post('/api/purchasing/receipts', {
    supplierId, receivedDate: today(), items: [{ productId, batchNumber, expiryDate, quantity, unitCost }],
  });
  if (res.status !== 201) throw new Error(`receive: ${JSON.stringify(res.body)}`);
  const { rows } = await pool.query('SELECT id FROM product_batches WHERE product_id = $1 AND batch_number = $2', [productId, batchNumber]);
  return rows[0].id as number;
}

export async function batchQty(batchId: number) {
  const { rows } = await pool.query('SELECT quantity_on_hand FROM product_batches WHERE id = $1', [batchId]);
  return rows[0].quantity_on_hand as number;
}

export async function cashSale(c: Client, items: { productId: number; quantity: number; batchId?: number; discount?: number }[], total: number, extra: Record<string, unknown> = {}) {
  return c.post('/api/sales', {
    items: items.map((i) => ({ productId: i.productId, quantity: i.quantity, batchId: i.batchId ?? null, discount: i.discount ?? 0 })),
    payments: total > 0 ? [{ method: 'cash', amount: total }] : [],
    ...extra,
  });
}
