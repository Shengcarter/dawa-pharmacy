import { Router } from 'express';
import { z } from 'zod';
import { actorOf, requirePermission } from '../../middleware/auth';
import * as notifications from './service';

export const notificationsRouter = Router();
notificationsRouter.get('/', async (req, res) => {
  const q = z.object({
    unreadOnly: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    type: z.string().max(30).optional(),
  }).parse(req.query);
  res.json(await notifications.listNotifications(actorOf(req), q));
});
notificationsRouter.post('/read', async (req, res) => {
  const { ids } = z.object({ ids: z.union([z.literal('all'), z.array(z.coerce.number().int().positive()).max(500)]) }).parse(req.body);
  await notifications.markRead(actorOf(req), ids);
  res.status(204).end();
});
notificationsRouter.post('/refresh', requirePermission('inventory.view'), async (_req, res) => {
  await notifications.runAllAlerts();
  res.status(204).end();
});
