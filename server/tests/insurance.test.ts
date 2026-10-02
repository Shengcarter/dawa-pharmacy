import { beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import { addDays, makeProduct, makeSupplier, prepare, receive, today, userWithRole, type Client } from './helpers';

let seq = 0;
describe('insurance schemes, insured sales and claims', () => {
  let admin: Client;
  let cashier: Client;
  let pharmacist: Client;
  let accountant: Client;
  let supplierId: number;
  let listed: number; // on the price list at 8,000 (normal price 10,000)
  let unlisted: number;

  beforeAll(async () => {
    await prepare();
    admin = await userWithRole('super_admin');
    cashier = await userWithRole('cashier');
    pharmacist = await userWithRole('pharmacist');
    accountant = await userWithRole('accountant');
    supplierId = await makeSupplier(admin);
    listed = await makeProduct(admin);
    unlisted = await makeProduct(admin);
    await receive(admin, supplierId, listed, `INS-L-${listed}`, 200, addDays(today(), 400));
    await receive(admin, supplierId, unlisted, `INS-U-${unlisted}`, 200, addDays(today(), 400));
  });

  const scheme = async (overrides: Record<string, unknown> = {}) => {
    seq += 1;
    const res = await admin.post('/api/insurance/schemes', {
      code: `T${Date.now() % 100000}${seq}`, name: `Test Scheme ${Date.now()}-${seq}`, copayPercent: 10, coverage: 'listed_only', requiresPrescription: false, ...overrides,
    });
    expect(res.status).toBe(201);
    const id = res.body.id as number;
    expect((await admin.put(`/api/insurance/schemes/${id}/prices`, { prices: [{ productId: listed, unitPrice: 8000 }] })).status).toBe(200);
    return id;
  };
  const member = async (schemeId: number, memberNo: string | null = 'MB-0001') =>
    (await admin.post('/api/customers', { fullName: `Insured ${Date.now()}-${++seq}`, customerType: 'insurance', insuranceSchemeId: schemeId, insuranceMemberNo: memberNo })).body.id as number;
  const claimOf = async (saleId: number) => (await pool.query('SELECT * FROM insurance_claims WHERE sale_id = $1', [saleId])).rows[0];

  it('only insurance managers set up schemes and price lists', async () => {
    expect((await cashier.post('/api/insurance/schemes', { code: 'NOPE', name: 'Nope' })).status).toBe(403);
    const id = await scheme();
    expect((await accountant.put(`/api/insurance/schemes/${id}/prices`, { prices: [{ productId: listed, unitPrice: 1 }] })).status).toBe(403);
    const sku = (await admin.get(`/api/products/${listed}`)).body.sku;
    const bad = await admin.post(`/api/insurance/schemes/${id}/prices/import`, { rows: [{ sku: 'NO-SUCH-SKU', unitPrice: 100 }] });
    expect(bad.status).toBe(422);
    expect(bad.body.error.message).toMatch(/NO-SUCH-SKU/);
    const ok = await admin.post(`/api/insurance/schemes/${id}/prices/import`, { rows: [{ sku, unitPrice: '7500' }] });
    expect(ok.status).toBe(200);
    expect((await cashier.get(`/api/insurance/schemes/${id}/cart-prices?productIds=${listed},${unlisted}`)).body).toEqual([{ productId: listed, unitPrice: 7500 }]);
  });

  it('bills the scheme price, takes the co-pay from the patient and opens a claim', async () => {
    const schemeId = await scheme();
    const customerId = await member(schemeId);
    // 2 × listed at 8,000 = 16,000: insurer 14,400, patient 1,600. Unlisted 10,000 paid by the patient.
    const items = [{ productId: listed, quantity: 2 }, { productId: unlisted, quantity: 1 }];
    const over = await cashier.post('/api/sales', { customerId, useInsurance: true, items, payments: [{ method: 'cash', amount: 26000 }] });
    expect(over.status).toBe(422);
    const sale = await cashier.post('/api/sales', { customerId, useInsurance: true, items, payments: [{ method: 'cash', amount: 11600 }] });
    expect(sale.status).toBe(201);
    const s = (await admin.get(`/api/sales/${sale.body.id}`)).body;
    expect([s.total, s.insuranceAmount, s.amountPaid, s.balanceDue]).toEqual([26000, 14400, 11600, 0]);
    expect(s.items.find((i: { productId: number }) => i.productId === listed).priceSource).toBe('insurance');
    expect(s.claim).toMatchObject({ status: 'pending', amount: 14400, outstanding: 14400 });
    const claim = await claimOf(sale.body.id);
    expect(claim.member_no).toBe('MB-0001');
  });

  it('refuses insured sales without a member number, with discounts, or without a required prescription', async () => {
    const schemeId = await scheme();
    const noNumber = await member(schemeId, null);
    const r1 = await cashier.post('/api/sales', { customerId: noNumber, useInsurance: true, items: [{ productId: listed, quantity: 1 }], payments: [{ method: 'cash', amount: 800 }] });
    expect(r1.status).toBe(422);
    expect(r1.body.error.message).toMatch(/member number/);
    const customerId = await member(schemeId);
    const r2 = await pharmacist.post('/api/sales', { customerId, useInsurance: true, items: [{ productId: listed, quantity: 1, discount: 100 }], payments: [{ method: 'cash', amount: 700 }] });
    expect(r2.status).toBe(422);
    const rxScheme = await scheme({ requiresPrescription: true });
    const rxMember = await member(rxScheme);
    const r3 = await cashier.post('/api/sales', { customerId: rxMember, useInsurance: true, items: [{ productId: listed, quantity: 1 }], payments: [{ method: 'cash', amount: 800 }] });
    expect(r3.status).toBe(422);
    expect(r3.body.error.message).toMatch(/prescription/);
    // Nothing covered: sell it without insurance instead.
    const r4 = await cashier.post('/api/sales', { customerId, useInsurance: true, items: [{ productId: unlisted, quantity: 1 }], payments: [{ method: 'cash', amount: 10000 }] });
    expect(r4.status).toBe(422);
  });

  it('takes returned covered lines off a pending claim, and blocks them once the claim is submitted', async () => {
    const schemeId = await scheme();
    const customerId = await member(schemeId);
    const sale = await cashier.post('/api/sales', {
      customerId, useInsurance: true, items: [{ productId: listed, quantity: 2 }, { productId: unlisted, quantity: 1 }], payments: [{ method: 'cash', amount: 11600 }],
    });
    const s = (await admin.get(`/api/sales/${sale.body.id}`)).body;
    const covered = s.items.find((i: { productId: number }) => i.productId === listed);
    const plain = s.items.find((i: { productId: number }) => i.productId === unlisted);
    const ret = await admin.post('/api/sales/returns', {
      saleId: s.id, reason: 'not_needed', refundMethod: 'cash', items: [{ saleItemId: covered.id, quantity: 1, condition: 'resellable' }],
    });
    expect(ret.status).toBe(201);
    expect(ret.body.refundAmount).toBe(800); // the patient's 10% of 8,000; 7,200 comes off the claim
    expect(Number((await claimOf(s.id)).amount)).toBe(7200);

    const claimId = (await claimOf(s.id)).id;
    expect((await cashier.post('/api/insurance/claims/submit', { claimIds: [claimId] })).status).toBe(403);
    expect((await accountant.post('/api/insurance/claims/submit', { claimIds: [claimId], submissionRef: 'BATCH-1' })).status).toBe(200);
    const blocked = await admin.post('/api/sales/returns', {
      saleId: s.id, reason: 'not_needed', refundMethod: 'cash', items: [{ saleItemId: covered.id, quantity: 1, condition: 'resellable' }],
    });
    expect(blocked.status).toBe(422);
    const uncoveredReturn = await admin.post('/api/sales/returns', {
      saleId: s.id, reason: 'not_needed', refundMethod: 'cash', items: [{ saleItemId: plain.id, quantity: 1, condition: 'resellable' }],
    });
    expect(uncoveredReturn.status).toBe(201);
    expect(uncoveredReturn.body.refundAmount).toBe(10000);
  });

  it('records insurer payments, bills a shortfall to the patient or writes it off into the P&L', async () => {
    const schemeId = await scheme();
    const customerId = await member(schemeId);
    const sell = async () => {
      const r = await cashier.post('/api/sales', { customerId, useInsurance: true, items: [{ productId: listed, quantity: 5 }], payments: [{ method: 'cash', amount: 4000 }] });
      expect(r.status).toBe(201);
      return { saleId: r.body.id as number, claimId: (await claimOf(r.body.id)).id as number }; // claim 36,000
    };
    const a = await sell();
    const b = await sell();
    expect((await accountant.post(`/api/insurance/claims/${a.claimId}/payments`, { amount: 1000, paidOn: today(), method: 'bank_transfer' })).status).toBe(422); // not submitted yet
    expect((await accountant.post('/api/insurance/claims/submit', { claimIds: [a.claimId, b.claimId], submissionRef: 'BATCH-2' })).status).toBe(200);
    expect((await accountant.post(`/api/insurance/claims/${a.claimId}/payments`, { amount: 40000, paidOn: today(), method: 'bank_transfer' })).status).toBe(422); // more than owed
    expect((await accountant.post(`/api/insurance/claims/${a.claimId}/payments`, { amount: 30000, paidOn: today(), method: 'bank_transfer', reference: 'REM-1' })).status).toBe(201);
    expect((await claimOf(a.saleId)).status).toBe('partially_paid');

    // Shortfall billed to the patient: the sale now has a balance of 6,000.
    expect((await accountant.post(`/api/insurance/claims/${a.claimId}/close`, { outcome: 'bill_patient', reason: 'Tariff below claimed price' })).status).toBe(200);
    const sa = (await admin.get(`/api/sales/${a.saleId}`)).body;
    expect([sa.insuranceAmount, sa.balanceDue, sa.paymentStatus]).toEqual([30000, 6000, 'partial']);
    expect((await claimOf(a.saleId)).status).toBe('closed');

    // Rejected outright and written off: a loss on today's P&L.
    const before = (await admin.get(`/api/reports/profit-loss?from=${today()}&to=${today()}`)).body;
    expect((await accountant.post(`/api/insurance/claims/${b.claimId}/close`, { outcome: 'write_off', reason: 'Rejected: no pre-authorisation' })).status).toBe(200);
    expect((await claimOf(b.saleId)).status).toBe('rejected');
    const after = (await admin.get(`/api/reports/profit-loss?from=${today()}&to=${today()}`)).body;
    expect(after.claimWriteOffs - before.claimWriteOffs).toBe(36000);
    expect(Math.round(before.netProfit - after.netProfit)).toBe(36000);
    expect((await accountant.post(`/api/insurance/claims/${b.claimId}/close`, { outcome: 'write_off', reason: 'again' })).status).toBe(422);
  });

  it('keeps insurance details when staff who cannot see them edit the customer', async () => {
    const schemeId = await scheme();
    const customerId = await member(schemeId, 'KEEP-123');
    const asCashier = (await cashier.get(`/api/customers/${customerId}`)).body;
    expect(asCashier.insuranceMemberNo).toBeUndefined();
    const res = await cashier.put(`/api/customers/${customerId}`, { fullName: asCashier.fullName, customerType: 'insurance', phone: '+255700111222' });
    expect(res.status).toBe(200);
    const { rows } = await pool.query('SELECT insurance_scheme_id, insurance_member_no FROM customers WHERE id = $1', [customerId]);
    expect(rows[0]).toEqual({ insurance_scheme_id: schemeId, insurance_member_no: 'KEEP-123' });
  });

  it('records EFD receipt numbers once, without duplicates, and lists sales still missing one', async () => {
    const sale = async () => (await cashier.post('/api/sales', { items: [{ productId: unlisted, quantity: 1 }], payments: [{ method: 'cash', amount: 10000 }] })).body.id as number;
    const s1 = await sale();
    const s2 = await sale();
    const efd = `EFD-${Date.now()}`;
    expect((await cashier.put(`/api/sales/${s1}/efd`, { efdReceiptNo: efd })).status).toBe(200);
    expect((await cashier.put(`/api/sales/${s2}/efd`, { efdReceiptNo: efd })).status).toBe(409);
    expect((await cashier.put(`/api/sales/${s1}/efd`, { efdReceiptNo: `${efd}-X` })).status).toBe(403); // only a supervisor corrects it
    expect((await admin.put(`/api/sales/${s1}/efd`, { efdReceiptNo: `${efd}-X` })).status).toBe(200);
    const missing = (await admin.get('/api/sales?efdMissing=true&pageSize=200')).body.data.map((r: { id: number }) => r.id);
    expect(missing).toContain(s2);
    expect(missing).not.toContain(s1);
  });
});
