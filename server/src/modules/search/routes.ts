import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool';
import { actorOf } from '../../middleware/auth';
import { can } from '../../lib/actor';
import { likeParam } from '../../lib/pagination';

/**
 * Global search across the records a user may see. Each group is a small,
 * index-backed query (trigram indexes on names and document numbers).
 */
export const searchRouter = Router();
searchRouter.get('/', async (req, res) => {
  const { q } = z.object({ q: z.string().trim().min(2).max(80) }).parse(req.query);
  const actor = actorOf(req);
  const like = likeParam(q);
  const tasks: Promise<[string, unknown[]]>[] = [];
  if (can(actor, 'products.view')) {
    tasks.push(pool.query(
      `SELECT id, name, sku, barcode, strength, generic_name FROM products
        WHERE barcode = $2 OR sku ILIKE $1 OR name ILIKE $1 OR generic_name ILIKE $1 OR brand_name ILIKE $1
        ORDER BY (barcode = $2 OR upper(sku) = upper($2)) DESC, (name ILIKE $3) DESC, name LIMIT 6`,
      [like, q, `${q.replace(/[\\%_]/g, '')}%`],
    ).then((r) => ['products', r.rows]));
  }
  if (can(actor, 'customers.view')) {
    tasks.push(pool.query(
      `SELECT id, full_name, code, phone FROM customers WHERE full_name ILIKE $1 OR code ILIKE $1 OR phone ILIKE $2 ORDER BY full_name LIMIT 5`,
      [like, likeParam(q.replace(/[\s-]/g, ''))],
    ).then((r) => ['customers', r.rows]));
  }
  if (can(actor, 'suppliers.view')) {
    tasks.push(pool.query(`SELECT id, name, code, phone FROM suppliers WHERE name ILIKE $1 OR code ILIKE $1 ORDER BY name LIMIT 5`, [like])
      .then((r) => ['suppliers', r.rows]));
  }
  if (can(actor, 'sales.view') || can(actor, 'sales.view_all')) {
    const own = can(actor, 'sales.view_all') ? '' : 'AND s.cashier_id = $3';
    tasks.push(pool.query(
      `SELECT s.id, s.invoice_no, s.total, s.created_at, c.full_name AS customer_name FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
        WHERE s.branch_id = $2 AND s.invoice_no ILIKE $1 ${own} ORDER BY s.created_at DESC LIMIT 5`,
      own ? [like, actor.branchId, actor.userId] : [like, actor.branchId],
    ).then((r) => ['invoices', r.rows]));
  }
  if (can(actor, 'purchasing.view')) {
    tasks.push(pool.query(
      `SELECT po.id, po.po_number, po.status, s.name AS supplier_name FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
        WHERE po.branch_id = $2 AND po.po_number ILIKE $1 ORDER BY po.created_at DESC LIMIT 5`,
      [like, actor.branchId],
    ).then((r) => ['purchaseOrders', r.rows]));
  }
  if (can(actor, 'prescriptions.view')) {
    tasks.push(pool.query(
      `SELECT rx.id, rx.rx_number, rx.status, c.full_name AS customer_name FROM prescriptions rx JOIN customers c ON c.id = rx.customer_id
        WHERE rx.branch_id = $2 AND rx.rx_number ILIKE $1 ORDER BY rx.created_at DESC LIMIT 5`,
      [like, actor.branchId],
    ).then((r) => ['prescriptions', r.rows]));
  }
  res.json(Object.fromEntries(await Promise.all(tasks)));
});
