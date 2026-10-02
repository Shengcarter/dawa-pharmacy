/**
 * Demo data generator. Every record is created through the real services
 * (purchase orders → receipts → FEFO sales → returns → payments), back-dated
 * over ~4 months, so stock, batch history, COGS, balances and the audit log
 * are all internally consistent.
 *
 *   npm run seed -w server            # refuses to run on a database that has users
 *   npm run seed -w server -- --reset # wipes the database first (development only)
 */
import { addDays, ean13CheckDigit, productSchema, todayIn, DEFAULT_TIMEZONE } from '@dawa/shared';
import { env } from '../../config/env';
import { pool } from '../pool';
import { runMigrations } from '../migrate';
import { syncSystemData } from '../bootstrap';
import type { Actor } from '../../lib/actor';
import { AppError } from '../../lib/errors';
import { hashPassword } from '../../modules/auth/service';
import { updateSettingsSection, invalidateSettingsCache } from '../../modules/settings/service';
import { createProduct, saveCategory, saveManufacturer } from '../../modules/catalog/service';
import { createSupplier, recordSupplierPayment } from '../../modules/suppliers/service';
import { createPurchaseOrder, receiveGoods, transitionPurchaseOrder } from '../../modules/purchasing/service';
import { createCustomer } from '../../modules/customers/service';
import { createSale, recordPayment } from '../../modules/sales/service';
import { processReturn } from '../../modules/sales/returns';
import { createPrescription } from '../../modules/prescriptions/service';
import { createExpense } from '../../modules/expenses/service';
import { adjustStock } from '../../modules/inventory/service';
import { runAllAlerts } from '../../modules/notifications/service';
import { CATEGORIES, CUSTOMERS, MANUFACTURERS, PRESCRIBERS, PRODUCTS, STAFF, SUPPLIERS, type DemoProduct } from './catalog';

export const DEMO_PASSWORD = 'Upendo@2026';
const HISTORY_DAYS = 118;

// Deterministic pseudo-random numbers so every seed produces the same story.
let seed = 20261002;
function rand() {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const randInt = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const pick = <T>(items: readonly T[]) => items[Math.floor(rand() * items.length)];
function weighted<T>(items: readonly T[], weight: (t: T) => number): T {
  const total = items.reduce((a, i) => a + weight(i), 0);
  let r = rand() * total;
  for (const i of items) {
    r -= weight(i);
    if (r <= 0) return i;
  }
  return items[items.length - 1];
}

const today = todayIn(DEFAULT_TIMEZONE);
const dayAt = (daysAgo: number) => addDays(today, -daysAgo);
/** Local (UTC+3) wall-clock time → Date. */
const at = (date: string, hour: number, minute = 0) =>
  new Date(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+03:00`);

const actors = new Map<string, Omit<Actor, 'occurredAt'>>();
function as(role: string, when: Date): Actor {
  const a = actors.get(role);
  if (!a) throw new Error(`No demo user for ${role}`);
  return { ...a, occurredAt: when };
}

async function resetDatabase() {
  if (env.isProduction) throw new Error('Refusing to reset a production database.');
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
}

async function createStaff() {
  const branch = (await pool.query(`SELECT id FROM branches WHERE code = 'MAIN'`)).rows[0].id;
  await pool.query(`UPDATE branches SET name = 'Sinza (main)', address = 'Shekilango Road, Sinza, Dar es Salaam', phone = '+255 754 120 334' WHERE id = $1`, [branch]);
  const hash = await hashPassword(DEMO_PASSWORD);
  const created = at(dayAt(HISTORY_DAYS + 2), 9);
  for (const s of STAFF) {
    const { rows } = await pool.query(
      `INSERT INTO users (branch_id, full_name, email, phone, job_title, password_hash, created_at, updated_at, preferences)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7,'{"theme":"light"}') RETURNING id`,
      [branch, s.fullName, s.email, s.phone, s.jobTitle, hash, created],
    );
    await pool.query(`INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = $2`, [rows[0].id, s.role]);
    const perms = await pool.query(
      `SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id JOIN roles r ON r.id = rp.role_id WHERE r.code = $1`,
      [s.role],
    );
    const key = s.email.split('@')[0];
    actors.set(key, {
      userId: rows[0].id, userName: s.fullName, branchId: branch,
      permissions: new Set(perms.rows.map((r) => r.code as string)), ip: '127.0.0.1', userAgent: 'seed',
    });
  }
}

interface SeededProduct extends DemoProduct {
  id: number;
  supplierId: number;
  dailyDemand: number;
}

async function main() {
  const reset = process.argv.includes('--reset');
  if (reset) await resetDatabase();
  await runMigrations();
  await syncSystemData();
  const existing = await pool.query('SELECT count(*)::int AS n FROM users');
  if (existing.rows[0].n > 0) {
    throw new Error('The database already has users. Run with --reset to wipe it (development only).');
  }
  invalidateSettingsCache();
  console.log(`Seeding demo pharmacy (history ${HISTORY_DAYS} days to ${today})…`);
  await createStaff();
  const setupDay = dayAt(HISTORY_DAYS + 1);

  // ---- Settings -----------------------------------------------------------
  const admin = as('admin', at(setupDay, 8));
  await updateSettingsSection(admin, 'general', {
    pharmacyName: 'Upendo Pharmacy', legalName: 'Upendo Pharmacy Limited',
    address: 'Shekilango Road, Sinza, Dar es Salaam', phone: '+255 754 120 334', email: 'hello@upendopharmacy.co.tz',
    tin: '128-554-901', vrn: '40-018872-K', licenseNo: 'TMDA/RP/DSM/2024/1187', currency: 'TZS', timezone: DEFAULT_TIMEZONE,
  });
  await updateSettingsSection(admin, 'sales', {
    taxInclusive: true, maxDiscountPercent: 10, requirePrescriptionForRx: true, allowCreditSales: true, receiptPaper: '80mm',
    receiptFooter: 'Asante kwa kutuchagua! Medicines once sold are returnable within 7 days with receipt. Keep all medicines out of reach of children.',
  });
  await updateSettingsSection(admin, 'inventory', { defaultReorderLevel: 20, criticalStockPercent: 30, expiryWarningDays: 90 });

  // ---- Master data --------------------------------------------------------
  const mgr = (d: string, h = 9) => as('grace', at(d, h));
  const categoryIds = new Map<string, number>();
  for (const [name, description] of CATEGORIES) categoryIds.set(name, (await saveCategory(mgr(setupDay), null, { name, description })).id);
  const manufacturerIds = new Map<string, number>();
  for (const [name, country] of MANUFACTURERS) manufacturerIds.set(name, (await saveManufacturer(mgr(setupDay), null, { name, country })).id);
  const supplierIds: number[] = [];
  for (const s of SUPPLIERS) {
    const r = await createSupplier(mgr(setupDay), { ...s, vrn: null, status: 'active', notes: null });
    supplierIds.push(r.id);
  }

  const otcPopularity = PRODUCTS.filter((p) => !p.rx).reduce((a, p) => a + p.pop, 0);
  const rxPopularity = PRODUCTS.filter((p) => p.rx).reduce((a, p) => a + p.pop, 0);
  const products: SeededProduct[] = [];
  for (const p of PRODUCTS) {
    const barcode = p.barcode ? p.barcode.slice(0, 12) + ean13CheckDigit(p.barcode.slice(0, 12)) : null;
    const data = productSchema.parse({
      sku: p.sku, barcode, name: p.name, genericName: p.generic, brandName: p.brand, productType: p.type,
      categoryId: categoryIds.get(p.category), manufacturerId: manufacturerIds.get(p.manufacturer), defaultSupplierId: supplierIds[p.supplier],
      dosageForm: p.form, strength: p.strength, unit: p.unit, packSize: p.pack, purchasePrice: p.cost, sellingPrice: p.price,
      wholesalePrice: Math.round((p.price * 0.85) / 50) * 50, minSellingPrice: p.min ?? null, reorderLevel: p.reorder,
      maxStockLevel: p.max ?? null, requiresPrescription: Boolean(p.rx), isBatchTracked: p.tracked !== false, taxRate: p.tax ?? 0,
      status: 'active', description: null, storageInstructions: p.storage ?? 'Store below 30°C in a dry place, away from direct sunlight.',
    });
    const { id } = await createProduct(as('emmanuel', at(setupDay, 10)), data);
    // Counter sales: ~22/day × ~1.6 lines × ~1.4 units; prescriptions: ~1.5/day × ~1.35 items × ~2 units.
    const dailyDemand = p.rx ? (1.5 * 1.35 * 2 * p.pop * 1.2) / rxPopularity : (22 * 1.6 * 1.4 * p.pop * 1.2) / otcPopularity;
    products.push({ ...p, id, supplierId: supplierIds[p.supplier], dailyDemand });
  }

  const customerIds: { id: number; credit: boolean }[] = [];
  for (const c of CUSTOMERS) {
    const r = await createCustomer(mgr(setupDay, 11), {
      fullName: c.fullName, phone: c.phone, email: 'email' in c ? c.email : null, address: 'address' in c ? c.address : null,
      dateOfBirth: 'dateOfBirth' in c ? c.dateOfBirth : null, gender: 'gender' in c ? c.gender : null, customerType: c.customerType,
      insuranceProvider: 'insuranceProvider' in c ? c.insuranceProvider : null, insuranceMemberNo: null,
      creditLimit: 'creditLimit' in c ? c.creditLimit : 0, notes: null, status: 'active',
    });
    customerIds.push({ id: r.id, credit: 'creditLimit' in c && c.creditLimit > 0 });
  }

  // ---- Stock in: two purchasing cycles per supplier ------------------------
  let batchSeq = 100;
  const batchNo = (p: DemoProduct) => `${p.sku.split('-')[0]}${String(++batchSeq).padStart(4, '0')}`;
  async function purchaseCycle(daysAgo: number, quantityFor: (p: SeededProduct) => number, expiryFor: (p: SeededProduct) => string) {
    const orderDay = dayAt(daysAgo);
    const receiveDay = dayAt(daysAgo - 3);
    for (const [s, supplierId] of supplierIds.entries()) {
      const lines = products.filter((p) => p.supplier === s).map((p) => ({ p, qty: quantityFor(p) })).filter((l) => l.qty > 0);
      if (!lines.length) continue;
      const po = await createPurchaseOrder(as('emmanuel', at(orderDay, 9, 30)), {
        supplierId, orderDate: orderDay, expectedDate: addDays(orderDay, 4), notes: null,
        items: lines.map((l) => ({ productId: l.p.id, quantity: l.qty, unitCost: l.p.cost, discount: 0, taxRate: 0 })),
      });
      await transitionPurchaseOrder(as('emmanuel', at(orderDay, 10)), po.id, 'submit', null);
      await transitionPurchaseOrder(as('grace', at(orderDay, 15)), po.id, 'approve', null);
      const items = (await pool.query('SELECT id, product_id, quantity_ordered FROM purchase_order_items WHERE purchase_order_id = $1', [po.id])).rows;
      await receiveGoods(as('emmanuel', at(receiveDay, 11)), {
        purchaseOrderId: po.id, supplierId, supplierInvoiceNo: `INV-${randInt(10000, 99999)}`, receivedDate: receiveDay,
        notes: null, updateSellingPrices: false,
        items: items.map((i) => {
          const p = products.find((x) => x.id === i.product_id)!;
          const tracked = p.tracked !== false;
          return {
            purchaseOrderItemId: i.id, productId: p.id, batchNumber: tracked ? batchNo(p) : 'NO-BATCH',
            manufactureDate: tracked ? addDays(receiveDay, -randInt(60, 200)) : null,
            expiryDate: tracked ? expiryFor(p) : null, quantity: i.quantity_ordered, unitCost: p.cost, sellingPrice: null,
          };
        }),
      });
    }
  }

  // Cycle 1 (~115 days ago): covers about 60 days of demand.
  await purchaseCycle(HISTORY_DAYS - 2, (p) => {
    const base = Math.ceil(p.dailyDemand * 62) + p.reorder;
    if (p.scenario === 'out') return Math.ceil(p.dailyDemand * 58);
    return base;
  }, () => addDays(today, randInt(150, 420)));

  // Cycle 2 (~58 days ago): refill, later expiries; 'low' items deliberately under-ordered.
  await purchaseCycle(58, (p) => {
    if (p.scenario === 'out') return 0;
    const need = Math.ceil(p.dailyDemand * 58);
    if (p.scenario === 'low') return Math.max(Math.ceil(need * 0.35), 1);
    return need + Math.ceil(p.reorder * 1.6);
  }, (p) => addDays(today, p.pop < 2 && rand() < 0.4 ? randInt(40, 85) : randInt(320, 720)));

  /** Direct delivery without a purchase order (e.g. an urgent top-up from a wholesaler). */
  async function directReceipt(daysAgo: number, sku: string, quantity: number, expiry: string | null) {
    const p = products.find((x) => x.sku === sku)!;
    const date = dayAt(daysAgo);
    const tracked = p.tracked !== false;
    await receiveGoods(as('emmanuel', at(date, 12)), {
      purchaseOrderId: null, supplierId: p.supplierId, supplierInvoiceNo: `CS-${randInt(1000, 9999)}`, receivedDate: date,
      notes: 'Urgent top-up, cash-and-carry', updateSellingPrices: false,
      items: [{
        purchaseOrderItemId: null, productId: p.id, batchNumber: tracked ? batchNo(p) : 'NO-BATCH',
        manufactureDate: tracked && expiry ? addDays(expiry, -540) : null, expiryDate: tracked ? expiry : null,
        quantity: Math.max(quantity, 1), unitCost: p.cost, sellingPrice: null,
      }],
    });
  }
  const demandOf = (sku: string) => products.find((x) => x.sku === sku)!.dailyDemand;

  // ---- Daily trading ------------------------------------------------------
  const otc = products.filter((p) => !p.rx);
  const rxProducts = products.filter((p) => p.rx);
  const tills = [
    { who: 'rehema', w: 50 }, { who: 'baraka', w: 25 }, { who: 'halima', w: 15 }, { who: 'grace', w: 10 },
  ];
  const creditSales: { id: number; daysAgo: number }[] = [];
  const allSales: { id: number; daysAgo: number }[] = [];
  let skipped = 0;
  const nowLocalHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: DEFAULT_TIMEZONE, hour: '2-digit', hour12: false }).format(new Date()));

  async function trySale(actor: Actor, input: Parameters<typeof createSale>[1]) {
    try {
      return await createSale(actor, input);
    } catch (err) {
      if (err instanceof AppError) {
        skipped += 1;
        return null;
      }
      throw err;
    }
  }

  const sellable = async (sku: string) =>
    Number((await pool.query(
      `SELECT COALESCE(sum(b.quantity_on_hand), 0) AS q FROM product_batches b JOIN products p ON p.id = b.product_id
        WHERE p.sku = $1 AND b.status = 'active' AND (b.expiry_date IS NULL OR b.expiry_date >= $2::date)`,
      [sku, dayAt(15)],
    )).rows[0].q);

  for (let d = HISTORY_DAYS - 6; d >= 0; d -= 1) {
    const date = dayAt(d);
    // Short-dated stock bought in bulk: it outlives demand and expires on the shelf.
    if (d === 34) await directReceipt(d, 'CGH-SYR-100', Math.ceil(demandOf('CGH-SYR-100') * 26) + 42, dayAt(7));
    if (d === 70) await directReceipt(d, 'FOL-5-T', Math.ceil(demandOf('FOL-5-T') * 45) + 25, dayAt(20));
    if (d === 22) await directReceipt(d, 'CET-10-T', Math.ceil(demandOf('CET-10-T') * 22) + 38, addDays(today, 19));
    if (d === 28) await directReceipt(d, 'TET-1-OIN', 24, addDays(today, 52));
    if (d === 28) await directReceipt(d, 'HYD-1-CR', 20, addDays(today, 76));
    // Emergency top-up keeps deliberately under-ordered lines low rather than empty.
    if (d === 14) {
      for (const p of products.filter((x) => x.scenario === 'low')) {
        const target = Math.ceil((p.dailyDemand / 1.2) * 14 + p.reorder * 0.5);
        const have = await sellable(p.sku);
        if (have < target) await directReceipt(d, p.sku, target - have, addDays(today, randInt(300, 500)));
      }
    }
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
    const factor = dow === 0 ? 0.55 : dow === 6 ? 1.2 : 1;
    const growth = 0.85 + (0.3 * (HISTORY_DAYS - d)) / HISTORY_DAYS; // business grows over the period
    let count = Math.round((20 + randInt(-4, 5)) * factor * growth);
    const lastHour = d === 0 ? Math.min(Math.max(nowLocalHour - 1, 8), 20) : 20;
    if (d === 0) count = Math.max(Math.round((count * (lastHour - 8)) / 12), 3);

    for (let n = 0; n < count; n += 1) {
      const when = at(date, randInt(8, lastHour), randInt(0, 59));
      const till = weighted(tills, (t) => t.w).who;
      const lines = new Map<number, number>();
      const lineCount = weighted([1, 2, 3, 4], (k) => [55, 30, 11, 4][k - 1]);
      for (let i = 0; i < lineCount; i += 1) {
        const p = weighted(otc, (x) => x.pop);
        lines.set(p.id, (lines.get(p.id) ?? 0) + weighted([1, 2, 3], (q) => [70, 22, 8][q - 1]));
      }
      const withCustomer = rand() < 0.3;
      const customer = withCustomer ? pick(customerIds) : null;
      const methodRoll = rand();
      const actor = as(till, when);
      const onCredit = Boolean(customer?.credit) && till === 'grace' && rand() < 0.5;
      const discountAllowed = actor.permissions.has('pos.discount') && rand() < 0.06;
      const items = [...lines.entries()].map(([productId, quantity]) => {
        const p = products.find((x) => x.id === productId)!;
        const discount = discountAllowed ? Math.round((p.price * quantity * 0.05) / 50) * 50 : 0;
        return { productId, quantity, batchId: null, unitPrice: null, discount };
      });
      const preview = items.reduce((a, i) => a + products.find((p) => p.id === i.productId)!.price * i.quantity - i.discount, 0);
      const method = methodRoll < 0.55 ? 'cash' : methodRoll < 0.87 ? 'mobile_money' : 'card';
      const sale = await trySale(actor, {
        customerId: customer?.id ?? null, prescriptionId: null, items, cartDiscount: 0,
        payments: onCredit ? [] : [{ method, amount: preview, reference: method === 'mobile_money' ? `MP${randInt(100000000, 999999999)}` : null }],
        cashTendered: !onCredit && method === 'cash' ? Math.ceil(preview / 5000) * 5000 : null,
        onCredit, notes: null, idempotencyKey: null,
      });
      if (sale) {
        allSales.push({ id: sale.id, daysAgo: d });
        if (onCredit) creditSales.push({ id: sale.id, daysAgo: d });
      }
    }

    // Prescriptions: recorded and dispensed by pharmacists.
    const rxToday = weighted([0, 1, 2, 3], (k) => [15, 40, 30, 15][k]);
    for (let r = 0; r < rxToday; r += 1) {
      const when = at(date, randInt(9, Math.max(lastHour - 1, 9)), randInt(0, 59));
      const pharmacist = rand() < 0.6 ? 'halima' : 'baraka';
      const patient = pick(customerIds.slice(0, 10));
      const prescriber = pick(PRESCRIBERS);
      const chosen = new Set<SeededProduct>();
      const itemCount = weighted([1, 2], (k) => (k === 1 ? 65 : 35));
      while (chosen.size < itemCount) chosen.add(weighted(rxProducts, (x) => x.pop));
      const items = [...chosen].map((p) => {
        const chronic = p.category === 'Cardiovascular & Diabetes';
        return {
          productId: p.id,
          dosageInstructions: chronic ? 'Take 1 tablet once daily' : p.type === 'capsule' ? 'Take 1 capsule three times daily after meals' : 'Take as directed by the prescriber',
          quantity: chronic ? 3 : randInt(1, 2), durationDays: chronic ? 30 : randInt(3, 7), refillsAllowed: chronic ? 2 : 0,
        };
      });
      const rx = await createPrescription(as(pharmacist, when), {
        customerId: patient.id, prescriberName: prescriber.name, prescriberFacility: prescriber.facility, prescriberRegNo: prescriber.reg,
        prescriptionDate: date, validUntil: addDays(date, 30), diagnosisNote: null, notes: null, items,
      });
      if (d <= 1 && r === 0) continue; // leave the newest prescriptions waiting at the counter
      const dispenseAt = new Date(when.getTime() + randInt(5, 25) * 60_000);
      const saleItems = items.map((i) => ({ productId: i.productId, quantity: i.quantity, batchId: null, unitPrice: null, discount: 0 }));
      const total = saleItems.reduce((a, i) => a + products.find((p) => p.id === i.productId)!.price * i.quantity, 0);
      const sale = await trySale(as(pharmacist, dispenseAt), {
        customerId: patient.id, prescriptionId: rx.id, items: saleItems, cartDiscount: 0,
        payments: [{ method: rand() < 0.6 ? 'cash' : 'mobile_money', amount: total, reference: null }],
        cashTendered: null, onCredit: false, notes: null, idempotencyKey: null,
      });
      if (sale) allSales.push({ id: sale.id, daysAgo: d });
    }

    // Weekly housekeeping.
    if (d % 7 === 3) {
      await createExpense(as('fatuma', at(date, 16)), {
        categoryId: await expenseCategory('Transport'), description: 'Stock pickup and deliveries (bajaji / boda)',
        amount: randInt(4, 9) * 5000, paymentMethod: 'mobile_money', expenseDate: date, paidTo: 'Local transport', employeeId: null, reference: null, notes: null,
      });
    }
  }

  // ---- Monthly expenses -----------------------------------------------------
  for (let m = 0; m < 4; m += 1) {
    const first = addDays(`${today.slice(0, 8)}01`, 0);
    const monthStart = shiftMonth(first, -m);
    const monthEnd = addDays(shiftMonth(first, -m + 1), -1);
    const inRange = (date: string) => date <= today && date >= dayAt(HISTORY_DAYS - 3);
    const items: [string, string, number, string, string, string][] = [
      [monthStart, 'Rent', 1_800_000, 'Shop rent — Shekilango Road premises', 'bank_transfer', 'Sinza Properties Ltd'],
      [addDays(monthStart, 9), 'Electricity', randInt(17, 24) * 10_000, 'LUKU electricity tokens', 'mobile_money', 'TANESCO'],
      [addDays(monthStart, 11), 'Water', randInt(4, 6) * 10_000, 'Water bill', 'mobile_money', 'DAWASA'],
      [addDays(monthStart, 14), 'Supplies', randInt(8, 15) * 10_000, 'Receipt rolls, dispensing envelopes and labels', 'cash', 'Kariakoo stationers'],
      [addDays(monthStart, 19), 'Banking fees', randInt(18, 32) * 1_000, 'POS terminal and account charges', 'bank_transfer', 'CRDB Bank'],
      [addDays(monthStart, 20), 'Maintenance', randInt(6, 12) * 10_000, 'Fridge (cold-chain) servicing', 'cash', 'CoolTech Services'],
      [addDays(monthStart, 22), 'Marketing', 120_000, 'Community health-day flyers', 'mobile_money', 'PrintHub Sinza'],
      [monthEnd, 'Salaries', 4_350_000, 'Staff salaries', 'bank_transfer', 'Staff payroll'],
    ];
    for (const [date, category, amount, description, method, paidTo] of items) {
      if (!inRange(date)) continue;
      await createExpense(as('fatuma', at(date, 15)), {
        categoryId: await expenseCategory(category), description, amount, paymentMethod: method, expenseDate: date, paidTo,
        employeeId: null, reference: null, notes: null,
      });
    }
  }

  // ---- Customer payments on credit invoices --------------------------------
  for (const s of creditSales) {
    if (s.daysAgo < 5 || rand() < 0.35) continue; // recent and some older invoices stay open
    const { rows } = await pool.query('SELECT balance_due FROM sales WHERE id = $1', [s.id]);
    const due = Number(rows[0].balance_due);
    if (due <= 0) continue;
    const payDay = dayAt(Math.max(s.daysAgo - randInt(3, 12), 0));
    await recordPayment(as('fatuma', at(payDay, 12)), s.id, {
      method: rand() < 0.5 ? 'mobile_money' : 'bank_transfer', amount: rand() < 0.7 ? due : Math.round(due / 2), reference: null, notes: null,
    });
  }

  // ---- Returns ---------------------------------------------------------------
  const reasons = ['wrong_item', 'not_needed', 'damaged_packaging', 'adverse_reaction', 'prescription_changed'] as const;
  let returnsDone = 0;
  for (const s of allSales.filter((x) => x.daysAgo > 2 && x.daysAgo < 90)) {
    if (returnsDone >= 9 || rand() > 0.006) continue;
    const items = (await pool.query('SELECT id, quantity FROM sale_items WHERE sale_id = $1 ORDER BY id LIMIT 1', [s.id])).rows;
    const sale = (await pool.query('SELECT customer_id FROM sales WHERE id = $1', [s.id])).rows[0];
    const condition = rand() < 0.7 ? 'resellable' : 'damaged';
    await processReturn(as('halima', at(dayAt(s.daysAgo - 1), 13)), {
      saleId: s.id, reason: pick(reasons), refundMethod: sale.customer_id && rand() < 0.3 ? 'store_credit' : 'cash', notes: null,
      items: [{ saleItemId: items[0].id, quantity: 1, condition }],
    });
    returnsDone += 1;
  }

  // ---- Stock adjustments -----------------------------------------------------
  const batchOf = async (sku: string) =>
    (await pool.query(
      `SELECT b.id FROM product_batches b JOIN products p ON p.id = b.product_id WHERE p.sku = $1 AND b.quantity_on_hand > 3
        ORDER BY b.expiry_date NULLS LAST LIMIT 1`,
      [sku],
    )).rows[0]?.id as number | undefined;
  const adjustments: [number, string, 'damaged' | 'adjustment_out' | 'adjustment_in' | 'correction', number, string][] = [
    [40, 'ANT-SEP-500', 'damaged', 2, 'Bottles cracked when a shelf bracket gave way'],
    [26, 'PAR-SYR-60', 'damaged', 1, 'Leaking cap found during shelf check'],
    [15, 'IBU-400-T', 'adjustment_out', 2, 'Missing at monthly stock count'],
    [15, 'ORS-SACH', 'adjustment_in', 3, 'Found in back-store carton during stock count'],
    [8, 'HND-SAN-250', 'damaged', 1, 'Pump broken on delivery shelf'],
  ];
  for (const [daysAgo, sku, type, quantity, reason] of adjustments) {
    const batchId = await batchOf(sku);
    if (batchId) await adjustStock(as('emmanuel', at(dayAt(daysAgo), 18)), { batchId, type, quantity, reason });
  }

  // ---- Supplier payments: older deliveries paid, newest partly open ---------
  const receipts = (await pool.query('SELECT id, supplier_id, total_cost, received_date, due_date FROM goods_receipts ORDER BY received_date')).rows;
  for (const g of receipts) {
    const age = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${g.received_date}T00:00:00Z`)) / 86_400_000);
    const supplierIndex = supplierIds.indexOf(g.supplier_id);
    let share = age > 80 ? 1 : [1, 0, 1, 0.6][supplierIndex];
    if (share === 0) continue;
    const payDay = age > 80 ? g.due_date : dayAt(randInt(3, 20));
    if (payDay > today) share = 0;
    if (share === 0) continue;
    await recordSupplierPayment(as('fatuma', at(payDay, 11)), {
      supplierId: g.supplier_id, goodsReceiptId: g.id, amount: Math.round(Number(g.total_cost) * share), method: 'bank_transfer',
      reference: `TRF${randInt(100000, 999999)}`, paidDate: payDay, notes: null,
    });
  }

  // ---- Open purchase orders at the end of the story --------------------------
  const lowItems = products.filter((p) => p.scenario === 'low' || p.scenario === 'out');
  const draft = await createPurchaseOrder(as('emmanuel', at(dayAt(1), 10)), {
    supplierId: supplierIds[1], orderDate: dayAt(1), expectedDate: addDays(today, 3), notes: 'Top up allergy and skin lines before the long weekend.',
    items: products.filter((p) => p.supplier === 1).slice(0, 4).map((p) => ({ productId: p.id, quantity: p.reorder * 2, unitCost: p.cost, discount: 0, taxRate: 0 })),
  });
  void draft;
  const pending = await createPurchaseOrder(as('emmanuel', at(dayAt(5), 10)), {
    supplierId: supplierIds[0], orderDate: dayAt(5), expectedDate: addDays(today, 2), notes: null,
    items: [...new Set(lowItems.filter((p) => p.supplier === 0).concat(products.filter((p) => p.sku === 'PAR-500-T')))]
      .map((p) => ({ productId: p.id, quantity: p.max ?? p.reorder * 3, unitCost: p.cost, discount: 0, taxRate: 0 })),
  });
  await transitionPurchaseOrder(as('emmanuel', at(dayAt(5), 10, 20)), pending.id, 'submit', null);
  const ordered = await createPurchaseOrder(as('emmanuel', at(dayAt(8), 9)), {
    supplierId: supplierIds[2], orderDate: dayAt(8), expectedDate: dayAt(2), notes: 'Supplier confirmed by phone.',
    items: products.filter((p) => p.supplier === 2).slice(0, 5).map((p) => ({ productId: p.id, quantity: p.reorder * 2, unitCost: p.cost, discount: Math.round(p.cost * 0.02) * p.reorder * 2, taxRate: 0 })),
  });
  await transitionPurchaseOrder(as('emmanuel', at(dayAt(8), 9, 15)), ordered.id, 'submit', null);
  await transitionPurchaseOrder(as('grace', at(dayAt(8), 14)), ordered.id, 'approve', null);
  await pool.query(`UPDATE purchase_orders SET submitted_at = $2 WHERE id = $1`, [pending.id, at(dayAt(5), 10, 20)]);

  // Master data was created "on" the setup day; align its timestamps with the story.
  const setupAt = at(setupDay, 9);
  for (const table of ['categories', 'products', 'suppliers', 'customers']) {
    await pool.query(`UPDATE ${table} SET created_at = $1, updated_at = GREATEST(updated_at, $1) WHERE created_at > $1`, [setupAt]);
  }
  await pool.query('UPDATE manufacturers SET created_at = $1', [setupAt]);
  await pool.query(`UPDATE products p SET updated_at = COALESCE((SELECT max(created_at) FROM audit_logs a WHERE a.entity_type = 'product' AND a.entity_id = p.id::text), p.updated_at)`);

  await runAllAlerts();
  const counts = (await pool.query(
    `SELECT (SELECT count(*) FROM sales) AS sales, (SELECT count(*) FROM sale_returns) AS returns, (SELECT count(*) FROM product_batches) AS batches,
            (SELECT count(*) FROM inventory_movements) AS movements, (SELECT count(*) FROM prescriptions) AS prescriptions,
            (SELECT count(*) FROM expenses) AS expenses, (SELECT count(*) FROM notifications WHERE resolved_at IS NULL) AS alerts`,
  )).rows[0];
  console.log(`Done: ${counts.sales} sales, ${counts.returns} returns, ${counts.prescriptions} prescriptions, ${counts.batches} batches, ${counts.movements} stock movements, ${counts.expenses} expenses, ${counts.alerts} open alerts. (${skipped} demo sales skipped for lack of stock — expected.)`);
  console.log(`\nDemo sign-in (password for all: ${DEMO_PASSWORD})`);
  for (const s of STAFF) console.log(`  ${s.role.padEnd(18)} ${s.email}`);
}

const expenseCategoryCache = new Map<string, number>();
async function expenseCategory(name: string) {
  if (!expenseCategoryCache.has(name)) {
    const { rows } = await pool.query('SELECT id FROM expense_categories WHERE lower(name) = lower($1)', [name]);
    expenseCategoryCache.set(name, rows[0].id);
  }
  return expenseCategoryCache.get(name)!;
}

function shiftMonth(isoFirstOfMonth: string, months: number) {
  const d = new Date(`${isoFirstOfMonth}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
  });
