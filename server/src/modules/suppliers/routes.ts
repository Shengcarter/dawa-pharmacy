import { Router } from 'express';
import { z } from 'zod';
import { paginationQuery, supplierPaymentSchema, supplierSchema } from '@dawa/shared';
import { actorOf, requirePermission } from '../../middleware/auth';
import * as suppliers from './service';

const idParam = (v: unknown) => z.coerce.number().int().positive().parse(v);

export const suppliersRouter = Router();

suppliersRouter.get('/options', requirePermission('suppliers.view', 'purchasing.view', 'products.view', 'inventory.view'), async (_req, res) => {
  res.json(await suppliers.supplierOptions());
});
suppliersRouter.get('/', requirePermission('suppliers.view'), async (req, res) => {
  res.json(await suppliers.listSuppliers(paginationQuery.extend({ status: z.enum(['active', 'inactive']).optional() }).parse(req.query)));
});
suppliersRouter.get('/:id', requirePermission('suppliers.view'), async (req, res) => {
  res.json(await suppliers.getSupplier(idParam(req.params.id)));
});
suppliersRouter.post('/', requirePermission('suppliers.manage'), async (req, res) => {
  res.status(201).json(await suppliers.createSupplier(actorOf(req), supplierSchema.parse(req.body)));
});
suppliersRouter.put('/:id', requirePermission('suppliers.manage'), async (req, res) => {
  res.json(await suppliers.updateSupplier(actorOf(req), idParam(req.params.id), supplierSchema.parse(req.body)));
});
suppliersRouter.post('/payments', requirePermission('suppliers.payments'), async (req, res) => {
  res.status(201).json(await suppliers.recordSupplierPayment(actorOf(req), supplierPaymentSchema.parse(req.body)));
});
