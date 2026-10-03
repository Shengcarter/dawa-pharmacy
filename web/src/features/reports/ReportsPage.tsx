import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { EXPENSE_PAYMENT_METHODS, PAYMENT_METHODS, SALE_PAYMENT_TYPES, addDays } from '@dawa/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useListState } from '@/lib/hooks';
import { useFormat } from '@/lib/settings';
import { cn } from '@/lib/cn';
import { Page } from '@/components/layout/AppLayout';
import { Button, Card, DataTable, EmptyState, ErrorState, Figure, PageHeader, PageLoader, Pagination, Select, SummaryStrip, Toolbar, type Column } from '@/components/ui';
import { DateRangeFilter, ExportButton } from '@/components/Filters';
import { PoBadge } from '@/components/StatusBadges';
import { SalesAreaChart, ShareBars, SignedColumns } from '@/components/charts/SalesChart';
import { NoAccess, NotFound } from '../common/StatusPages';
import { useCategories } from '../inventory/ProductsPage';
import { useSupplierOptions } from '../inventory/ProductFormPage';
import { useStaffOptions } from '../sales/SalesPage';
import { useExpenseCategories } from '../expenses/ExpensesPage';

type Filters = Record<string, string>;

const REPORTS: Record<string, { title: string; description: string; permission: string; endpoint: string; dated: boolean; filters: ('category' | 'supplier' | 'staff' | 'expenseCategory' | 'days')[] }> = {
  sales: { title: 'Sales report', description: 'Invoices, revenue, discounts and tax for the period.', permission: 'reports.sales', endpoint: '/reports/sales', dated: true, filters: ['category', 'staff'] },
  purchases: { title: 'Purchase report', description: 'Orders placed and stock received, by supplier.', permission: 'reports.purchases', endpoint: '/reports/purchases', dated: true, filters: ['supplier'] },
  inventory: { title: 'Inventory valuation', description: 'Stock on hand by batch at cost and retail value, as of now.', permission: 'reports.inventory', endpoint: '/reports/inventory', dated: false, filters: ['category', 'supplier'] },
  'profit-loss': { title: 'Profit & loss', description: 'Built from actual transactions: batch cost of goods sold, returns, stock losses and expenses.', permission: 'reports.financial', endpoint: '/reports/profit-loss', dated: true, filters: [] },
  expenses: { title: 'Expense report', description: 'Operating expenses by category.', permission: 'reports.financial', endpoint: '/reports/expenses', dated: true, filters: ['expenseCategory'] },
  expiry: { title: 'Expiry report', description: 'Expired stock and stock expiring within the chosen window, with value at risk.', permission: 'reports.inventory', endpoint: '/reports/expiry', dated: false, filters: ['days', 'category', 'supplier'] },
  tax: { title: 'Tax report', description: 'VAT collected on sales by rate, net of refunds.', permission: 'reports.sales', endpoint: '/reports/tax', dated: true, filters: [] },
  staff: { title: 'Staff performance', description: 'Sales, discounts, returns and dispensing per staff member.', permission: 'reports.staff', endpoint: '/reports/staff', dated: true, filters: [] },
};

export function ReportsPage() {
  const { report = '' } = useParams();
  const { can } = useAuth();
  const def = REPORTS[report];
  if (!def) return <NotFound />;
  if (!can(def.permission)) return <NoAccess />;
  return <ReportView key={report} id={report} def={def} />;
}

function ReportView({ id, def }: { id: string; def: (typeof REPORTS)[string] }) {
  const { today } = useFormat();
  const t = today();
  const [s, set] = useListState({ from: `${t.slice(0, 8)}01`, to: t, categoryId: '', supplierId: '', staffId: '', expenseCategoryId: '', days: '90' });
  const query: Filters = Object.fromEntries(
    Object.entries({
      from: def.dated ? s.from : '', to: def.dated ? s.to : '', categoryId: s.categoryId, supplierId: s.supplierId, staffId: s.staffId,
      expenseCategoryId: s.expenseCategoryId, days: def.filters.includes('days') ? s.days : '',
    }).filter(([, v]) => v),
  );
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['report', id, query],
    queryFn: () => api.get<Record<string, unknown>>(def.endpoint, query),
    placeholderData: (p) => p,
  });
  return (
    <Page wide>
      <PageHeader
        title={def.title}
        description={def.description}
        actions={
          <>
            <Button icon={<Printer className="size-3.5" />} onClick={() => window.print()}>Print / PDF</Button>
            <ExportButton path={def.endpoint} query={query} />
          </>
        }
      />
      <Card flush className="mb-4 no-print">
        <Toolbar className="border-0">
          {def.dated && <DateRangeFilter value={{ from: s.from, to: s.to }} onChange={(r) => set(r)} today={t} />}
          <ReportFilters def={def} s={s} set={set} />
        </Toolbar>
      </Card>
      <div className={cn('print-area transition-opacity', isFetching && data && 'opacity-60')}>
        <PrintHeading title={def.title} range={def.dated ? `${s.from} – ${s.to}` : `As of ${t}`} />
        {error ? <Card><ErrorState error={error} onRetry={refetch} /></Card> : isLoading || !data ? <PageLoader /> : <ReportBody id={id} data={data} range={{ from: s.from, to: s.to }} />}
      </div>
    </Page>
  );
}

function PrintHeading({ title, range }: { title: string; range: string }) {
  const { settings } = useFormat();
  return (
    <div className="mb-4 hidden print:block">
      <p className="text-[16px] font-bold">{settings?.general.pharmacyName} — {title}</p>
      <p className="text-[12px]">{range}</p>
    </div>
  );
}

function ReportFilters({ def, s, set }: { def: (typeof REPORTS)[string]; s: Filters; set: (p: Filters) => void }) {
  const categories = useCategories();
  const suppliers = useSupplierOptions();
  const staff = useStaffOptions(def.filters.includes('staff'));
  const expenseCats = useExpenseCategories();
  return (
    <>
      {def.filters.includes('days') && (
        <Select value={s.days} onChange={(e) => set({ days: e.target.value })} className="w-44" aria-label="Window">
          <option value="0">Expired only</option>
          <option value="30">Expired + 30 days</option>
          <option value="60">Expired + 60 days</option>
          <option value="90">Expired + 90 days</option>
          <option value="180">Expired + 180 days</option>
        </Select>
      )}
      {def.filters.includes('category') && (
        <Select value={s.categoryId} onChange={(e) => set({ categoryId: e.target.value })} className="w-44" aria-label="Category">
          <option value="">All categories</option>
          {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      )}
      {def.filters.includes('supplier') && (
        <Select value={s.supplierId} onChange={(e) => set({ supplierId: e.target.value })} className="w-48" aria-label="Supplier">
          <option value="">All suppliers</option>
          {suppliers.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      )}
      {def.filters.includes('staff') && (
        <Select value={s.staffId} onChange={(e) => set({ staffId: e.target.value })} className="w-40" aria-label="Staff">
          <option value="">All staff</option>
          {staff.data?.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
        </Select>
      )}
      {def.filters.includes('expenseCategory') && (
        <Select value={s.expenseCategoryId} onChange={(e) => set({ expenseCategoryId: e.target.value })} className="w-40" aria-label="Expense category">
          <option value="">All categories</option>
          {expenseCats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      )}
    </>
  );
}

/** Client-side paging for report rows (reports return the full period in one request). */
function PagedTable<T>({ rows, columns, rowKey, empty }: { rows: T[]; columns: Column<T>[]; rowKey: (r: T) => string | number; empty?: ReactNode }) {
  const [page, setPage] = useState(1);
  const size = 50;
  const slice = useMemo(() => rows.slice((page - 1) * size, page * size), [rows, page]);
  return (
    <>
      <DataTable rows={slice} columns={columns} rowKey={rowKey} empty={empty ?? <EmptyState compact title="No data for this period" />} />
      {rows.length > size && <div className="no-print"><Pagination page={page} pageSize={size} total={rows.length} onChange={setPage} /></div>}
    </>
  );
}

function ReportBody({ id, data, range }: { id: string; data: Record<string, unknown>; range: { from: string; to: string } }) {
  switch (id) {
    case 'sales': return <SalesReport data={data as never} range={range} />;
    case 'purchases': return <PurchasesReport data={data as never} />;
    case 'inventory': return <InventoryReport data={data as never} />;
    case 'profit-loss': return <ProfitLossReport data={data as never} />;
    case 'expenses': return <ExpensesReport data={data as never} />;
    case 'expiry': return <ExpiryReport data={data as never} />;
    case 'tax': return <TaxReport data={data as never} />;
    case 'staff': return <StaffReport data={data as never} />;
    default: return null;
  }
}

// ---------------------------------------------------------------------------
function SalesReport({ data, range }: {
  data: { summary: { transactions: number; subtotal: number; discount: number; tax: number; total: number; revenue: number; averageSale: number }; daily: { day: string; transactions: number; total: number }[]; byPayment: { method: string; amount: number; count: number }[];
    rows: { id: number; invoiceNo: string; createdAt: string; customerName: string | null; staffName: string; products: string; revenue: number; discountTotal: number; taxTotal: number; total: number; paymentType: string; status: string }[] };
  range: { from: string; to: string };
}) {
  const { money, amount, dateTime, currency } = useFormat();
  const { can } = useAuth();
  const products = useQuery({
    queryKey: ['report-products', range],
    queryFn: () => api.get<{ rows: { id: number; sku: string; name: string; categoryName: string | null; quantity: number; revenue: number; cost?: number; grossProfit?: number; margin?: number }[] }>('/reports/product-sales', range),
  });
  const points = useMemo(() => {
    const byDay = new Map(data.daily.map((d) => [String(d.day).slice(0, 10), d]));
    const out = [];
    for (let d = range.from; d <= range.to; d = addDays(d, 1)) {
      const hit = byDay.get(d);
      out.push({ bucket: d, total: Number(hit?.total ?? 0), transactions: hit?.transactions ?? 0 });
      if (out.length > 400) break;
    }
    return out;
  }, [data.daily, range]);
  const s = data.summary;
  return (
    <div className="space-y-4">
      <SummaryStrip className="lg:grid-cols-6">
        <Figure label="Invoices" value={s.transactions.toLocaleString()} />
        <Figure label="Gross sales" value={money(s.subtotal)} />
        <Figure label="Discounts" value={money(s.discount)} />
        <Figure label="Tax" value={money(s.tax)} />
        <Figure label="Total collected/billed" value={money(s.total)} tone="brand" />
        <Figure label="Average sale" value={money(s.averageSale)} />
      </SummaryStrip>
      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Daily sales" className="xl:col-span-2"><SalesAreaChart points={points} bucket="day" currency={currency} height={240} /></Card>
        <Card title="Payment methods">
          {data.byPayment.length ? <ShareBars rows={data.byPayment.map((p) => ({ label: `${PAYMENT_METHODS[p.method as keyof typeof PAYMENT_METHODS] ?? p.method} · ${p.count}`, value: Number(p.amount) }))} format={money} /> : <EmptyState compact title="No payments" />}
          <p className="mt-3 text-[11.5px] text-muted">Money received at the time of sale. Credit balances are excluded.</p>
        </Card>
      </div>
      <Card title="Products sold" flush>
        <PagedTable rows={products.data?.rows ?? []} rowKey={(r) => r.id} columns={[
          { key: 'name', header: 'Product', cell: (r) => <Link to={`/inventory/products/${r.id}`} className="hover:text-brand-700">{r.name}</Link> },
          { key: 'cat', header: 'Category', cell: (r) => r.categoryName ?? '—', hideBelow: 'md' },
          { key: 'qty', header: 'Qty', align: 'right', cell: (r) => <span className="num">{r.quantity.toLocaleString()}</span> },
          { key: 'rev', header: `Revenue (${currency})`, align: 'right', cell: (r) => <span className="num">{amount(r.revenue)}</span> },
          ...(can('reports.financial') ? [
            { key: 'cost', header: 'COGS', align: 'right' as const, cell: (r: { cost?: number }) => <span className="text-muted num">{amount(r.cost ?? 0)}</span>, hideBelow: 'md' as const },
            { key: 'gp', header: 'Gross profit', align: 'right' as const, cell: (r: { grossProfit?: number; margin?: number }) => <span className="num">{amount(r.grossProfit ?? 0)} <span className="text-[11.5px] text-muted">{((r.margin ?? 0) * 100).toFixed(0)}%</span></span> },
          ] : []),
        ]} />
      </Card>
      <Card title="Invoices" flush>
        <PagedTable rows={data.rows} rowKey={(r) => r.id} columns={[
          { key: 'date', header: 'Date', cell: (r) => <span className="text-muted num">{dateTime(r.createdAt)}</span> },
          { key: 'inv', header: 'Invoice', cell: (r) => <Link to={`/sales/${r.id}`} className="font-medium hover:text-brand-700">{r.invoiceNo}</Link> },
          { key: 'cust', header: 'Customer', cell: (r) => r.customerName ?? <span className="text-muted">Walk-in</span>, hideBelow: 'md' },
          { key: 'staff', header: 'Staff', cell: (r) => r.staffName, hideBelow: 'lg' },
          { key: 'prod', header: 'Products', cell: (r) => <span className="line-clamp-1 max-w-xs text-muted" title={r.products}>{r.products}</span>, hideBelow: 'xl' },
          { key: 'disc', header: 'Discount', align: 'right', cell: (r) => <span className="num">{r.discountTotal > 0 ? amount(r.discountTotal) : '—'}</span>, hideBelow: 'lg' },
          { key: 'tax', header: 'Tax', align: 'right', cell: (r) => <span className="num">{r.taxTotal > 0 ? amount(r.taxTotal) : '—'}</span>, hideBelow: 'lg' },
          { key: 'total', header: `Total (${currency})`, align: 'right', cell: (r) => <span className="font-medium num">{amount(r.total)}</span> },
          { key: 'pay', header: 'Payment', cell: (r) => SALE_PAYMENT_TYPES[r.paymentType as keyof typeof SALE_PAYMENT_TYPES], hideBelow: 'md' },
        ]} />
      </Card>
    </div>
  );
}

function PurchasesReport({ data }: { data: { summary: { orders: number; orderedValue: number; receivedValue: number; paid: number }; bySupplier: { id: number; supplierName: string; deliveries: number; receivedValue: number; paid: number }[]; rows: { id: number; poNumber: string; orderDate: string; status: string; total: number; supplierName: string; receivedValue: number }[] } }) {
  const { money, amount, date, currency } = useFormat();
  return (
    <div className="space-y-4">
      <SummaryStrip>
        <Figure label="Purchase orders" value={data.summary.orders.toLocaleString()} />
        <Figure label="Value ordered" value={money(data.summary.orderedValue)} sub="Excludes cancelled" />
        <Figure label="Stock received" value={money(data.summary.receivedValue)} tone="brand" />
        <Figure label="Paid to suppliers" value={money(data.summary.paid)} />
      </SummaryStrip>
      <Card title="By supplier" flush>
        <DataTable rows={data.bySupplier} rowKey={(r) => r.id} empty={<EmptyState compact title="No deliveries in this period" />} columns={[
          { key: 'name', header: 'Supplier', cell: (r) => <Link to={`/purchasing/suppliers/${r.id}`} className="hover:text-brand-700">{r.supplierName}</Link> },
          { key: 'del', header: 'Deliveries', align: 'right', cell: (r) => <span className="num">{r.deliveries}</span> },
          { key: 'recv', header: `Received (${currency})`, align: 'right', cell: (r) => <span className="num">{amount(r.receivedValue)}</span> },
          { key: 'paid', header: `Paid (${currency})`, align: 'right', cell: (r) => <span className="num">{amount(r.paid)}</span> },
        ]} />
      </Card>
      <Card title="Purchase orders" flush>
        <PagedTable rows={data.rows} rowKey={(r) => r.id} columns={[
          { key: 'date', header: 'Date', cell: (r) => date(r.orderDate) },
          { key: 'po', header: 'PO number', cell: (r) => <Link to={`/purchasing/orders/${r.id}`} className="font-medium hover:text-brand-700">{r.poNumber}</Link> },
          { key: 'sup', header: 'Supplier', cell: (r) => r.supplierName },
          { key: 'total', header: `Amount (${currency})`, align: 'right', cell: (r) => <span className="num">{amount(r.total)}</span> },
          { key: 'recv', header: 'Received', align: 'right', cell: (r) => <span className="text-muted num">{amount(r.receivedValue)}</span>, hideBelow: 'md' },
          { key: 'status', header: 'Status', cell: (r) => <PoBadge status={r.status} /> },
        ]} />
      </Card>
    </div>
  );
}

function InventoryReport({ data }: { data: { summary: { batches: number; units: number; stockValue: number; retailValue: number; expiredValue: number }; byCategory: { category: string; units: number; value: number; retailValue: number }[]; rows: { sku: string; productName: string; categoryName: string | null; batchNumber: string; expiryDate: string | null; quantity: number; unitCost: number; stockValue: number; retailValue: number; expired: boolean }[] } }) {
  const { money, amount, date, currency } = useFormat();
  const s = data.summary;
  return (
    <div className="space-y-4">
      <SummaryStrip className="lg:grid-cols-5">
        <Figure label="Batches in stock" value={s.batches.toLocaleString()} />
        <Figure label="Units" value={s.units.toLocaleString()} />
        <Figure label="Value at cost" value={money(s.stockValue)} tone="brand" />
        <Figure label="Retail value" value={money(s.retailValue)} sub={s.stockValue > 0 ? `${(((s.retailValue - s.stockValue) / s.retailValue) * 100).toFixed(1)}% potential margin` : undefined} />
        <Figure label="Expired (write-off)" value={money(s.expiredValue)} tone={s.expiredValue > 0 ? 'danger' : undefined} />
      </SummaryStrip>
      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Value by category"><ShareBars rows={data.byCategory.map((c) => ({ label: c.category, value: c.value }))} format={money} /></Card>
        <Card title="Stock by batch" className="xl:col-span-2" flush>
          <PagedTable rows={data.rows} rowKey={(r) => `${r.sku}-${r.batchNumber}`} columns={[
            { key: 'p', header: 'Product', cell: (r) => <div><p>{r.productName}</p><p className="text-[11.5px] text-muted">{r.sku}</p></div> },
            { key: 'b', header: 'Batch', cell: (r) => r.batchNumber, hideBelow: 'md' },
            { key: 'e', header: 'Expiry', cell: (r) => <span className={r.expired ? 'text-danger' : ''}>{r.expiryDate ? date(r.expiryDate) : '—'}</span> },
            { key: 'q', header: 'Qty', align: 'right', cell: (r) => <span className="num">{r.quantity}</span> },
            { key: 'c', header: 'Unit cost', align: 'right', cell: (r) => <span className="num">{amount(r.unitCost)}</span>, hideBelow: 'lg' },
            { key: 'v', header: `Value (${currency})`, align: 'right', cell: (r) => <span className="font-medium num">{amount(r.stockValue)}</span> },
          ]} />
        </Card>
      </div>
    </div>
  );
}

interface PL {
  grossSales: number; discounts: number; returns: number; returnCount: number; netRevenue: number; cogs: number; grossProfit: number; grossMargin: number; stockLosses: number;
  stockLossBreakdown: { damaged: number; expired: number; missing: number; found: number; countCorrections: number }; operatingExpenses: number;
  claimWriteOffs: number; claimWriteOffCount: number;
  expensesByCategory: { category: string; amount: number }[]; netProfit: number; netMargin: number; taxCollected: number; transactions: number;
  monthly: { month: string; netRevenue: number; cogs: number; stockLosses: number; expenses: number; grossProfit: number; netProfit: number }[];
}
function ProfitLossReport({ data }: { data: PL }) {
  const { money, currency } = useFormat();
  const row = (label: ReactNode, value: number, opts: { strong?: boolean; indent?: boolean; negative?: boolean; muted?: boolean; top?: boolean } = {}) => (
    <div className={cn('flex justify-between gap-4 py-1.5 text-[13px]', opts.strong && 'font-semibold', opts.indent && 'pl-5 text-muted', opts.top && 'mt-1 border-t border-line pt-2.5', opts.muted && 'text-muted')}>
      <span>{label}</span>
      <span className={cn('num', opts.strong && value < 0 && 'text-danger')}>{opts.negative ? `(${money(Math.abs(value)).replace('−', '')})` : money(value)}</span>
    </div>
  );
  const months = data.monthly.map((m) => ({ label: new Date(`${String(m.month).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' }), value: m.netProfit }));
  const b = data.stockLossBreakdown;
  return (
    <div className="space-y-4">
      <SummaryStrip>
        <Figure label="Net revenue" value={money(data.netRevenue)} sub={`${data.transactions.toLocaleString()} invoices`} />
        <Figure label="Gross profit" value={money(data.grossProfit)} sub={`${(data.grossMargin * 100).toFixed(1)}% margin`} tone="brand" />
        <Figure label="Operating expenses" value={money(data.operatingExpenses)} />
        <Figure label="Net profit" value={money(data.netProfit)} sub={`${(data.netMargin * 100).toFixed(1)}% of revenue`} tone={data.netProfit < 0 ? 'danger' : 'brand'} />
      </SummaryStrip>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,560px)_1fr]">
        <Card title="Statement" description={`Amounts in ${currency}, excluding VAT`}>
          {row('Gross sales', data.grossSales)}
          {row(`Less customer returns (${data.returnCount})`, data.returns, { indent: true, negative: true })}
          {row('Net revenue', data.netRevenue, { strong: true, top: true })}
          {row('Cost of goods sold (batch cost)', data.cogs, { indent: true, negative: true })}
          {row('Gross profit', data.grossProfit, { strong: true, top: true })}
          {row('Stock losses', data.stockLosses, { indent: true, negative: data.stockLosses >= 0 })}
          {(b.damaged || b.expired || b.missing || b.found || b.countCorrections) ? (
            <p className="pb-1 pl-9 text-[11.5px] text-muted">
              {[b.expired && `expired ${money(b.expired)}`, b.damaged && `damaged ${money(b.damaged)}`, b.missing && `missing ${money(b.missing)}`, b.found && `found ${money(b.found)}`, b.countCorrections && `count corrections ${money(b.countCorrections)}`].filter(Boolean).join(' · ')}
            </p>
          ) : null}
          {data.claimWriteOffs > 0 && row(`Insurance claims written off (${data.claimWriteOffCount})`, data.claimWriteOffs, { indent: true, negative: true })}
          {data.expensesByCategory.map((e) => <Fragment key={e.category}>{row(e.category, Number(e.amount), { indent: true, negative: true })}</Fragment>)}
          {row('Total operating expenses', data.operatingExpenses, { muted: true, negative: true })}
          {row('Net profit', data.netProfit, { strong: true, top: true })}
          <p className="mt-3 border-t border-line pt-2.5 text-[12px] text-muted">VAT collected ({money(data.taxCollected)}) is owed to TRA and is not revenue. Discounts given: {money(data.discounts)} (already deducted from sales).{data.claimWriteOffs > 0 && ' Claim write-offs are shown at the amount the insurer did not pay.'}</p>
        </Card>
        <Card title="Net profit by month">
          {months.length ? <SignedColumns data={months} currency={currency} valueLabel="Net profit" /> : <EmptyState compact title="No data" />}
          <p className="mt-2 text-[11.5px] text-muted">Losses are shown below the line in red.</p>
        </Card>
      </div>
    </div>
  );
}

function ExpensesReport({ data }: { data: { summary: { count: number; total: number }; byCategory: { category: string; amount: number; share: number }[]; rows: { expenseNo: string; expenseDate: string; category: string; description: string; amount: number; paymentMethod: string; paidTo: string | null; employeeName: string | null }[] } }) {
  const { money, amount, date, currency } = useFormat();
  return (
    <div className="space-y-4">
      <SummaryStrip>
        <Figure label="Expenses" value={data.summary.count.toLocaleString()} />
        <Figure label="Total" value={money(data.summary.total)} tone="brand" />
        <Figure label="Largest category" value={data.byCategory[0]?.category ?? '—'} sub={data.byCategory[0] ? `${(data.byCategory[0].share * 100).toFixed(0)}% of total` : undefined} />
        <Figure label="Categories" value={data.byCategory.length} />
      </SummaryStrip>
      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="By category"><ShareBars rows={data.byCategory.map((c) => ({ label: c.category, value: c.amount }))} format={money} /></Card>
        <Card title="All expenses" className="xl:col-span-2" flush>
          <PagedTable rows={data.rows} rowKey={(r) => r.expenseNo} columns={[
            { key: 'd', header: 'Date', cell: (r) => date(r.expenseDate) },
            { key: 'c', header: 'Category', cell: (r) => r.category },
            { key: 'desc', header: 'Description', cell: (r) => <span className="line-clamp-1">{r.description}</span> },
            { key: 'm', header: 'Method', cell: (r) => EXPENSE_PAYMENT_METHODS[r.paymentMethod as keyof typeof EXPENSE_PAYMENT_METHODS], hideBelow: 'lg' },
            { key: 'a', header: `Amount (${currency})`, align: 'right', cell: (r) => <span className="font-medium num">{amount(r.amount)}</span> },
          ]} />
        </Card>
      </div>
    </div>
  );
}

function ExpiryReport({ data }: { data: { today: string; summary: { batches: number; expiredValue: number; atRiskValue: number; totalValue: number }; rows: { sku: string; productName: string; categoryName: string | null; batchId: number; batchNumber: string; expiryDate: string; quantity: number; unitCost: number; valueAtRisk: number; daysToExpiry: number; supplierName: string | null }[] } }) {
  const { money, amount, date, currency } = useFormat();
  return (
    <div className="space-y-4">
      <SummaryStrip>
        <Figure label="Batches" value={data.summary.batches} />
        <Figure label="Expired value" value={money(data.summary.expiredValue)} tone={data.summary.expiredValue > 0 ? 'danger' : undefined} />
        <Figure label="Value at risk" value={money(data.summary.atRiskValue)} tone={data.summary.atRiskValue > 0 ? 'warning' : undefined} />
        <Figure label="Total" value={money(data.summary.totalValue)} />
      </SummaryStrip>
      <Card flush>
        <PagedTable rows={data.rows} rowKey={(r) => r.batchId} empty={<EmptyState compact title="No expiry risk in this window" />} columns={[
          { key: 'p', header: 'Product', cell: (r) => <div><p>{r.productName}</p><p className="text-[11.5px] text-muted">{r.sku}</p></div> },
          { key: 'b', header: 'Batch', cell: (r) => r.batchNumber },
          { key: 'e', header: 'Expiry date', cell: (r) => <span className="num">{date(r.expiryDate)}</span> },
          { key: 'd', header: 'Days', align: 'right', cell: (r) => <span className={cn('num', r.daysToExpiry < 0 ? 'font-medium text-danger' : r.daysToExpiry <= 30 ? 'text-warning' : 'text-caution')}>{r.daysToExpiry < 0 ? `${-r.daysToExpiry} ago` : r.daysToExpiry}</span> },
          { key: 'q', header: 'Qty', align: 'right', cell: (r) => <span className="num">{r.quantity}</span> },
          { key: 'v', header: `Value at risk (${currency})`, align: 'right', cell: (r) => <span className="font-medium num">{amount(r.valueAtRisk)}</span> },
          { key: 's', header: 'Supplier', cell: (r) => r.supplierName ?? '—', hideBelow: 'lg' },
        ]} />
      </Card>
    </div>
  );
}

function TaxReport({ data }: { data: { taxInclusive: boolean; summary: { taxableAmount: number; tax: number }; rows: { taxRate: number; invoices: number; taxableAmount: number; tax: number; returnedTax: number }[] } }) {
  const { money, amount, currency } = useFormat();
  return (
    <div className="space-y-4">
      <SummaryStrip>
        <Figure label="Taxable sales (net)" value={money(data.summary.taxableAmount)} />
        <Figure label="VAT collected (net of refunds)" value={money(data.summary.tax)} tone="brand" />
        <Figure label="Pricing" value={data.taxInclusive ? 'VAT inclusive' : 'VAT exclusive'} />
        <Figure label="Rates in use" value={data.rows.length} />
      </SummaryStrip>
      <Card flush>
        <DataTable rows={data.rows} rowKey={(r) => r.taxRate} empty={<EmptyState compact title="No sales in this period" />} columns={[
          { key: 'r', header: 'VAT rate', cell: (r) => (r.taxRate > 0 ? `${r.taxRate}%` : 'Exempt / zero-rated') },
          { key: 'i', header: 'Invoices', align: 'right', cell: (r) => <span className="num">{r.invoices}</span> },
          { key: 't', header: `Net sales (${currency})`, align: 'right', cell: (r) => <span className="num">{amount(r.taxableAmount)}</span> },
          { key: 'ref', header: 'VAT refunded', align: 'right', cell: (r) => <span className="text-muted num">{amount(r.returnedTax)}</span> },
          { key: 'x', header: `VAT (${currency})`, align: 'right', cell: (r) => <span className="font-medium num">{amount(r.tax)}</span> },
        ]} />
      </Card>
    </div>
  );
}

function StaffReport({ data }: { data: { rows: { id: number; fullName: string; jobTitle: string | null; transactions: number; revenue: number; discounts: number; returns: number; returnsValue: number; prescriptionsDispensed: number; averageSale: number; discountRate: number }[] } }) {
  const { amount, currency } = useFormat();
  return (
    <Card flush>
      <DataTable rows={data.rows} rowKey={(r) => r.id} empty={<EmptyState compact title="No staff activity in this period" />} columns={[
        { key: 'n', header: 'Staff', cell: (r) => <Link to={`/users/${r.id}`} className="hover:text-brand-700"><p className="font-medium">{r.fullName}</p><p className="text-[11.5px] text-muted">{r.jobTitle}</p></Link> },
        { key: 't', header: 'Sales', align: 'right', cell: (r) => <span className="num">{r.transactions.toLocaleString()}</span> },
        { key: 'r', header: `Revenue (${currency})`, align: 'right', cell: (r) => <span className="font-medium num">{amount(r.revenue)}</span> },
        { key: 'a', header: 'Avg sale', align: 'right', cell: (r) => <span className="num">{amount(r.averageSale)}</span>, hideBelow: 'md' },
        { key: 'd', header: 'Discounts', align: 'right', cell: (r) => <span className="num">{amount(r.discounts)} <span className="text-[11.5px] text-muted">{(r.discountRate * 100).toFixed(1)}%</span></span>, hideBelow: 'md' },
        { key: 'ret', header: 'Returns', align: 'right', cell: (r) => <span className="num">{r.returns} <span className="text-[11.5px] text-muted">{amount(r.returnsValue)}</span></span>, hideBelow: 'lg' },
        { key: 'rx', header: 'Prescriptions', align: 'right', cell: (r) => <span className="num">{r.prescriptionsDispensed}</span>, hideBelow: 'lg' },
      ]} />
    </Card>
  );
}
