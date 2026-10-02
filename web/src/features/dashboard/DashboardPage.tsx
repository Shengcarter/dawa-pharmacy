import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownRight, ArrowUpRight, PackagePlus, ShoppingCart } from 'lucide-react';
import { SALE_PAYMENT_TYPES } from '@dawa/shared';
import { api } from '@/lib/api';
import { useAuth, useUser } from '@/lib/auth';
import { useFormat } from '@/lib/settings';
import { cn } from '@/lib/cn';
import { Page } from '@/components/layout/AppLayout';
import { ButtonLink, Card, DataTable, EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui';
import { PaymentStatusBadge, StockBadge } from '@/components/StatusBadges';
import { SalesAreaChart, type SeriesPoint } from '@/components/charts/SalesChart';

type Period = 'today' | '7d' | '30d' | '3m' | '12m';
const PERIODS: { value: Period; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '3m', label: '3 months' },
  { value: '12m', label: '12 months' },
];

interface Compare { value: number; previous: number }
interface DashboardData {
  today: string;
  scope: 'own' | 'all';
  kpis: {
    todaySales: Compare;
    todayTransactions: Compare;
    todayGrossProfit?: Compare;
    stockValue?: { value: number; expiredValue: number };
    lowStock?: { value: number; critical: number; outOfStock: number };
    expiringSoon?: { value: number; valueAtRisk: number; expired: number; windowDays: number };
    supplierBalances?: { value: number; overdueSuppliers: number };
    customerBalances?: { value: number; customers: number };
  };
  chart: { period: Period; bucket: 'hour' | 'day' | 'week' | 'month'; points: SeriesPoint[]; total: number; transactions: number; previousTotal: number };
  topProducts: { id: number; name: string; strength: string | null; quantity: number; revenue: number; profit?: number }[];
  lowStock: { id: number; name: string; strength: string | null; reorderLevel: number; sellable: number; stockStatus: string }[];
  expiring: { id: number; productId: number; name: string; batchNumber: string; expiryDate: string; quantityOnHand: number; daysToExpiry: number; value: number }[];
  recentTransactions: { id: number; invoiceNo: string; createdAt: string; total: number; paymentType: string; paymentStatus: string; status: string; customerName: string | null; cashierName: string }[];
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function Delta({ value, previous, label = 'vs this time yesterday' }: { value: number; previous: number; label?: string }) {
  if (previous === 0 && value === 0) return <span className="text-faint">No activity yet</span>;
  if (previous === 0) return <span className="text-muted">{label}: none</span>;
  const pct = ((value - previous) / Math.abs(previous)) * 100;
  const up = pct >= 0;
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cn('inline-flex items-center font-medium num', up ? 'text-brand-700' : 'text-danger')}>
        {up ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
        {Math.abs(pct).toFixed(pct > -10 && pct < 10 ? 1 : 0)}%
      </span>
      <span className="text-muted">{label}</span>
    </span>
  );
}

function Kpi({ label, value, footer, to, tone }: { label: string; value: ReactNode; footer: ReactNode; to?: string; tone?: 'warning' | 'danger' }) {
  const body = (
    <div className={cn('h-full rounded-lg border border-line bg-surface px-4 py-3.5 transition-colors', to && 'hover:border-line-strong')}>
      <div className="flex items-center gap-2">
        {tone && <span className={cn('size-1.5 rounded-full', tone === 'danger' ? 'bg-danger' : 'bg-warning')} />}
        <p className="text-[12.5px] text-muted">{label}</p>
      </div>
      <p className="mt-1.5 text-[21px] font-semibold tracking-[-0.015em] num">{value}</p>
      <div className="mt-1 text-[12px]">{footer}</div>
    </div>
  );
  return to ? <Link to={to} className="block">{body}</Link> : body;
}

export function DashboardPage() {
  const user = useUser();
  const { can } = useAuth();
  const navigate = useNavigate();
  const { money, amount, currency, date, time, dateTime, settings } = useFormat();
  const [period, setPeriod] = useState<Period>('30d');
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['dashboard', period],
    queryFn: () => api.get<DashboardData>('/dashboard', { period }),
    placeholderData: (prev) => prev,
    refetchInterval: 120_000,
  });

  const today = data?.today ?? '';
  const k = data?.kpis;
  const firstName = user.fullName.split(' ')[0];

  return (
    <Page wide>
      <PageHeader
        title={`${greeting()}, ${firstName}`}
        description={
          <>
            {settings?.general.pharmacyName ?? ''}
            {today && <> · {new Date(`${today}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}</>}
            {data?.scope === 'own' && <> · showing your own sales</>}
          </>
        }
        actions={
          <>
            {can('purchasing.receive') && <ButtonLink to="/purchasing/receipts/new" icon={<PackagePlus className="size-3.5" />}>Receive stock</ButtonLink>}
            {can('pos.sell') && <ButtonLink to="/pos" variant="primary" icon={<ShoppingCart className="size-3.5" />}>New sale</ButtonLink>}
          </>
        }
      />

      {error && !data ? (
        <Card><ErrorState error={error} onRetry={() => refetch()} /></Card>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {isLoading || !k ? (
              Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="rounded-lg border border-line bg-surface px-4 py-3.5">
                  <Skeleton className="w-24" /><Skeleton className="mt-3 h-5 w-32" /><Skeleton className="mt-2 w-28" />
                </div>
              ))
            ) : (
              <>
                <Kpi label="Today's sales" value={money(k.todaySales.value)} footer={<Delta {...k.todaySales} />} to={can('sales.view', 'sales.view_all') ? `/sales?from=${today}&to=${today}` : undefined} />
                <Kpi label="Transactions today" value={k.todayTransactions.value.toLocaleString()} footer={<Delta {...k.todayTransactions} />} />
                {k.todayGrossProfit && (
                  <Kpi
                    label="Gross profit today"
                    value={money(k.todayGrossProfit.value)}
                    footer={
                      <span className="text-muted">
                        {k.todaySales.value > 0 ? `${((k.todayGrossProfit.value / k.todaySales.value) * 100).toFixed(1)}% of sales · ` : ''}after batch cost
                      </span>
                    }
                    to="/reports/profit-loss"
                  />
                )}
                {k.stockValue && (
                  <Kpi
                    label="Stock value (at cost)"
                    value={money(k.stockValue.value)}
                    footer={k.stockValue.expiredValue > 0 ? <span className="text-danger">{money(k.stockValue.expiredValue)} expired, excluded</span> : <span className="text-muted">Sellable stock only</span>}
                    to="/reports/inventory"
                  />
                )}
                {k.lowStock && (
                  <Kpi
                    label="Low stock items"
                    value={k.lowStock.value}
                    tone={k.lowStock.critical + k.lowStock.outOfStock > 0 ? 'danger' : k.lowStock.value > 0 ? 'warning' : undefined}
                    footer={<span className="text-muted">{k.lowStock.outOfStock} out of stock · {k.lowStock.critical} critical</span>}
                    to="/inventory/products?stockStatus=low_stock"
                  />
                )}
                {k.expiringSoon && (
                  <Kpi
                    label={`Expiring within ${k.expiringSoon.windowDays} days`}
                    value={`${k.expiringSoon.value} batch${k.expiringSoon.value === 1 ? '' : 'es'}`}
                    tone={k.expiringSoon.expired > 0 ? 'danger' : k.expiringSoon.value > 0 ? 'warning' : undefined}
                    footer={
                      <span className="text-muted">
                        {money(k.expiringSoon.valueAtRisk)} at risk{k.expiringSoon.expired > 0 && <span className="text-danger"> · {k.expiringSoon.expired} expired</span>}
                      </span>
                    }
                    to="/inventory/expiry"
                  />
                )}
                {k.supplierBalances && (
                  <Kpi
                    label="Owed to suppliers"
                    value={money(k.supplierBalances.value)}
                    tone={k.supplierBalances.overdueSuppliers > 0 ? 'warning' : undefined}
                    footer={<span className="text-muted">{k.supplierBalances.overdueSuppliers > 0 ? `${k.supplierBalances.overdueSuppliers} supplier(s) overdue` : 'Nothing overdue'}</span>}
                    to="/purchasing/suppliers?sort=outstanding&order=desc"
                  />
                )}
                {k.customerBalances && (
                  <Kpi
                    label="Owed by customers"
                    value={money(k.customerBalances.value)}
                    footer={<span className="text-muted">{k.customerBalances.customers} customer account(s)</span>}
                    to="/customers?withBalance=true"
                  />
                )}
              </>
            )}
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card
              className="xl:col-span-2"
              title="Sales overview"
              description={data && `${money(data.chart.total)} from ${data.chart.transactions.toLocaleString()} sales`}
              actions={
                <div role="group" aria-label="Period" className="flex rounded-md border border-line p-0.5">
                  {PERIODS.map((p) => (
                    <button
                      key={p.value}
                      onClick={() => setPeriod(p.value)}
                      aria-pressed={period === p.value}
                      className={cn('rounded px-2 py-1 text-[12px] font-medium', period === p.value ? 'bg-brand-50 text-brand-700' : 'text-muted hover:text-fg')}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              }
            >
              {data ? (
                <>
                  <div className={cn('transition-opacity', isFetching && 'opacity-60')}>
                    <SalesAreaChart points={data.chart.points} bucket={data.chart.bucket} currency={currency} />
                  </div>
                  <p className="mt-2 text-[12px]">
                    <Delta value={data.chart.total} previous={data.chart.previousTotal} label="vs previous period" />
                  </p>
                </>
              ) : (
                <Skeleton className="h-[260px] w-full" />
              )}
            </Card>

            <Card title="Top selling products" description={`By revenue, ${PERIODS.find((p) => p.value === period)?.label.toLowerCase()}`} flush>
              {data?.topProducts.length ? (
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-line text-[11.5px] uppercase tracking-[0.04em] text-muted">
                      <th className="px-4 py-2 text-left font-medium">Product</th>
                      <th className="px-2 py-2 text-right font-medium">Qty</th>
                      <th className="px-4 py-2 text-right font-medium">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topProducts.map((p) => (
                      <tr key={p.id} className="border-b border-line last:border-0">
                        <td className="max-w-0 px-4 py-2.5">
                          <Link to={`/inventory/products/${p.id}`} className="block truncate hover:text-brand-700">{p.name}</Link>
                          {p.profit !== undefined && <p className="text-[11.5px] text-muted num">Profit {amount(p.profit)}</p>}
                        </td>
                        <td className="px-2 py-2.5 text-right num">{p.quantity.toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-right font-medium num">{amount(p.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : data ? (
                <EmptyState compact title="No sales in this period" />
              ) : (
                <div className="space-y-3 p-4">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="w-full" />)}</div>
              )}
            </Card>
          </div>

          {(data?.lowStock || data?.expiring) && can('inventory.view') && (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="Needs restocking" description="At or below reorder level" actions={<ButtonLink to="/inventory/products?stockStatus=low_stock" size="sm" variant="ghost">View all</ButtonLink>} flush>
                {data.lowStock.length ? (
                  <ul>
                    {data.lowStock.map((p) => (
                      <li key={p.id} className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-0">
                        <Link to={`/inventory/products/${p.id}`} className="min-w-0 flex-1 truncate text-[13px] hover:text-brand-700">{p.name}</Link>
                        <span className="text-[12px] text-muted num">{p.sellable} / {p.reorderLevel}</span>
                        <StockBadge status={p.stockStatus} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState compact title="Stock levels are healthy" description="Nothing is at or below its reorder level." />
                )}
              </Card>
              <Card title="Expiry alerts" description={`Expired or expiring within ${k?.expiringSoon?.windowDays ?? 90} days`} actions={<ButtonLink to="/inventory/expiry" size="sm" variant="ghost">View all</ButtonLink>} flush>
                {data.expiring.length ? (
                  <ul>
                    {data.expiring.map((b) => (
                      <li key={b.id} className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-0">
                        <div className="min-w-0 flex-1">
                          <Link to={`/inventory/products/${b.productId}`} className="block truncate text-[13px] hover:text-brand-700">{b.name}</Link>
                          <p className="text-[11.5px] text-muted">Batch {b.batchNumber} · {b.quantityOnHand} units · {money(b.value)}</p>
                        </div>
                        <span
                          className={cn(
                            'shrink-0 text-right text-[12px] font-medium num',
                            b.daysToExpiry < 0 ? 'text-danger' : b.daysToExpiry <= 30 ? 'text-warning' : 'text-caution',
                          )}
                        >
                          {b.daysToExpiry < 0 ? `Expired ${date(b.expiryDate)}` : `${b.daysToExpiry} days`}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState compact title="No expiry risk" description="No batches expire within the warning period." />
                )}
              </Card>
            </div>
          )}

          <Card title="Recent transactions" actions={can('sales.view', 'sales.view_all') && <ButtonLink to="/sales" size="sm" variant="ghost">All invoices</ButtonLink>} flush>
            <DataTable
              rows={data?.recentTransactions}
              loading={isLoading}
              skeletonRows={5}
              rowKey={(r) => r.id}
              onRowClick={(r) => navigate(`/sales/${r.id}`)}
              empty={<EmptyState compact title="No sales yet" description="Completed sales appear here." />}
              columns={[
                { key: 'inv', header: 'Invoice', cell: (r) => <span className="font-medium">{r.invoiceNo}</span> },
                { key: 'cust', header: 'Customer', cell: (r) => r.customerName ?? <span className="text-muted">Walk-in</span>, hideBelow: 'sm' },
                { key: 'staff', header: 'Staff', cell: (r) => r.cashierName, hideBelow: 'md' },
                { key: 'amt', header: `Amount (${currency})`, align: 'right', cell: (r) => <span className="font-medium num">{amount(r.total)}</span> },
                { key: 'pay', header: 'Payment', cell: (r) => SALE_PAYMENT_TYPES[r.paymentType as keyof typeof SALE_PAYMENT_TYPES] ?? r.paymentType, hideBelow: 'md' },
                { key: 'date', header: 'Time', cell: (r) => <span className="text-muted num" title={dateTime(r.createdAt)}>{r.createdAt.slice(0, 10) === new Date().toISOString().slice(0, 10) ? time(r.createdAt) : dateTime(r.createdAt)}</span>, hideBelow: 'lg' },
                { key: 'status', header: 'Status', cell: (r) => <PaymentStatusBadge status={r.paymentStatus} /> },
              ]}
            />
          </Card>
        </div>
      )}
    </Page>
  );
}
