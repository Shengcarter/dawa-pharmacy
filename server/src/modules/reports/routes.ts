import { Router, type Response } from 'express';
import { z } from 'zod';
import { optionalIsoDate } from '@dawa/shared';
import { actorOf, requirePermission } from '../../middleware/auth';
import { sendCsv, type CsvColumn } from '../../lib/csv';
import { unprocessable } from '../../lib/errors';
import * as reports from './service';

const filters = z.object({
  from: optionalIsoDate('From date'),
  to: optionalIsoDate('To date'),
  productId: z.coerce.number().int().positive().optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  staffId: z.coerce.number().int().positive().optional(),
  supplierId: z.coerce.number().int().positive().optional(),
  expenseCategoryId: z.coerce.number().int().positive().optional(),
  days: z.coerce.number().int().min(0).max(730).default(90),
  format: z.enum(['json', 'csv']).optional(),
});

async function parse(query: unknown) {
  const f = filters.parse(query);
  const range = await reports.resolveRange(f.from, f.to);
  if (range.from > range.to) throw unprocessable('"From" must be on or before "To".');
  return { ...f, ...range };
}

function respond<T>(res: Response, format: string | undefined, filename: string, payload: { rows: T[] }, columns: CsvColumn<T>[]) {
  if (format === 'csv') sendCsv(res, filename, columns, payload.rows);
  else res.json(payload);
}

type Row = Record<string, unknown>;
const col = (header: string, key: string): CsvColumn<Row> => ({ header, value: (r) => r[key] });

export const reportsRouter = Router();

reportsRouter.get('/sales', requirePermission('reports.sales'), async (req, res) => {
  const f = await parse(req.query);
  respond(res, f.format, `sales-${f.from}-to-${f.to}.csv`, await reports.salesReport(actorOf(req), f), [
    col('Date', 'created_at'), col('Invoice', 'invoice_no'), col('Customer', 'customer_name'), col('Staff', 'staff_name'),
    col('Products', 'products'), col('Revenue (ex tax)', 'revenue'), col('Discount', 'discount_total'), col('Tax', 'tax_total'),
    col('Total', 'total'), col('Payment', 'payment_type'), col('Status', 'status'),
  ]);
});

reportsRouter.get('/product-sales', requirePermission('reports.sales'), async (req, res) => {
  const f = await parse(req.query);
  const rows = await reports.productSales(actorOf(req), f);
  const canSeeProfit = actorOf(req).permissions.has('reports.financial');
  const safe = canSeeProfit ? rows : rows.map(({ cost: _c, gross_profit: _g, margin: _m, ...r }) => r);
  respond(res, f.format, `product-sales-${f.from}-to-${f.to}.csv`, { rows: safe as Row[] }, [
    col('SKU', 'sku'), col('Product', 'name'), col('Category', 'category_name'), col('Quantity', 'quantity'), col('Revenue', 'revenue'),
    ...(canSeeProfit ? [col('Cost', 'cost'), col('Gross profit', 'gross_profit')] : []),
  ]);
});

reportsRouter.get('/profit-loss', requirePermission('reports.financial'), async (req, res) => {
  const f = await parse(req.query);
  const pl = await reports.profitAndLoss(actorOf(req), f);
  if (f.format === 'csv') {
    sendCsv(res, `profit-and-loss-${f.from}-to-${f.to}.csv`, [col('Line', 'line'), col('Amount', 'amount')], [
      { line: 'Gross sales (ex tax)', amount: pl.grossSales },
      { line: 'Less customer returns', amount: -pl.returns },
      { line: 'Net revenue', amount: pl.netRevenue },
      { line: 'Cost of goods sold', amount: -pl.cogs },
      { line: 'Gross profit', amount: pl.grossProfit },
      { line: 'Stock losses (damaged, expired, missing)', amount: -pl.stockLosses },
      ...pl.expensesByCategory.map((e) => ({ line: `Expense: ${e.category}`, amount: -Number(e.amount) })),
      { line: 'Total operating expenses', amount: -pl.operatingExpenses },
      { line: 'Net profit', amount: pl.netProfit },
      { line: 'Tax collected (not revenue)', amount: pl.taxCollected },
    ]);
    return;
  }
  res.json(pl);
});

reportsRouter.get('/inventory', requirePermission('reports.inventory'), async (req, res) => {
  const f = await parse(req.query);
  respond(res, f.format, 'inventory-valuation.csv', await reports.inventoryReport(actorOf(req), f), [
    col('SKU', 'sku'), col('Product', 'product_name'), col('Category', 'category_name'), col('Batch', 'batch_number'),
    col('Expiry', 'expiry_date'), col('Quantity', 'quantity'), col('Unit cost', 'unit_cost'), col('Stock value', 'stock_value'),
    col('Retail value', 'retail_value'),
  ]);
});

reportsRouter.get('/expiry', requirePermission('reports.inventory'), async (req, res) => {
  const f = await parse(req.query);
  respond(res, f.format, `expiry-within-${f.days}-days.csv`, await reports.expiryReport(actorOf(req), f), [
    col('Product', 'product_name'), col('SKU', 'sku'), col('Batch', 'batch_number'), col('Expiry date', 'expiry_date'),
    col('Days to expiry', 'days_to_expiry'), col('Quantity', 'quantity'), col('Value at risk', 'value_at_risk'), col('Supplier', 'supplier_name'),
  ]);
});

reportsRouter.get('/purchases', requirePermission('reports.purchases'), async (req, res) => {
  const f = await parse(req.query);
  respond(res, f.format, `purchases-${f.from}-to-${f.to}.csv`, await reports.purchaseReport(actorOf(req), f), [
    col('Order date', 'order_date'), col('PO number', 'po_number'), col('Supplier', 'supplier_name'), col('Status', 'status'),
    col('Order total', 'total'), col('Received value', 'received_value'),
  ]);
});

reportsRouter.get('/expenses', requirePermission('reports.financial'), async (req, res) => {
  const f = await parse(req.query);
  respond(res, f.format, `expenses-${f.from}-to-${f.to}.csv`, await reports.expenseReport(actorOf(req), f), [
    col('Date', 'expense_date'), col('Expense no', 'expense_no'), col('Category', 'category'), col('Description', 'description'),
    col('Amount', 'amount'), col('Payment method', 'payment_method'), col('Paid to', 'paid_to'), col('Employee', 'employee_name'),
  ]);
});

reportsRouter.get('/tax', requirePermission('reports.sales'), async (req, res) => {
  const f = await parse(req.query);
  respond(res, f.format, `tax-${f.from}-to-${f.to}.csv`, await reports.taxReport(actorOf(req), f), [
    col('Tax rate %', 'tax_rate'), col('Invoices', 'invoices'), col('Taxable amount', 'taxable_amount'), col('Tax', 'tax'),
    col('Tax refunded', 'returned_tax'),
  ]);
});

reportsRouter.get('/staff', requirePermission('reports.staff'), async (req, res) => {
  const f = await parse(req.query);
  respond(res, f.format, `staff-performance-${f.from}-to-${f.to}.csv`, await reports.staffPerformance(actorOf(req), f), [
    col('Staff', 'full_name'), col('Transactions', 'transactions'), col('Revenue', 'revenue'), col('Average sale', 'average_sale'),
    col('Discounts', 'discounts'), col('Returns', 'returns'), col('Returns value', 'returns_value'), col('Prescriptions dispensed', 'prescriptions_dispensed'),
  ]);
});
