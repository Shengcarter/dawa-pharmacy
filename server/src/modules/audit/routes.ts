import { Router } from 'express';
import { z } from 'zod';
import { optionalIsoDate } from '@dawa/shared';
import { pool } from '../../db/pool';
import { requirePermission } from '../../middleware/auth';
import { likeParam, pageParams, paginated } from '../../lib/pagination';
import { sendCsv } from '../../lib/csv';
import { getSettings } from '../settings/service';

export const auditRouter = Router();
auditRouter.use(requirePermission('audit.view'));

auditRouter.get('/', async (req, res) => {
  const q = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
    search: z.string().trim().max(100).optional(),
    module: z.string().max(40).optional(),
    action: z.string().max(40).optional(),
    userId: z.coerce.number().int().positive().optional(),
    entityType: z.string().max(40).optional(),
    entityId: z.string().max(40).optional(),
    from: optionalIsoDate(),
    to: optionalIsoDate(),
    format: z.enum(['json', 'csv']).optional(),
  }).parse(req.query);
  const tz = (await getSettings()).general.timezone;
  const params: unknown[] = [tz];
  const where: string[] = [];
  const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replaceAll('$?', `$${params.length}`)); };
  if (q.search) add('(a.summary ILIKE $? OR a.user_name ILIKE $?)', likeParam(q.search));
  if (q.module) add('a.module = $?', q.module);
  if (q.action) add('a.action = $?', q.action);
  if (q.userId) add('a.user_id = $?', q.userId);
  if (q.entityType) add('a.entity_type = $?', q.entityType);
  if (q.entityId) add('a.entity_id = $?', q.entityId);
  if (q.from) add('(a.created_at AT TIME ZONE $1)::date >= $?::date', q.from);
  if (q.to) add('(a.created_at AT TIME ZONE $1)::date <= $?::date', q.to);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const csv = q.format === 'csv';
  const { limit, offset } = csv ? { limit: 50_000, offset: 0 } : pageParams(q.page, q.pageSize);
  const { rows } = await pool.query(
    `SELECT a.id, a.created_at, a.user_id, a.user_name, a.action, a.module, a.entity_type, a.entity_id, a.summary,
            a.old_values, a.new_values, a.ip, a.user_agent, count(*) OVER() AS total_count, $1::text AS tz
       FROM audit_logs a ${whereSql} ORDER BY a.created_at DESC, a.id DESC LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  if (csv) {
    sendCsv(res, 'audit-log.csv', [
      { header: 'Time', value: (r) => r.created_at },
      { header: 'User', value: (r) => r.user_name },
      { header: 'Module', value: (r) => r.module },
      { header: 'Action', value: (r) => r.action },
      { header: 'Record', value: (r) => (r.entity_type ? `${r.entity_type} ${r.entity_id ?? ''}` : '') },
      { header: 'Summary', value: (r) => r.summary },
      { header: 'IP', value: (r) => r.ip },
    ], rows);
    return;
  }
  res.json(paginated(rows.map(({ total_count: _t, tz: _z, ...r }) => r), rows[0]?.total_count ?? 0, q.page, q.pageSize));
});

auditRouter.get('/modules', async (_req, res) => {
  const { rows } = await pool.query('SELECT DISTINCT module FROM audit_logs ORDER BY module');
  res.json(rows.map((r) => r.module));
});

auditRouter.get('/login-activity', async (req, res) => {
  const q = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(50) }).parse(req.query);
  const { limit, offset } = pageParams(q.page, q.pageSize);
  const { rows } = await pool.query(
    `SELECT l.id, l.email, l.event, l.ip, l.user_agent, l.detail, l.created_at, u.full_name, count(*) OVER() AS total_count
       FROM login_activity l LEFT JOIN users u ON u.id = l.user_id ORDER BY l.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
  );
  res.json(paginated(rows.map(({ total_count: _t, ...r }) => r), rows[0]?.total_count ?? 0, q.page, q.pageSize));
});
