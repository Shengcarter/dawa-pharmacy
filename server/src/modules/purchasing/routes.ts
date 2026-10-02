import { Router } from 'express';
import { z } from 'zod';
import { goodsReceiptSchema, optionalIsoDate, poTransitionSchema, purchaseOrderSchema } from '@dawa/shared';
import { actorOf, requirePermission } from '../../middleware/auth';
import * as purchasing from './service';

const idParam = (v: unknown) => z.coerce.number().int().positive().parse(v);
const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  search: z.string().trim().max(100).optional(),
  status: z.string().max(30).optional(),
  supplierId: z.coerce.number().int().positive().optional(),
  from: optionalIsoDate(),
  to: optionalIsoDate(),
});

export const purchasingRouter = Router();

purchasingRouter.get('/orders', requirePermission('purchasing.view'), async (req, res) => {
  res.json(await purchasing.listPurchaseOrders(actorOf(req), listQuery.parse(req.query)));
});
purchasingRouter.get('/orders/:id', requirePermission('purchasing.view'), async (req, res) => {
  res.json(await purchasing.getPurchaseOrder(actorOf(req), idParam(req.params.id)));
});
purchasingRouter.post('/orders', requirePermission('purchasing.manage'), async (req, res) => {
  res.status(201).json(await purchasing.createPurchaseOrder(actorOf(req), purchaseOrderSchema.parse(req.body)));
});
purchasingRouter.put('/orders/:id', requirePermission('purchasing.manage'), async (req, res) => {
  res.json(await purchasing.updatePurchaseOrder(actorOf(req), idParam(req.params.id), purchaseOrderSchema.parse(req.body)));
});
purchasingRouter.post('/orders/:id/transition', requirePermission('purchasing.manage', 'purchasing.approve'), async (req, res) => {
  const { action, reason } = poTransitionSchema.parse(req.body);
  res.json(await purchasing.transitionPurchaseOrder(actorOf(req), idParam(req.params.id), action, reason));
});
purchasingRouter.get('/reorder-suggestions', requirePermission('purchasing.view'), async (req, res) => {
  const { supplierId } = z.object({ supplierId: z.coerce.number().int().positive().optional() }).parse(req.query);
  res.json(await purchasing.reorderSuggestions(actorOf(req), supplierId));
});
purchasingRouter.get('/receipts', requirePermission('purchasing.view', 'suppliers.payments'), async (req, res) => {
  res.json(await purchasing.listGoodsReceipts(actorOf(req), listQuery.parse(req.query)));
});
purchasingRouter.get('/receipts/:id', requirePermission('purchasing.view', 'suppliers.payments'), async (req, res) => {
  res.json(await purchasing.getGoodsReceipt(actorOf(req), idParam(req.params.id)));
});
purchasingRouter.post('/receipts', requirePermission('purchasing.receive'), async (req, res) => {
  res.status(201).json(await purchasing.receiveGoods(actorOf(req), goodsReceiptSchema.parse(req.body)));
});
