import { Router } from 'express';
import { z } from 'zod';
import { customerSchema, paginationQuery } from '@dawa/shared';
import { actorOf, requirePermission } from '../../middleware/auth';
import * as customers from './service';

const idParam = (v: unknown) => z.coerce.number().int().positive().parse(v);

export const customersRouter = Router();
customersRouter.get('/', requirePermission('customers.view'), async (req, res) => {
  const q = paginationQuery.extend({
    type: z.string().max(20).optional(),
    status: z.enum(['active', 'inactive']).optional(),
    withBalance: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
  }).parse(req.query);
  res.json(await customers.listCustomers(q));
});
customersRouter.get('/lookup', requirePermission('customers.view', 'pos.sell'), async (req, res) => {
  const { q } = z.object({ q: z.string().trim().min(1).max(60) }).parse(req.query);
  res.json(await customers.quickSearch(q));
});
customersRouter.get('/:id', requirePermission('customers.view'), async (req, res) => {
  res.json(await customers.getCustomer(actorOf(req), idParam(req.params.id)));
});
customersRouter.post('/', requirePermission('customers.manage'), async (req, res) => {
  res.status(201).json(await customers.createCustomer(actorOf(req), customerSchema.parse(req.body)));
});
customersRouter.put('/:id', requirePermission('customers.manage'), async (req, res) => {
  res.json(await customers.updateCustomer(actorOf(req), idParam(req.params.id), customerSchema.parse(req.body)));
});
