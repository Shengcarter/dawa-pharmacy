import { beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import { addDays, makeProduct, makeSupplier, prepare, receive, today, userWithRole, type Client } from './helpers';

const lines = async (saleId: number) =>
  (await pool.query('SELECT quantity, unit_price, units_per_sale_unit, price_source FROM sale_items WHERE sale_id = $1 ORDER BY units_per_sale_unit DESC, id', [saleId])).rows
    .map((l) => [l.quantity, Number(l.unit_price), l.units_per_sale_unit, l.price_source]);

describe('price rules: wholesale and quantity prices', () => {
  let admin: Client;
  let cashier: Client;
  let supplierId: number;
  let wholesaleCustomer: number;
  let regularCustomer: number;
  beforeAll(async () => {
    await prepare();
    admin = await userWithRole('super_admin');
    cashier = await userWithRole('cashier');
    supplierId = await makeSupplier(admin);
    wholesaleCustomer = (await admin.post('/api/customers', { fullName: 'Bulk Buyer Ltd', customerType: 'wholesale' })).body.id;
    regularCustomer = (await admin.post('/api/customers', { fullName: 'Regular Person', customerType: 'regular' })).body.id;
  });

  const stocked = async (overrides: Record<string, unknown>, qty = 500) => {
    const id = await makeProduct(admin, overrides);
    await receive(admin, supplierId, id, `PR-${id}`, qty, addDays(today(), 400));
    return id;
  };

  it('applies the best quantity price for the product total in the cart, loose and packs together', async () => {
    const productId = await stocked({ packSellingPrice: 95000, priceBreaks: [{ minQuantity: 10, unitPrice: 9000 }, { minQuantity: 50, unitPrice: 8000 }] });
    // 5 units: below every quantity price.
    const small = await cashier.post('/api/sales', { items: [{ productId, quantity: 5 }], payments: [{ method: 'cash', amount: 50000 }] });
    expect(small.status).toBe(201);
    expect(await lines(small.body.id)).toEqual([[5, 10000, 1, 'standard']]);
    // 1 pack + 2 units = 12 units: 10+ price; the pack becomes 10 × 9,000 = 90,000 (cheaper than the 95,000 pack price).
    const mixed = await cashier.post('/api/sales', {
      items: [{ productId, quantity: 1, sellBy: 'pack' }, { productId, quantity: 2 }],
      payments: [{ method: 'cash', amount: 90000 + 18000 }],
    });
    expect(mixed.status).toBe(201);
    expect(await lines(mixed.body.id)).toEqual([[10, 90000, 10, 'quantity'], [2, 9000, 1, 'quantity']]);
    // 60 units: 50+ price.
    const big = await cashier.post('/api/sales', { items: [{ productId, quantity: 60 }], payments: [{ method: 'cash', amount: 480000 }] });
    expect(big.status).toBe(201);
    expect(await lines(big.body.id)).toEqual([[60, 8000, 1, 'quantity']]);
  });

  it('gives wholesale customers the wholesale price, unless a quantity price is lower', async () => {
    const productId = await stocked({ wholesalePrice: 8500, priceBreaks: [{ minQuantity: 50, unitPrice: 8000 }] });
    const sell = (customerId: number, quantity: number, amount: number) =>
      cashier.post('/api/sales', { customerId, items: [{ productId, quantity }], payments: [{ method: 'cash', amount }] });
    const regular = await sell(regularCustomer, 2, 20000);
    expect(await lines(regular.body.id)).toEqual([[2, 10000, 1, 'standard']]);
    const wholesale = await sell(wholesaleCustomer, 2, 17000);
    expect(wholesale.status).toBe(201);
    expect(await lines(wholesale.body.id)).toEqual([[2, 8500, 1, 'wholesale']]);
    const wholesaleBulk = await sell(wholesaleCustomer, 50, 400000);
    expect(await lines(wholesaleBulk.body.id)).toEqual([[50, 8000, 1, 'quantity']]);
    // The server sets the price: a walk-in paying the wholesale amount is short, not discounted.
    const walkIn = await cashier.post('/api/sales', { items: [{ productId, quantity: 2 }], payments: [{ method: 'cash', amount: 17000 }] });
    expect(walkIn.status).toBe(422);
  });

  it('lets a rule price sit at the minimum but still blocks discounts below it', async () => {
    const productId = await stocked({ minSellingPrice: 9000, wholesalePrice: 9000 });
    const pharmacist = await userWithRole('pharmacist'); // may discount (within 10%), may not override prices
    const ok = await pharmacist.post('/api/sales', { customerId: wholesaleCustomer, items: [{ productId, quantity: 1 }], payments: [{ method: 'cash', amount: 9000 }] });
    expect(ok.status).toBe(201);
    const below = await pharmacist.post('/api/sales', {
      customerId: wholesaleCustomer, items: [{ productId, quantity: 1, discount: 500 }], payments: [{ method: 'cash', amount: 8500 }],
    });
    expect(below.status).toBe(403);
  });

  it('validates quantity prices against the selling and minimum prices', async () => {
    const bad = (priceBreaks: unknown, extra: Record<string, unknown> = {}) =>
      admin.post('/api/products', {
        name: 'Invalid prices', productType: 'tablet', unit: 'strip', purchasePrice: 6000, sellingPrice: 10000, reorderLevel: 5, priceBreaks, ...extra,
      });
    expect((await bad([{ minQuantity: 10, unitPrice: 10000 }])).status).toBe(400); // not below the selling price
    expect((await bad([{ minQuantity: 10, unitPrice: 8000 }], { minSellingPrice: 9000 })).status).toBe(400); // below the minimum
    expect((await bad([{ minQuantity: 10, unitPrice: 9000 }, { minQuantity: 10, unitPrice: 8500 }])).status).toBe(400); // duplicate quantity
    expect((await bad([{ minQuantity: 1, unitPrice: 9000 }])).status).toBe(400); // from 2 units
    expect((await bad([], { wholesalePrice: 12000 })).status).toBe(400); // wholesale above selling price
  });

  it('keeps quantity prices when an update leaves them out, audits changes, and needs price permission', async () => {
    const productId = await stocked({ priceBreaks: [{ minQuantity: 20, unitPrice: 9500 }] });
    const current = (await admin.get(`/api/products/${productId}`)).body;
    const body = {
      sku: current.sku, name: current.name, productType: current.productType, unit: current.unit, packSize: current.packSize,
      purchasePrice: current.purchasePrice, sellingPrice: current.sellingPrice, reorderLevel: current.reorderLevel, isBatchTracked: true,
    };
    expect(current.priceBreaks).toEqual([{ minQuantity: 20, unitPrice: 9500 }]);
    expect((await admin.put(`/api/products/${productId}`, body)).status).toBe(200);
    expect((await admin.get(`/api/products/${productId}`)).body.priceBreaks).toEqual([{ minQuantity: 20, unitPrice: 9500 }]);

    // Lowering the selling price below a kept quantity price is refused.
    expect((await admin.put(`/api/products/${productId}`, { ...body, sellingPrice: 9000 })).status).toBe(422);

    const inventory = await userWithRole('inventory_officer');
    const canPrice = (await inventory.get('/api/auth/me')).body.permissions.includes('products.manage_prices');
    const change = { ...body, priceBreaks: [{ minQuantity: 20, unitPrice: 9000 }, { minQuantity: 100, unitPrice: 8500 }] };
    if (!canPrice) expect((await inventory.put(`/api/products/${productId}`, change)).status).toBe(403);

    expect((await admin.put(`/api/products/${productId}`, change)).status).toBe(200);
    const log = await pool.query("SELECT summary FROM audit_logs WHERE entity_type = 'product' AND entity_id = $1 AND action = 'price_change' ORDER BY id DESC LIMIT 1", [productId]);
    expect(log.rows[0].summary).toMatch(/quantity prices .* from 20\+ at .*9,500 to 20\+ at .*9,000, 100\+ at .*8,500/);

    const pos = (await cashier.get(`/api/products/pos-search?q=${current.sku}`)).body.results[0];
    expect(pos.priceBreaks).toEqual([{ minQuantity: 20, unitPrice: 9000 }, { minQuantity: 100, unitPrice: 8500 }]);
  });

  it('treats blank optional prices from the form as not set, not zero', async () => {
    const productId = await makeProduct(admin, { packSize: 10 });
    const current = (await admin.get(`/api/products/${productId}`)).body;
    const res = await admin.put(`/api/products/${productId}`, {
      sku: current.sku, name: current.name, productType: 'tablet', unit: 'strip', packSize: '10', purchasePrice: '6000', sellingPrice: '10000',
      reorderLevel: '5', isBatchTracked: true, packSellingPrice: '', wholesalePrice: '', minSellingPrice: '', maxStockLevel: '', priceBreaks: [],
    });
    expect(res.status).toBe(200);
    const { rows } = await pool.query('SELECT pack_selling_price, wholesale_price, min_selling_price, max_stock_level FROM products WHERE id = $1', [productId]);
    expect(rows[0]).toEqual({ pack_selling_price: null, wholesale_price: null, min_selling_price: null, max_stock_level: null });
  });
});
