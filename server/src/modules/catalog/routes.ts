import { Router } from 'express';
import { z } from 'zod';
import {
  bulkProductStatusSchema, categorySchema, manufacturerSchema, productListQuery, productSchema, productUpdateSchema,
} from '@dawa/shared';
import { actorOf, requirePermission } from '../../middleware/auth';
import { badRequest } from '../../lib/errors';
import { PUBLIC_DIR, productImageUpload, relativePublicPath, removeStoredFile } from '../../lib/uploads';
import { pool } from '../../db/pool';
import { sendCsv } from '../../lib/csv';
import * as catalog from './service';

const idParam = (v: unknown) => z.coerce.number().int().positive().parse(v);
const skuInput = z.object({
  sku: z.string().trim().toUpperCase().max(40).regex(/^[A-Z0-9][A-Z0-9-_.]*$/, 'Use letters, numbers and - _ . only').optional().nullable()
    .or(z.literal('').transform(() => null)).transform((v) => v ?? null),
});

export const productsRouter = Router();

productsRouter.get('/', requirePermission('products.view'), async (req, res) => {
  const q = productListQuery.parse(req.query);
  if (req.query.format === 'csv') {
    const result = await catalog.listProducts(actorOf(req), { ...q, page: 1, pageSize: 100_000 });
    const showCost = actorOf(req).permissions.has('products.manage') || actorOf(req).permissions.has('reports.financial');
    sendCsv(res, 'products.csv', [
      { header: 'SKU', value: (r) => r.sku },
      { header: 'Barcode', value: (r) => r.barcode },
      { header: 'Product', value: (r) => r.name },
      { header: 'Generic name', value: (r) => r.generic_name },
      { header: 'Category', value: (r) => r.category_name },
      { header: 'Type', value: (r) => r.product_type },
      { header: 'Unit', value: (r) => r.unit },
      { header: 'Sellable stock', value: (r) => r.sellable },
      { header: 'Reorder level', value: (r) => r.reorder_level },
      ...(showCost ? [{ header: 'Purchase price', value: (r: Record<string, unknown>) => r.purchase_price }] : []),
      { header: 'Selling price', value: (r) => r.selling_price },
      { header: 'Nearest expiry', value: (r) => r.nearest_expiry },
      { header: 'Stock status', value: (r) => r.stock_status },
      { header: 'Prescription only', value: (r) => (r.requires_prescription ? 'Yes' : 'No') },
      { header: 'Status', value: (r) => r.status },
    ], result.data as Record<string, unknown>[]);
    return;
  }
  res.json(await catalog.listProducts(actorOf(req), q));
});

productsRouter.get('/pos-search', requirePermission('pos.sell', 'prescriptions.manage'), async (req, res) => {
  const { q } = z.object({ q: z.string().trim().min(1).max(64) }).parse(req.query);
  res.json(await catalog.posSearch(actorOf(req), q));
});

productsRouter.get('/:id', requirePermission('products.view'), async (req, res) => {
  res.json(await catalog.getProduct(actorOf(req), idParam(req.params.id)));
});

productsRouter.post('/', requirePermission('products.manage'), async (req, res) => {
  const data = productSchema.parse(req.body);
  if (data.openingStock && !actorOf(req).permissions.has('inventory.adjust')) {
    throw badRequest('Recording opening stock requires the stock adjustment permission.');
  }
  res.status(201).json(await catalog.createProduct(actorOf(req), data));
});

productsRouter.put('/:id', requirePermission('products.manage'), async (req, res) => {
  const data = { ...productUpdateSchema.parse(req.body), ...skuInput.parse(req.body) };
  res.json(await catalog.updateProduct(actorOf(req), idParam(req.params.id), data));
});

productsRouter.post('/bulk-status', requirePermission('products.manage'), async (req, res) => {
  const { ids, status } = bulkProductStatusSchema.parse(req.body);
  res.json(await catalog.bulkSetStatus(actorOf(req), ids, status));
});

productsRouter.post('/:id/barcode', requirePermission('products.manage'), async (req, res) => {
  res.json(await catalog.generateBarcode(actorOf(req), idParam(req.params.id)));
});

productsRouter.post('/:id/image', requirePermission('products.manage'), productImageUpload, async (req, res) => {
  if (!req.file) throw badRequest('Choose an image to upload.');
  const id = idParam(req.params.id);
  const { rows } = await pool.query('SELECT image_path FROM products WHERE id = $1', [id]);
  const imagePath = relativePublicPath('products', req.file.filename);
  await catalog.setProductImage(actorOf(req), id, imagePath);
  await removeStoredFile(PUBLIC_DIR, rows[0]?.image_path);
  res.json({ imagePath });
});

productsRouter.delete('/:id/image', requirePermission('products.manage'), async (req, res) => {
  const id = idParam(req.params.id);
  const { rows } = await pool.query('SELECT image_path FROM products WHERE id = $1', [id]);
  await catalog.setProductImage(actorOf(req), id, null);
  await removeStoredFile(PUBLIC_DIR, rows[0]?.image_path);
  res.status(204).end();
});

export const categoriesRouter = Router();
categoriesRouter.get('/', async (_req, res) => res.json(await catalog.listCategories()));
categoriesRouter.post('/', requirePermission('products.manage'), async (req, res) => {
  res.status(201).json(await catalog.saveCategory(actorOf(req), null, categorySchema.parse(req.body)));
});
categoriesRouter.put('/:id', requirePermission('products.manage'), async (req, res) => {
  res.json(await catalog.saveCategory(actorOf(req), idParam(req.params.id), categorySchema.parse(req.body)));
});
categoriesRouter.delete('/:id', requirePermission('products.manage'), async (req, res) => {
  await catalog.deleteCategory(actorOf(req), idParam(req.params.id));
  res.status(204).end();
});

export const manufacturersRouter = Router();
manufacturersRouter.get('/', async (_req, res) => res.json(await catalog.listManufacturers()));
manufacturersRouter.post('/', requirePermission('products.manage'), async (req, res) => {
  res.status(201).json(await catalog.saveManufacturer(actorOf(req), null, manufacturerSchema.parse(req.body)));
});
manufacturersRouter.put('/:id', requirePermission('products.manage'), async (req, res) => {
  res.json(await catalog.saveManufacturer(actorOf(req), idParam(req.params.id), manufacturerSchema.parse(req.body)));
});
