import { Router } from 'express';
import { z } from 'zod';
import { branchSchema } from '@dawa/shared';
import { pool, withTransaction } from '../../db/pool';
import { actorOf, requirePermission } from '../../middleware/auth';
import { audit } from '../../lib/audit';
import { conflict, notFound, unprocessable } from '../../lib/errors';

const idParam = (v: unknown) => z.coerce.number().int().positive().parse(v);

export const branchesRouter = Router();

/** Every signed-in user may list branches (for pickers); only settings managers change them. */
branchesRouter.get('/', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT b.id, b.code, b.name, b.address, b.phone, b.is_active, b.created_at,
            (SELECT count(*)::int FROM users u WHERE u.branch_id = b.id AND u.status = 'active') AS user_count,
            (SELECT COALESCE(sum(quantity_on_hand * unit_cost), 0) FROM product_batches pb WHERE pb.branch_id = b.id) AS stock_value
       FROM branches b ORDER BY b.id`,
  );
  res.json(rows);
});

async function save(req: import('express').Request, id: number | null) {
  const actor = actorOf(req);
  const d = branchSchema.parse(req.body);
  return withTransaction(async (tx) => {
    const dup = await tx.query('SELECT 1 FROM branches WHERE (code = $1 OR lower(name) = lower($2)) AND id <> $3', [d.code, d.name, id ?? 0]);
    if (dup.rowCount) throw conflict('Another branch already uses this code or name.');
    if (id && !d.isActive) {
      if (id === actor.branchId) throw unprocessable('You cannot deactivate the branch you are working in.');
      const users = await tx.query(`SELECT count(*)::int AS n FROM users WHERE branch_id = $1 AND status = 'active'`, [id]);
      if (users.rows[0].n > 0) throw unprocessable('Move or suspend this branch’s active users first.');
    }
    const r = id
      ? await tx.query('UPDATE branches SET code=$2, name=$3, address=$4, phone=$5, is_active=$6 WHERE id=$1 RETURNING id', [id, d.code, d.name, d.address, d.phone, d.isActive])
      : await tx.query('INSERT INTO branches (code, name, address, phone, is_active) VALUES ($1,$2,$3,$4,$5) RETURNING id', [d.code, d.name, d.address, d.phone, d.isActive]);
    if (!r.rows[0]) throw notFound('Branch');
    await audit(tx, actor, {
      action: id ? 'update' : 'create', module: 'settings', entityType: 'branch', entityId: r.rows[0].id,
      summary: `${actor.userName} ${id ? 'updated' : 'created'} branch ${d.name} (${d.code})${d.isActive ? '' : ' — inactive'}`,
      newValues: d,
    });
    return { id: r.rows[0].id as number };
  });
}

branchesRouter.post('/', requirePermission('settings.manage'), async (req, res) => {
  res.status(201).json(await save(req, null));
});
branchesRouter.put('/:id', requirePermission('settings.manage'), async (req, res) => {
  res.json(await save(req, idParam(req.params.id)));
});
