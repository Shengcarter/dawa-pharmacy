import { formatMoney } from '@dawa/shared';
import { pool, withTransaction } from '../../db/pool';
import { occurredAt, type Actor } from '../../lib/actor';
import { audit, diff } from '../../lib/audit';
import { conflict, notFound, unprocessable } from '../../lib/errors';
import { likeParam, pageParams, paginated } from '../../lib/pagination';
import { nextDocumentNumber } from '../../lib/sequences';
import { businessToday } from '../../lib/today';
import { getSettings } from '../settings/service';

interface ExpenseData {
  categoryId: number;
  description: string;
  amount: number;
  paymentMethod: string;
  expenseDate: string;
  paidTo: string | null;
  employeeId: number | null;
  reference: string | null;
  notes: string | null;
}

export async function listExpenses(
  actor: Actor,
  q: { page: number; pageSize: number; search?: string; categoryId?: number; from?: string | null; to?: string | null; includeVoided?: boolean },
) {
  const params: unknown[] = [actor.branchId];
  const where = ['e.branch_id = $1'];
  if (!q.includeVoided) where.push('e.voided_at IS NULL');
  if (q.search) { params.push(likeParam(q.search)); where.push(`(e.description ILIKE $${params.length} OR e.paid_to ILIKE $${params.length} OR e.expense_no ILIKE $${params.length})`); }
  if (q.categoryId) { params.push(q.categoryId); where.push(`e.category_id = $${params.length}`); }
  if (q.from) { params.push(q.from); where.push(`e.expense_date >= $${params.length}::date`); }
  if (q.to) { params.push(q.to); where.push(`e.expense_date <= $${params.length}::date`); }
  const { limit, offset } = pageParams(q.page, q.pageSize);
  const { rows } = await pool.query(
    `SELECT e.id, e.expense_no, e.description, e.amount, e.payment_method, e.expense_date, e.paid_to, e.reference, e.notes,
            e.receipt_path IS NOT NULL AS has_receipt, e.voided_at, e.void_reason, e.created_at,
            ec.id AS category_id, ec.name AS category_name, emp.full_name AS employee_name, cu.full_name AS created_by_name,
            e.employee_id, count(*) OVER() AS total_count,
            sum(e.amount) FILTER (WHERE e.voided_at IS NULL) OVER() AS sum_amount
       FROM expenses e JOIN expense_categories ec ON ec.id = e.category_id LEFT JOIN users emp ON emp.id = e.employee_id
       JOIN users cu ON cu.id = e.created_by
      WHERE ${where.join(' AND ')} ORDER BY e.expense_date DESC, e.id DESC LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  return {
    ...paginated(rows.map(({ total_count: _t, sum_amount: _s, ...r }) => r), rows[0]?.total_count ?? 0, q.page, q.pageSize),
    sumAmount: Number(rows[0]?.sum_amount ?? 0),
  };
}

export async function getExpense(actor: Actor, id: number) {
  const { rows } = await pool.query('SELECT * FROM expenses WHERE id = $1 AND branch_id = $2', [id, actor.branchId]);
  if (!rows[0]) throw notFound('Expense');
  return rows[0];
}

async function assertRefs(d: ExpenseData) {
  if (!(await pool.query('SELECT 1 FROM expense_categories WHERE id = $1', [d.categoryId])).rowCount) throw unprocessable('Category not found.');
  if (d.employeeId && !(await pool.query('SELECT 1 FROM users WHERE id = $1', [d.employeeId])).rowCount) throw unprocessable('Employee not found.');
}

export async function createExpense(actor: Actor, d: ExpenseData) {
  const settings = await getSettings();
  const today = await businessToday(actor);
  if (d.expenseDate > today) throw unprocessable('Expense date cannot be in the future.');
  await assertRefs(d);
  return withTransaction(async (tx) => {
    const at = occurredAt(actor);
    const expenseNo = await nextDocumentNumber(tx, 'EXP', at);
    const { rows } = await tx.query(
      `INSERT INTO expenses (expense_no, branch_id, category_id, description, amount, payment_method, expense_date, paid_to, employee_id,
                             reference, notes, created_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13) RETURNING id`,
      [expenseNo, actor.branchId, d.categoryId, d.description, d.amount, d.paymentMethod, d.expenseDate, d.paidTo, d.employeeId,
       d.reference, d.notes, actor.userId, at],
    );
    await audit(tx, actor, {
      action: 'create', module: 'expenses', entityType: 'expense', entityId: rows[0].id,
      summary: `${actor.userName} recorded expense ${expenseNo}: ${d.description} — ${formatMoney(d.amount, settings.general.currency)}`,
    });
    return { id: rows[0].id, expenseNo };
  });
}

export async function updateExpense(actor: Actor, id: number, d: ExpenseData) {
  const settings = await getSettings();
  await assertRefs(d);
  return withTransaction(async (tx) => {
    const { rows } = await tx.query('SELECT * FROM expenses WHERE id = $1 AND branch_id = $2 FOR UPDATE', [id, actor.branchId]);
    const before = rows[0];
    if (!before) throw notFound('Expense');
    if (before.voided_at) throw unprocessable('A voided expense cannot be edited.');
    await tx.query(
      `UPDATE expenses SET category_id=$2, description=$3, amount=$4, payment_method=$5, expense_date=$6, paid_to=$7, employee_id=$8,
              reference=$9, notes=$10, updated_at=now() WHERE id=$1`,
      [id, d.categoryId, d.description, d.amount, d.paymentMethod, d.expenseDate, d.paidTo, d.employeeId, d.reference, d.notes],
    );
    const changes = diff(
      { amount: Number(before.amount), expenseDate: before.expense_date, categoryId: before.category_id, description: before.description },
      { amount: d.amount, expenseDate: d.expenseDate, categoryId: d.categoryId, description: d.description },
    );
    await audit(tx, actor, {
      action: 'update', module: 'expenses', entityType: 'expense', entityId: id,
      summary: `${actor.userName} edited expense ${before.expense_no}${changes?.new.amount !== undefined ? `: amount ${formatMoney(before.amount, settings.general.currency)} → ${formatMoney(d.amount, settings.general.currency)}` : ''}`,
      oldValues: changes?.old, newValues: changes?.new,
    });
    return { id };
  });
}

/** Expenses are voided, never deleted, so the books stay auditable. */
export async function voidExpense(actor: Actor, id: number, reason: string) {
  return withTransaction(async (tx) => {
    const { rows } = await tx.query('SELECT * FROM expenses WHERE id = $1 AND branch_id = $2 FOR UPDATE', [id, actor.branchId]);
    if (!rows[0]) throw notFound('Expense');
    if (rows[0].voided_at) throw conflict('This expense is already voided.');
    await tx.query('UPDATE expenses SET voided_at = now(), voided_by = $2, void_reason = $3 WHERE id = $1', [id, actor.userId, reason]);
    await audit(tx, actor, { action: 'void', module: 'expenses', entityType: 'expense', entityId: id, summary: `${actor.userName} voided expense ${rows[0].expense_no}: ${reason}` });
  });
}

export async function setReceipt(actor: Actor, id: number, path: string | null) {
  const { rows } = await pool.query(
    'UPDATE expenses SET receipt_path = $3, updated_at = now() WHERE id = $1 AND branch_id = $2 RETURNING expense_no',
    [id, actor.branchId, path],
  );
  if (!rows[0]) throw notFound('Expense');
  await audit(pool, actor, { action: 'update', module: 'expenses', entityType: 'expense', entityId: id, summary: `${actor.userName} ${path ? 'attached a receipt to' : 'removed the receipt from'} ${rows[0].expense_no}` });
}

export async function listExpenseCategories() {
  const { rows } = await pool.query(
    `SELECT ec.id, ec.name, ec.is_system, (SELECT count(*)::int FROM expenses e WHERE e.category_id = ec.id) AS expense_count
       FROM expense_categories ec ORDER BY ec.name`,
  );
  return rows;
}

export async function createExpenseCategory(actor: Actor, name: string) {
  const dup = await pool.query('SELECT 1 FROM expense_categories WHERE lower(name) = lower($1)', [name]);
  if (dup.rowCount) throw conflict('This category already exists.');
  const { rows } = await pool.query('INSERT INTO expense_categories (name) VALUES ($1) RETURNING id', [name]);
  await audit(pool, actor, { action: 'create', module: 'expenses', entityType: 'expense_category', entityId: rows[0].id, summary: `${actor.userName} added expense category ${name}` });
  return { id: rows[0].id };
}
