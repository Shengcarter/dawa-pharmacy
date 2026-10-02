import { Router } from 'express';
import { z } from 'zod';
import { optionalIsoDate, recordSalePaymentSchema, saleReturnSchema, saleSchema } from '@dawa/shared';
import { actorOf, requirePermission } from '../../middleware/auth';
import { sendCsv } from '../../lib/csv';
import { pool } from '../../db/pool';
import * as sales from './service';
import * as returns from './returns';

const idParam = (v: unknown) => z.coerce.number().int().positive().parse(v);
const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  search: z.string().trim().max(100).optional(),
  from: optionalIsoDate(),
  to: optionalIsoDate(),
  cashierId: z.coerce.number().int().positive().optional(),
  customerId: z.coerce.number().int().positive().optional(),
  paymentStatus: z.enum(['paid', 'partial', 'unpaid']).optional(),
  paymentType: z.string().max(20).optional(),
  status: z.string().max(30).optional(),
  format: z.enum(['json', 'csv']).optional(),
});

export const salesRouter = Router();

salesRouter.post('/', requirePermission('pos.sell'), async (req, res) => {
  res.status(201).json(await sales.createSale(actorOf(req), saleSchema.parse(req.body)));
});

salesRouter.get('/', requirePermission('sales.view', 'sales.view_all'), async (req, res) => {
  const q = listQuery.parse(req.query);
  if (q.format === 'csv') {
    const result = await sales.listSales(actorOf(req), { ...q, page: 1, pageSize: 100_000 });
    sendCsv(res, 'sales.csv', [
      { header: 'Invoice', value: (r) => r.invoice_no },
      { header: 'Date', value: (r) => r.created_at },
      { header: 'Customer', value: (r) => r.customer_name ?? 'Walk-in' },
      { header: 'Staff', value: (r) => r.cashier_name },
      { header: 'Units', value: (r) => r.units },
      { header: 'Discount', value: (r) => r.discount_total },
      { header: 'Tax', value: (r) => r.tax_total },
      { header: 'Total', value: (r) => r.total },
      { header: 'Paid', value: (r) => r.amount_paid },
      { header: 'Balance', value: (r) => r.balance_due },
      { header: 'Payment', value: (r) => r.payment_type },
      { header: 'Status', value: (r) => r.status },
    ], result.data);
    return;
  }
  res.json(await sales.listSales(actorOf(req), q));
});

salesRouter.get('/returns', requirePermission('sales.view', 'sales.view_all', 'sales.return'), async (req, res) => {
  res.json(await returns.listReturns(actorOf(req), listQuery.parse(req.query)));
});
salesRouter.get('/returns/:id', requirePermission('sales.view', 'sales.view_all', 'sales.return'), async (req, res) => {
  res.json(await returns.getReturn(actorOf(req), idParam(req.params.id)));
});
salesRouter.post('/returns', requirePermission('sales.return'), async (req, res) => {
  res.status(201).json(await returns.processReturn(actorOf(req), saleReturnSchema.parse(req.body)));
});

/** Find an invoice by number (returns desk). */
salesRouter.get('/by-invoice/:invoiceNo', requirePermission('sales.return', 'sales.view', 'sales.view_all'), async (req, res) => {
  const invoiceNo = z.string().trim().toUpperCase().max(30).parse(req.params.invoiceNo);
  const { rows } = await pool.query('SELECT id FROM sales WHERE upper(invoice_no) = $1 AND branch_id = $2', [invoiceNo, actorOf(req).branchId]);
  if (!rows[0]) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: `No invoice ${invoiceNo}.` } });
    return;
  }
  res.json(await sales.getSale(actorOf(req), rows[0].id));
});

salesRouter.get('/:id', requirePermission('sales.view', 'sales.view_all'), async (req, res) => {
  res.json(await sales.getSale(actorOf(req), idParam(req.params.id)));
});
salesRouter.get('/:id/receipt', requirePermission('sales.view', 'sales.view_all', 'pos.sell'), async (req, res) => {
  res.json(await sales.receiptData(actorOf(req), idParam(req.params.id)));
});
salesRouter.post('/:id/payments', requirePermission('sales.record_payment'), async (req, res) => {
  res.status(201).json(await sales.recordPayment(actorOf(req), idParam(req.params.id), recordSalePaymentSchema.parse(req.body)));
});
