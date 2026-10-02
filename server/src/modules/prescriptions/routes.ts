import { Router } from 'express';
import { z } from 'zod';
import { optionalIsoDate, prescriptionSchema, requiredText } from '@dawa/shared';
import { actorOf, requirePermission } from '../../middleware/auth';
import * as rx from './service';

const idParam = (v: unknown) => z.coerce.number().int().positive().parse(v);

export const prescriptionsRouter = Router();
prescriptionsRouter.get('/', requirePermission('prescriptions.view'), async (req, res) => {
  const q = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(25),
    search: z.string().trim().max(100).optional(),
    status: z.enum(['pending', 'partially_dispensed', 'dispensed', 'cancelled']).optional(),
    customerId: z.coerce.number().int().positive().optional(),
    from: optionalIsoDate(),
    to: optionalIsoDate(),
  }).parse(req.query);
  res.json(await rx.listPrescriptions(actorOf(req), q));
});
prescriptionsRouter.get('/:id', requirePermission('prescriptions.view'), async (req, res) => {
  res.json(await rx.getPrescription(actorOf(req), idParam(req.params.id)));
});
prescriptionsRouter.post('/', requirePermission('prescriptions.manage'), async (req, res) => {
  res.status(201).json(await rx.createPrescription(actorOf(req), prescriptionSchema.parse(req.body)));
});
prescriptionsRouter.put('/:id', requirePermission('prescriptions.manage'), async (req, res) => {
  res.json(await rx.updatePrescription(actorOf(req), idParam(req.params.id), prescriptionSchema.parse(req.body)));
});
prescriptionsRouter.post('/:id/cancel', requirePermission('prescriptions.manage'), async (req, res) => {
  const { reason } = z.object({ reason: requiredText('Reason', 300) }).parse(req.body);
  await rx.cancelPrescription(actorOf(req), idParam(req.params.id), reason);
  res.json({ message: 'Prescription cancelled.' });
});
