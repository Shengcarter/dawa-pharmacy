import { Router } from 'express';
import { z } from 'zod';
import { expenseSchema, optionalIsoDate, requiredText } from '@dawa/shared';
import { actorOf, requirePermission } from '../../middleware/auth';
import { badRequest, notFound } from '../../lib/errors';
import { PRIVATE_DIR, receiptUpload, removeStoredFile, safeResolve } from '../../lib/uploads';
import * as expenses from './service';

const idParam = (v: unknown) => z.coerce.number().int().positive().parse(v);

export const expensesRouter = Router();
expensesRouter.get('/categories', requirePermission('expenses.view'), async (_req, res) => res.json(await expenses.listExpenseCategories()));
expensesRouter.post('/categories', requirePermission('expenses.manage'), async (req, res) => {
  const { name } = z.object({ name: requiredText('Name', 60) }).parse(req.body);
  res.status(201).json(await expenses.createExpenseCategory(actorOf(req), name));
});
expensesRouter.get('/', requirePermission('expenses.view'), async (req, res) => {
  const q = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(25),
    search: z.string().trim().max(100).optional(),
    categoryId: z.coerce.number().int().positive().optional(),
    from: optionalIsoDate(),
    to: optionalIsoDate(),
    includeVoided: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
  }).parse(req.query);
  res.json(await expenses.listExpenses(actorOf(req), q));
});
expensesRouter.post('/', requirePermission('expenses.manage'), async (req, res) => {
  res.status(201).json(await expenses.createExpense(actorOf(req), expenseSchema.parse(req.body)));
});
expensesRouter.put('/:id', requirePermission('expenses.manage'), async (req, res) => {
  res.json(await expenses.updateExpense(actorOf(req), idParam(req.params.id), expenseSchema.parse(req.body)));
});
expensesRouter.post('/:id/void', requirePermission('expenses.manage'), async (req, res) => {
  const { reason } = z.object({ reason: requiredText('Reason', 300) }).parse(req.body);
  await expenses.voidExpense(actorOf(req), idParam(req.params.id), reason);
  res.json({ message: 'Expense voided.' });
});
expensesRouter.post('/:id/receipt', requirePermission('expenses.manage'), ...receiptUpload, async (req, res) => {
  if (!req.file) throw badRequest('Choose a file to upload.');
  const id = idParam(req.params.id);
  const before = await expenses.getExpense(actorOf(req), id);
  await expenses.setReceipt(actorOf(req), id, `receipts/${req.file.filename}`);
  await removeStoredFile(PRIVATE_DIR, before.receipt_path);
  res.json({ message: 'Receipt attached.' });
});
expensesRouter.get('/:id/receipt', requirePermission('expenses.view'), async (req, res) => {
  const expense = await expenses.getExpense(actorOf(req), idParam(req.params.id));
  if (!expense.receipt_path) throw notFound('Receipt');
  res.setHeader('Cache-Control', 'private, no-store');
  // Uploaded content never runs as part of the app: sandboxed, and PDFs download instead of opening inline.
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; sandbox");
  if (expense.receipt_path.endsWith('.pdf')) res.attachment(`receipt-${expense.expense_no}.pdf`);
  res.sendFile(safeResolve(PRIVATE_DIR, expense.receipt_path));
});
