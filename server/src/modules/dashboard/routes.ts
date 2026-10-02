import { Router } from 'express';
import { z } from 'zod';
import { actorOf, requirePermission } from '../../middleware/auth';
import { dashboard } from './service';

export const dashboardRouter = Router();
dashboardRouter.get('/', requirePermission('dashboard.view'), async (req, res) => {
  const { period } = z.object({ period: z.enum(['today', '7d', '30d', '3m', '12m']).default('30d') }).parse(req.query);
  res.json(await dashboard(actorOf(req), period));
});
