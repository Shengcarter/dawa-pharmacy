import { formatMoney, internalEan13, MEDICINE_TYPES, type ProductData } from '@dawa/shared';
import type { z } from 'zod';
import type { productListQuery, productUpdateSchema } from '@dawa/shared';
import { pool, withTransaction, type Tx } from '../../db/pool';
import { can, type Actor } from '../../lib/actor';
import { audit } from '../../lib/audit';
import { conflict, forbidden, notFound, unprocessable } from '../../lib/errors';
import { likeParam, orderBy, pageParams, paginated } from '../../lib/pagination';
import { nextCode } from '../../lib/sequences';
import { receiveIntoBatch, upsertBatch, UNTRACKED_BATCH } from '../../lib/stock';
import { businessToday } from '../../lib/today';
import { getSettings } from '../settings/service';
import { stockLateral, stockStatusSql } from './stockSql';

type ListQuery = z.output<typeof productListQuery>;
type ProductUpdate = z.output<typeof productUpdateSchema>;

const SORTS: Record<string, string> = {
  name: 'p.name',
  sku: 'p.sku',
  stock: 's.sellable',
  sellingPrice: 'p.selling_price',
  updatedAt: 'p.updated_at',
  category: 'c.name',
};

export async function listProducts(actor: Actor, q: ListQuery) {
  const settings = await getSettings();
  const today = await businessToday();
  const params: unknown[] = [actor.branchId, today, settings.inventory.criticalStockPercent];
  const where: string[] = [];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replaceAll('$?', `$${params.length}`));
  };
  if (q.search) {
    params.push(likeParam(q.search), q.search);
    const like = params.length - 1;
    const exact = params.length;
    where.push(`(p.name ILIKE $${like} OR p.generic_name ILIKE $${like} OR p.brand_name ILIKE $${like} OR p.sku ILIKE $${like} OR p.barcode = $${exact})`);
  }
  if (q.categoryId) add('p.category_id = $?', q.categoryId);
  if (q.productType) add('p.product_type = $?', q.productType);
  if (q.medicinesOnly) add('p.product_type = ANY($?::text[])', MEDICINE_TYPES);
  if (q.status) add('p.status = $?', q.status);
  if (q.requiresPrescription) add('p.requires_prescription = $?', q.requiresPrescription === 'true');
  if (q.supplierId) add('p.default_supplier_id = $?', q.supplierId);
  const status = stockStatusSql('$3');
  if (q.stockStatus) add(`(${status}) = $?`, q.stockStatus);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { limit, offset } = pageParams(q.page, q.pageSize);
  const { rows } = await pool.query(
    `SELECT p.id, p.sku, p.barcode, p.name, p.generic_name, p.brand_name, p.product_type, p.strength, p.dosage_form, p.unit,
            p.pack_size, p.purchase_price, p.selling_price, p.reorder_level, p.requires_prescription, p.is_batch_tracked, p.status, p.tax_rate,
            p.image_path, p.updated_at, c.id AS category_id, c.name AS category_name, m.name AS manufacturer_name,
            s.on_hand, s.sellable, s.stock_value, s.nearest_expiry, s.batch_count, ${status} AS stock_status,
            count(*) OVER() AS total_count
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN manufacturers m ON m.id = p.manufacturer_id
       ${stockLateral('$1', '$2')}
       ${whereSql}
      ORDER BY ${orderBy(SORTS, q.sort, q.order, 'p.name ASC')}, p.id
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  return paginated(rows.map(({ total_count: _t, ...r }) => r), rows[0]?.total_count ?? 0, q.page, q.pageSize);
}

export async function getProduct(actor: Actor, id: number) {
  const settings = await getSettings();
  const today = await businessToday();
  const { rows } = await pool.query(
    `SELECT p.*, c.name AS category_name, m.name AS manufacturer_name, sup.name AS supplier_name,
            cu.full_name AS created_by_name, uu.full_name AS updated_by_name,
            s.on_hand, s.sellable, s.stock_value, s.nearest_expiry, s.expired_qty, ${stockStatusSql('$4')} AS stock_status
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN manufacturers m ON m.id = p.manufacturer_id
       LEFT JOIN suppliers sup ON sup.id = p.default_supplier_id
       LEFT JOIN users cu ON cu.id = p.created_by
       LEFT JOIN users uu ON uu.id = p.updated_by
       ${stockLateral('$2', '$3')}
      WHERE p.id = $1`,
    [id, actor.branchId, today, settings.inventory.criticalStockPercent],
  );
  if (!rows[0]) throw notFound('Product');
  const batches = await pool.query(
    `SELECT b.id, b.batch_number, b.manufacture_date, b.expiry_date, b.quantity_received, b.quantity_on_hand, b.unit_cost,
            b.selling_price, b.status, b.received_at, sup.name AS supplier_name,
            (b.expiry_date IS NOT NULL AND b.expiry_date < $3::date) AS is_expired,
            (b.expiry_date - $3::date) AS days_to_expiry
       FROM product_batches b LEFT JOIN suppliers sup ON sup.id = b.supplier_id
      WHERE b.product_id = $1 AND b.branch_id = $2
      ORDER BY (b.quantity_on_hand > 0) DESC, b.expiry_date ASC NULLS LAST, b.id`,
    [id, actor.branchId, today],
  );
  const suppliers = await pool.query(
    `SELECT sp.supplier_id, s.name, sp.supplier_sku, sp.last_cost, sp.last_supplied_at
       FROM supplier_products sp JOIN suppliers s ON s.id = sp.supplier_id WHERE sp.product_id = $1 ORDER BY sp.last_supplied_at DESC NULLS LAST`,
    [id],
  );
  const sales = await pool.query(
    `SELECT COALESCE(sum(si.quantity - si.quantity_returned), 0)::int AS units,
            COALESCE(sum(si.net_amount), 0) AS revenue,
            COALESCE(sum(si.quantity * si.unit_cost), 0) AS cost
       FROM sale_items si JOIN sales s ON s.id = si.sale_id
      WHERE si.product_id = $1 AND s.branch_id = $2 AND s.created_at >= now() - interval '30 days'`,
    [id, actor.branchId],
  );
  const showCost = can(actor, 'reports.financial') || can(actor, 'purchasing.view') || can(actor, 'products.manage');
  const product = rows[0];
  if (!showCost) {
    delete product.purchase_price;
    delete product.stock_value;
  }
  return {
    ...product,
    batches: batches.rows.map((b) => (showCost ? b : { ...b, unit_cost: undefined })),
    suppliers: showCost ? suppliers.rows : [],
    last30Days: showCost ? sales.rows[0] : { units: sales.rows[0].units },
  };
}

async function assertUnique(tx: Tx, sku: string | null, barcode: string | null, excludeId?: number) {
  if (sku) {
    const r = await tx.query('SELECT name FROM products WHERE upper(sku) = upper($1) AND id <> $2', [sku, excludeId ?? 0]);
    if (r.rowCount) throw conflict(`SKU ${sku} is already used by ${r.rows[0].name}.`);
  }
  if (barcode) {
    const r = await tx.query('SELECT name FROM products WHERE barcode = $1 AND id <> $2', [barcode, excludeId ?? 0]);
    if (r.rowCount) throw conflict(`Barcode ${barcode} is already used by ${r.rows[0].name}.`);
  }
}

async function assertRefs(tx: Tx, d: { categoryId: number | null; manufacturerId: number | null; defaultSupplierId: number | null }) {
  const checks: [number | null, string, string][] = [
    [d.categoryId, 'categories', 'Category'],
    [d.manufacturerId, 'manufacturers', 'Manufacturer'],
    [d.defaultSupplierId, 'suppliers', 'Supplier'],
  ];
  for (const [id, table, label] of checks) {
    if (id && !(await tx.query(`SELECT 1 FROM ${table} WHERE id = $1`, [id])).rowCount) throw unprocessable(`${label} not found.`);
  }
}

const productColumns = (d: ProductUpdate) => [
  d.barcode, d.name, d.genericName, d.brandName, d.productType, d.categoryId, d.manufacturerId, d.defaultSupplierId,
  d.dosageForm, d.strength, d.unit, d.packSize, d.purchasePrice, d.sellingPrice, d.wholesalePrice, d.minSellingPrice,
  d.reorderLevel, d.maxStockLevel, d.requiresPrescription, d.isBatchTracked, d.taxRate, d.status, d.description,
  d.storageInstructions, d.packSellingPrice,
];

export async function createProduct(actor: Actor, d: ProductData) {
  return withTransaction(async (tx) => {
    await assertUnique(tx, d.sku, d.barcode);
    await assertRefs(tx, d);
    const sku = d.sku ?? (await nextCode(tx, 'PRD', 5));
    const { rows } = await tx.query(
      `INSERT INTO products (sku, barcode, name, generic_name, brand_name, product_type, category_id, manufacturer_id, default_supplier_id,
                             dosage_form, strength, unit, pack_size, purchase_price, selling_price, wholesale_price, min_selling_price,
                             reorder_level, max_stock_level, requires_prescription, is_batch_tracked, tax_rate, status, description,
                             storage_instructions, pack_selling_price, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$27)
       RETURNING id`,
      [sku, ...productColumns(d), actor.userId],
    );
    const id = rows[0].id as number;
    if (d.openingStock) {
      const batchId = await upsertBatch(tx, actor, {
        productId: id,
        branchId: actor.branchId,
        batchNumber: d.isBatchTracked ? d.openingStock.batchNumber : UNTRACKED_BATCH,
        manufactureDate: d.openingStock.manufactureDate,
        expiryDate: d.openingStock.expiryDate,
        unitCost: d.openingStock.unitCost,
        supplierId: d.defaultSupplierId,
      });
      await receiveIntoBatch(tx, actor, batchId, d.openingStock.quantity, 'opening', {
        referenceType: 'product', referenceId: id, referenceNo: sku, reason: 'Opening stock',
      });
    }
    await audit(tx, actor, {
      action: 'create', module: 'products', entityType: 'product', entityId: id,
      summary: `${actor.userName} created product ${d.name} (${sku})${d.openingStock ? ` with opening stock of ${d.openingStock.quantity}` : ''}`,
      newValues: { sku, name: d.name, sellingPrice: d.sellingPrice, purchasePrice: d.purchasePrice },
    });
    return { id, sku };
  });
}

const PRICE_FIELDS = [
  ['purchase_price', 'purchasePrice', 'purchase price'],
  ['selling_price', 'sellingPrice', 'selling price'],
  ['wholesale_price', 'wholesalePrice', 'wholesale price'],
  ['min_selling_price', 'minSellingPrice', 'minimum selling price'],
  ['pack_selling_price', 'packSellingPrice', 'pack price'],
] as const;

export async function updateProduct(actor: Actor, id: number, d: ProductUpdate & { sku: string | null }) {
  const settings = await getSettings();
  return withTransaction(async (tx) => {
    const { rows } = await tx.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [id]);
    const before = rows[0];
    if (!before) throw notFound('Product');
    const sku = d.sku ?? before.sku;
    await assertUnique(tx, sku, d.barcode, id);
    await assertRefs(tx, d);
    const priceChanges = PRICE_FIELDS.filter(([col, key]) => Number(before[col] ?? -1) !== Number(d[key] ?? -1));
    if (priceChanges.length && !can(actor, 'products.manage_prices')) {
      throw forbidden('You do not have permission to change prices.');
    }
    if (before.is_batch_tracked !== d.isBatchTracked) {
      const stock = await tx.query('SELECT 1 FROM product_batches WHERE product_id = $1 AND quantity_on_hand > 0 LIMIT 1', [id]);
      if (stock.rowCount) throw unprocessable('Batch tracking can only be changed while the product has no stock.');
    }
    await tx.query(
      `UPDATE products SET sku=$1, barcode=$2, name=$3, generic_name=$4, brand_name=$5, product_type=$6, category_id=$7, manufacturer_id=$8,
              default_supplier_id=$9, dosage_form=$10, strength=$11, unit=$12, pack_size=$13, purchase_price=$14, selling_price=$15,
              wholesale_price=$16, min_selling_price=$17, reorder_level=$18, max_stock_level=$19, requires_prescription=$20,
              is_batch_tracked=$21, tax_rate=$22, status=$23, description=$24, storage_instructions=$25, pack_selling_price=$26, updated_by=$27, updated_at=now()
        WHERE id = $28`,
      [sku, ...productColumns(d), actor.userId, id],
    );
    const cur = settings.general.currency;
    for (const [col, key, label] of priceChanges) {
      await audit(tx, actor, {
        action: 'price_change', module: 'products', entityType: 'product', entityId: id,
        summary: `${actor.userName} changed ${label} of ${d.name} from ${before[col] === null ? 'none' : formatMoney(before[col], cur)} to ${d[key] === null ? 'none' : formatMoney(d[key], cur)}`,
        oldValues: { [key]: before[col] }, newValues: { [key]: d[key] },
      });
    }
    const otherChanged = ['name', 'status', 'reorder_level', 'requires_prescription', 'barcode', 'sku']
      .filter((col) => String(before[col] ?? '') !== String(({ name: d.name, status: d.status, reorder_level: d.reorderLevel, requires_prescription: d.requiresPrescription, barcode: d.barcode, sku } as Record<string, unknown>)[col] ?? ''));
    if (otherChanged.length || !priceChanges.length) {
      await audit(tx, actor, {
        action: 'update', module: 'products', entityType: 'product', entityId: id,
        summary: `${actor.userName} updated ${d.name}${otherChanged.length ? ` (${otherChanged.join(', ')})` : ''}`,
        oldValues: Object.fromEntries(otherChanged.map((c) => [c, before[c]])),
        newValues: { name: d.name, status: d.status, reorderLevel: d.reorderLevel, requiresPrescription: d.requiresPrescription, barcode: d.barcode, sku },
      });
    }
    return { id };
  });
}

export async function bulkSetStatus(actor: Actor, ids: number[], status: string) {
  return withTransaction(async (tx) => {
    const { rows } = await tx.query(
      `UPDATE products SET status = $2, updated_by = $3, updated_at = now() WHERE id = ANY($1::int[]) AND status <> $2 RETURNING id, name`,
      [ids, status, actor.userId],
    );
    if (rows.length) {
      await audit(tx, actor, {
        action: 'bulk_status', module: 'products', entityType: 'product', entityId: null,
        summary: `${actor.userName} set ${rows.length} product(s) to ${status}: ${rows.slice(0, 5).map((r) => r.name).join(', ')}${rows.length > 5 ? '…' : ''}`,
        newValues: { ids: rows.map((r) => r.id), status },
      });
    }
    return { updated: rows.length };
  });
}

/** Assigns an internal EAN-13 to a product that has no barcode. */
export async function generateBarcode(actor: Actor, id: number) {
  return withTransaction(async (tx) => {
    const { rows } = await tx.query('SELECT name, barcode FROM products WHERE id = $1 FOR UPDATE', [id]);
    if (!rows[0]) throw notFound('Product');
    if (rows[0].barcode) return { barcode: rows[0].barcode as string };
    const barcode = internalEan13(id);
    await assertUnique(tx, null, barcode, id);
    await tx.query('UPDATE products SET barcode = $2, updated_at = now(), updated_by = $3 WHERE id = $1', [id, barcode, actor.userId]);
    await audit(tx, actor, {
      action: 'update', module: 'products', entityType: 'product', entityId: id,
      summary: `${actor.userName} generated barcode ${barcode} for ${rows[0].name}`, newValues: { barcode },
    });
    return { barcode };
  });
}

export async function setProductImage(actor: Actor, id: number, imagePath: string | null) {
  const { rows } = await pool.query(
    'UPDATE products SET image_path = $2, updated_at = now(), updated_by = $3 WHERE id = $1 RETURNING name',
    [id, imagePath, actor.userId],
  );
  if (!rows[0]) throw notFound('Product');
  await audit(pool, actor, {
    action: 'update', module: 'products', entityType: 'product', entityId: id,
    summary: `${actor.userName} ${imagePath ? 'updated' : 'removed'} the image of ${rows[0].name}`,
  });
}

/**
 * POS lookup: products with sellable stock, matched by exact barcode/SKU first,
 * then by name. Returns per-batch availability so the till can show FEFO order.
 */
export async function posSearch(actor: Actor, term: string, limit = 12) {
  const today = await businessToday();
  const exact = await pool.query(
    `SELECT id FROM products WHERE (barcode = $1 OR upper(sku) = upper($1)) AND status = 'active' LIMIT 1`,
    [term],
  );
  const params: unknown[] = [actor.branchId, today];
  let filter: string;
  if (exact.rows[0]) {
    params.push(exact.rows[0].id);
    filter = `p.id = $3`;
  } else {
    params.push(likeParam(term), term);
    filter = `(p.name ILIKE $3 OR p.generic_name ILIKE $3 OR p.brand_name ILIKE $3 OR p.sku ILIKE $3)`;
  }
  const { rows } = await pool.query(
    `SELECT p.id, p.sku, p.barcode, p.name, p.generic_name, p.strength, p.dosage_form, p.unit, p.selling_price, p.min_selling_price,
            p.pack_size, p.pack_selling_price,
            p.tax_rate, p.requires_prescription, p.image_path,
            COALESCE(json_agg(json_build_object(
              'id', b.id, 'batchNumber', b.batch_number, 'expiryDate', b.expiry_date, 'quantity', b.quantity_on_hand,
              'sellingPrice', b.selling_price) ORDER BY b.expiry_date ASC NULLS LAST, b.received_at, b.id)
              FILTER (WHERE b.id IS NOT NULL), '[]') AS batches,
            COALESCE(sum(b.quantity_on_hand), 0)::int AS sellable
       FROM products p
       LEFT JOIN product_batches b ON b.product_id = p.id AND b.branch_id = $1 AND b.status = 'active'
            AND b.quantity_on_hand > 0 AND (b.expiry_date IS NULL OR b.expiry_date >= $2::date)
      WHERE p.status = 'active' AND ${filter}
      GROUP BY p.id
      ORDER BY ${exact.rows[0] ? 'p.id' : `(p.name ILIKE ($4 || '%')) DESC, (COALESCE(sum(b.quantity_on_hand), 0) > 0) DESC, p.name`}
      LIMIT ${Math.min(limit, 30)}`,
    params,
  );
  return { exactMatch: Boolean(exact.rows[0]), results: rows };
}

// ---------------------------------------------------------------------------
// Categories and manufacturers
// ---------------------------------------------------------------------------
export async function listCategories() {
  const { rows } = await pool.query(
    `SELECT c.id, c.name, c.description, c.created_at,
            (SELECT count(*)::int FROM products p WHERE p.category_id = c.id) AS product_count
       FROM categories c ORDER BY c.name`,
  );
  return rows;
}

export async function saveCategory(actor: Actor, id: number | null, d: { name: string; description: string | null }) {
  return withTransaction(async (tx) => {
    const dup = await tx.query('SELECT 1 FROM categories WHERE lower(name) = lower($1) AND id <> $2', [d.name, id ?? 0]);
    if (dup.rowCount) throw conflict('A category with this name already exists.');
    let result;
    if (id) {
      result = await tx.query('UPDATE categories SET name=$2, description=$3, updated_at=now() WHERE id=$1 RETURNING id', [id, d.name, d.description]);
      if (!result.rowCount) throw notFound('Category');
    } else {
      result = await tx.query('INSERT INTO categories (name, description) VALUES ($1,$2) RETURNING id', [d.name, d.description]);
    }
    await audit(tx, actor, {
      action: id ? 'update' : 'create', module: 'products', entityType: 'category', entityId: result.rows[0].id,
      summary: `${actor.userName} ${id ? 'updated' : 'created'} category ${d.name}`,
    });
    return { id: result.rows[0].id };
  });
}

export async function deleteCategory(actor: Actor, id: number) {
  return withTransaction(async (tx) => {
    const used = await tx.query('SELECT count(*)::int AS n FROM products WHERE category_id = $1', [id]);
    if (used.rows[0].n > 0) throw unprocessable(`This category has ${used.rows[0].n} product(s). Move them to another category first.`);
    const { rows } = await tx.query('DELETE FROM categories WHERE id = $1 RETURNING name', [id]);
    if (!rows[0]) throw notFound('Category');
    await audit(tx, actor, { action: 'delete', module: 'products', entityType: 'category', entityId: id, summary: `${actor.userName} deleted category ${rows[0].name}` });
  });
}

export async function listManufacturers() {
  const { rows } = await pool.query(
    `SELECT m.id, m.name, m.country, (SELECT count(*)::int FROM products p WHERE p.manufacturer_id = m.id) AS product_count
       FROM manufacturers m ORDER BY m.name`,
  );
  return rows;
}

export async function saveManufacturer(actor: Actor, id: number | null, d: { name: string; country: string | null }) {
  return withTransaction(async (tx) => {
    const dup = await tx.query('SELECT 1 FROM manufacturers WHERE lower(name) = lower($1) AND id <> $2', [d.name, id ?? 0]);
    if (dup.rowCount) throw conflict('A manufacturer with this name already exists.');
    const result = id
      ? await tx.query('UPDATE manufacturers SET name=$2, country=$3 WHERE id=$1 RETURNING id', [id, d.name, d.country])
      : await tx.query('INSERT INTO manufacturers (name, country) VALUES ($1,$2) RETURNING id', [d.name, d.country]);
    if (!result.rowCount) throw notFound('Manufacturer');
    await audit(tx, actor, {
      action: id ? 'update' : 'create', module: 'products', entityType: 'manufacturer', entityId: result.rows[0].id,
      summary: `${actor.userName} ${id ? 'updated' : 'created'} manufacturer ${d.name}`,
    });
    return { id: result.rows[0].id };
  });
}
