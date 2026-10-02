import { Router } from 'express';
import { z } from 'zod';
import { batchUpdateSchema, optionalIsoDate, stockAdjustmentSchema } from '@dawa/shared';
import { actorOf, requirePermission } from '../../middleware/auth';
import { sendCsv } from '../../lib/csv';
import * as inventory from './service';

const idParam = (v: unknown) => z.coerce.number().int().positive().parse(v);
const page = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  search: z.string().trim().max(100).optional(),
};
const batchQuery = z.object({
  ...page,
  sort: z.string().max(20).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  supplierId: z.coerce.number().int().positive().optional(),
  productId: z.coerce.number().int().positive().optional(),
  status: z.enum(['active', 'quarantined', 'disposed']).optional(),
  expiry: z.enum(['expired', 'd30', 'd60', 'd90', 'safe', 'all_risk']).optional(),
  stockStatus: z.enum(['in_stock', 'low_stock', 'critical', 'out_of_stock', 'expired']).optional(),
  includeEmpty: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
  format: z.enum(['json', 'csv']).optional(),
});

export const inventoryRouter = Router();
inventoryRouter.use(requirePermission('inventory.view'));

inventoryRouter.get('/batches', async (req, res) => {
  const q = batchQuery.parse(req.query);
  if (q.format === 'csv') {
    const result = await inventory.listBatches(actorOf(req), { ...q, page: 1, pageSize: 100_000 });
    sendCsv(res, 'stock-by-batch.csv', [
      { header: 'SKU', value: (r) => r.sku },
      { header: 'Product', value: (r) => r.product_name },
      { header: 'Category', value: (r) => r.category_name },
      { header: 'Batch', value: (r) => r.batch_number },
      { header: 'Expiry', value: (r) => r.expiry_date },
      { header: 'Quantity', value: (r) => r.quantity_on_hand },
      { header: 'Reorder level', value: (r) => r.reorder_level },
      { header: 'Unit cost', value: (r) => r.unit_cost },
      { header: 'Selling price', value: (r) => r.selling_price },
      { header: 'Stock value', value: (r) => r.stock_value },
      { header: 'Supplier', value: (r) => r.supplier_name },
      { header: 'Status', value: (r) => r.stock_status },
    ], result.data);
    return;
  }
  res.json(await inventory.listBatches(actorOf(req), q));
});

inventoryRouter.get('/expiry-summary', async (req, res) => {
  res.json(await inventory.expirySummary(actorOf(req)));
});

inventoryRouter.get('/batches/:id', async (req, res) => {
  res.json(await inventory.getBatch(actorOf(req), idParam(req.params.id)));
});

inventoryRouter.put('/batches/:id', requirePermission('inventory.adjust'), async (req, res) => {
  res.json(await inventory.updateBatch(actorOf(req), idParam(req.params.id), batchUpdateSchema.parse(req.body)));
});

inventoryRouter.post('/adjustments', requirePermission('inventory.adjust'), async (req, res) => {
  res.status(201).json(await inventory.adjustStock(actorOf(req), stockAdjustmentSchema.parse(req.body)));
});

inventoryRouter.get('/adjustments', async (req, res) => {
  const q = z.object({ ...page, type: z.string().max(20).optional(), from: optionalIsoDate(), to: optionalIsoDate() }).parse(req.query);
  res.json(await inventory.listAdjustments(actorOf(req), q));
});

inventoryRouter.get('/movements', async (req, res) => {
  const q = z.object({
    ...page,
    type: z.string().max(20).optional(),
    productId: z.coerce.number().int().positive().optional(),
    batchId: z.coerce.number().int().positive().optional(),
    userId: z.coerce.number().int().positive().optional(),
    from: optionalIsoDate(),
    to: optionalIsoDate(),
    format: z.enum(['json', 'csv']).optional(),
  }).parse(req.query);
  if (q.format === 'csv') {
    const result = await inventory.listMovements(actorOf(req), { ...q, page: 1, pageSize: 100_000 });
    sendCsv(res, 'stock-movements.csv', [
      { header: 'Date', value: (r) => r.created_at },
      { header: 'Type', value: (r) => r.movement_type },
      { header: 'SKU', value: (r) => r.sku },
      { header: 'Product', value: (r) => r.product_name },
      { header: 'Batch', value: (r) => r.batch_number },
      { header: 'Quantity', value: (r) => r.quantity },
      { header: 'Before', value: (r) => r.quantity_before },
      { header: 'After', value: (r) => r.quantity_after },
      { header: 'Reference', value: (r) => r.reference_no },
      { header: 'Reason', value: (r) => r.reason },
      { header: 'User', value: (r) => r.user_name },
    ], result.data);
    return;
  }
  res.json(await inventory.listMovements(actorOf(req), q));
});
