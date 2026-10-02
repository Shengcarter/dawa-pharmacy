import { Router } from 'express';
import { z } from 'zod';
import { actorOf, requirePermission } from '../../middleware/auth';
import { audit } from '../../lib/audit';
import { pool } from '../../db/pool';
import { backupPath, createBackup, listBackups } from './service';

export const backupsRouter = Router();
backupsRouter.use(requirePermission('backups.manage'));
backupsRouter.get('/', async (_req, res) => res.json(await listBackups()));
backupsRouter.post('/', async (req, res) => res.status(201).json(await createBackup(actorOf(req))));
backupsRouter.get('/:name', async (req, res) => {
  const name = z.string().max(64).parse(req.params.name);
  const file = backupPath(name);
  await audit(pool, actorOf(req), { action: 'download', module: 'system', entityType: 'backup', entityId: name, summary: `${actorOf(req).userName} downloaded backup ${name}` });
  res.download(file, name);
});
