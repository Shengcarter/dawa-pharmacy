import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Boxes, CalendarClock, Layers } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDebounced, useListState } from '@/lib/hooks';
import { useFormat } from '@/lib/settings';
import { cn } from '@/lib/cn';
import type { BatchRow, Paginated } from '@/lib/types';
import { Page } from '@/components/layout/AppLayout';
import { Badge, Button, Card, DataTable, EmptyState, PageHeader, Pagination, SearchInput, Select, Toolbar, type Column } from '@/components/ui';
import { ExpiryBadge, StockBadge } from '@/components/StatusBadges';
import { ExportButton } from '@/components/Filters';
import { useCategories } from './ProductsPage';
import { useSupplierOptions } from './ProductFormPage';
import { AdjustStockModal, EditBatchModal, type BatchLite } from './StockModals';

type BatchList = Paginated<BatchRow> & { totals: { value: number; units: number } };

function useBatchList(params: Record<string, string | undefined>) {
  return useQuery({
    queryKey: ['batches', params],
    queryFn: () => api.get<BatchList>('/inventory/batches', params),
    placeholderData: (p) => p,
  });
}

function BatchTable({ title, description, icon, defaults, extraFilters, columnsFor, header }: {
  title: string;
  description: string;
  icon: typeof Boxes;
  defaults: Record<string, string>;
  extraFilters?: (s: Record<string, string>, set: (p: Record<string, string>) => void) => ReactNode;
  columnsFor: (helpers: { onAdjust: (b: BatchRow) => void; onEdit: (b: BatchRow) => void }) => Column<BatchRow>[];
  header?: (s: Record<string, string>, set: (p: Record<string, string>) => void) => ReactNode;
}) {
  const navigate = useNavigate();
  const { money } = useFormat();
  const [s, set] = useListState({ search: '', categoryId: '', supplierId: '', ...defaults });
  const [term, setTerm] = useState(s.search);
  const debounced = useDebounced(term, 250);
  useEffect(() => set({ search: debounced }), [debounced]); // eslint-disable-line react-hooks/exhaustive-deps
  const categories = useCategories();
  const suppliers = useSupplierOptions();
  const [adjust, setAdjust] = useState<BatchRow | null>(null);
  const [edit, setEdit] = useState<BatchLite | null>(null);
  const params = Object.fromEntries(Object.entries(s).filter(([, v]) => v && v !== 'all')) as Record<string, string>;
  const { data, isLoading, error, refetch } = useBatchList(params);

  return (
    <Page wide>
      <PageHeader title={title} description={description} actions={<ExportButton path="/inventory/batches" query={params} />} />
      {header?.(s, set)}
      <Card flush>
        <Toolbar>
          <SearchInput value={term} onChange={setTerm} placeholder="Product, SKU or batch number" className="w-full sm:w-64" />
          <Select value={s.categoryId} onChange={(e) => set({ categoryId: e.target.value })} className="w-44" aria-label="Category">
            <option value="">All categories</option>
            {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Select value={s.supplierId} onChange={(e) => set({ supplierId: e.target.value })} className="w-48" aria-label="Supplier">
            <option value="">All suppliers</option>
            {suppliers.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          {extraFilters?.(s, set)}
          {data && (
            <span className="ml-auto text-[12.5px] text-muted">
              {data.total.toLocaleString()} batches · <b className="text-fg num">{data.totals.units.toLocaleString()}</b> units · <b className="text-fg num">{money(data.totals.value)}</b> at cost
            </span>
          )}
        </Toolbar>
        <DataTable
          rows={data?.data}
          loading={isLoading}
          error={error}
          onRetry={refetch}
          rowKey={(r) => r.id}
          sort={s.sort}
          order={s.order as 'asc' | 'desc'}
          onSort={(sort, order) => set({ sort, order })}
          onRowClick={(r) => navigate(`/inventory/products/${r.productId}`)}
          rowClassName={(r) => (r.daysToExpiry !== null && r.daysToExpiry < 0 ? 'bg-danger-bg/40' : undefined)}
          empty={<EmptyState icon={icon} title="Nothing matches these filters" />}
          columns={columnsFor({ onAdjust: setAdjust, onEdit: setEdit })}
        />
        {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={(page) => set({ page: String(page) })} onPageSizeChange={(pageSize) => set({ pageSize: String(pageSize) })} />}
      </Card>
      <AdjustStockModal open={adjust !== null} onClose={() => setAdjust(null)} productName={adjust?.productName} batches={adjust ? [adjust] : []} initialBatchId={adjust?.id} />
      <EditBatchModal open={edit !== null} onClose={() => setEdit(null)} batch={edit} />
    </Page>
  );
}

function useCommonColumns() {
  const { amount, date, today, currency } = useFormat();
  const t = today();
  return {
    product: { key: 'product', header: 'Product', sortKey: 'product', cell: (r: BatchRow) => <div className="max-w-[280px]"><p className="truncate font-medium">{r.productName}</p><p className="truncate text-[12px] text-muted">{r.categoryName ?? '—'}</p></div> } as Column<BatchRow>,
    sku: { key: 'sku', header: 'SKU', sortKey: 'sku', cell: (r: BatchRow) => <span className="font-mono text-[12px] text-muted">{r.sku}</span>, hideBelow: 'xl' } as Column<BatchRow>,
    batch: { key: 'batch', header: 'Batch', sortKey: 'batch', cell: (r: BatchRow) => r.batchNumber } as Column<BatchRow>,
    expiry: { key: 'expiry', header: 'Expiry', sortKey: 'expiry', cell: (r: BatchRow) => <ExpiryBadge date={r.expiryDate} today={t} format={date} /> } as Column<BatchRow>,
    qty: { key: 'qty', header: 'Stock', align: 'right', sortKey: 'quantity', cell: (r: BatchRow) => <span className="font-medium num">{r.quantityOnHand.toLocaleString()}<span className="font-normal text-muted"> {r.unit}</span></span> } as Column<BatchRow>,
    reorder: { key: 'reorder', header: 'Reorder', align: 'right', cell: (r: BatchRow) => <span className="text-muted num">{r.reorderLevel}</span>, hideBelow: 'lg' } as Column<BatchRow>,
    cost: { key: 'cost', header: `Cost (${currency})`, align: 'right', cell: (r: BatchRow) => <span className="num">{amount(r.unitCost ?? 0)}</span>, hideBelow: 'lg' } as Column<BatchRow>,
    price: { key: 'price', header: `Price (${currency})`, align: 'right', cell: (r: BatchRow) => <span className="num">{amount(r.sellingPrice)}</span>, hideBelow: 'xl' } as Column<BatchRow>,
    value: { key: 'value', header: `Value (${currency})`, align: 'right', sortKey: 'value', cell: (r: BatchRow) => <span className="num">{amount(r.stockValue)}</span>, hideBelow: 'md' } as Column<BatchRow>,
    status: { key: 'status', header: 'Status', cell: (r: BatchRow) => (r.status === 'quarantined' ? <Badge tone="warning">Quarantined</Badge> : <StockBadge status={r.stockStatus} />) } as Column<BatchRow>,
    supplier: { key: 'supplier', header: 'Supplier', cell: (r: BatchRow) => r.supplierName ?? '—', hideBelow: 'xl' } as Column<BatchRow>,
  };
}

function ActionsCell({ row, onAdjust, onEdit }: { row: BatchRow; onAdjust: (b: BatchRow) => void; onEdit?: (b: BatchRow) => void }) {
  const { can } = useAuth();
  if (!can('inventory.adjust') || row.status === 'disposed') return null;
  return (
    <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
      {onEdit && <Button size="sm" variant="ghost" onClick={() => onEdit(row)}>Edit</Button>}
      <Button size="sm" variant="ghost" onClick={() => onAdjust(row)}>Adjust</Button>
    </div>
  );
}

/** Professional inventory table: one row per batch with stock, value and status. */
export function StockLevelsPage() {
  const c = useCommonColumns();
  return (
    <BatchTable
      title="Stock levels"
      description="Every batch on hand, with its expiry, value and the product's stock status."
      icon={Boxes}
      defaults={{ stockStatus: '', sort: 'product', order: 'asc' }}
      extraFilters={(s, set) => (
        <Select value={s.stockStatus} onChange={(e) => set({ stockStatus: e.target.value })} className="w-36" aria-label="Status">
          <option value="">Any status</option>
          <option value="in_stock">In stock</option>
          <option value="low_stock">Low stock</option>
          <option value="critical">Critical</option>
          <option value="expired">Expired</option>
        </Select>
      )}
      columnsFor={({ onAdjust }) => [c.sku, c.product, c.batch, c.expiry, c.qty, c.reorder, c.cost, c.price, c.value, c.status, { key: 'a', header: '', align: 'right', cell: (r) => <ActionsCell row={r} onAdjust={onAdjust} /> }]}
    />
  );
}

const BUCKETS = [
  { value: 'expired', label: 'Expired', tone: 'danger' },
  { value: 'd30', label: 'Within 30 days', tone: 'warning' },
  { value: 'd60', label: '31–60 days', tone: 'caution' },
  { value: 'd90', label: '61–90 days', tone: 'caution' },
  { value: 'safe', label: 'Safe', tone: 'neutral' },
] as const;

export function ExpiryPage() {
  const c = useCommonColumns();
  const { money } = useFormat();
  const summary = useQuery({
    queryKey: ['expiry-summary'],
    queryFn: () => api.get<Record<string, { batches: number; units: number; value: number }> & { today: string }>('/inventory/expiry-summary'),
  });
  return (
    <BatchTable
      title="Expiry tracking"
      description="Expired stock is blocked from sale automatically. Act on near-expiry stock early: sell first, return to supplier or plan disposal."
      icon={CalendarClock}
      defaults={{ expiry: 'all_risk', sort: 'expiry', order: 'asc' }}
      header={(s, set) => (
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {BUCKETS.map((b) => {
            const d = summary.data?.[b.value];
            const active = s.expiry === b.value;
            return (
              <button
                key={b.value}
                onClick={() => set({ expiry: active ? 'all_risk' : b.value })}
                className={cn('rounded-lg border bg-surface px-3.5 py-3 text-left transition-colors', active ? 'border-brand-600 ring-1 ring-brand-600' : 'border-line hover:border-line-strong')}
              >
                <p className="flex items-center gap-2 text-[12.5px] text-muted">
                  <span className={cn('size-2 rounded-full', b.tone === 'danger' ? 'bg-danger' : b.tone === 'warning' ? 'bg-warning' : b.tone === 'caution' ? 'bg-caution' : 'bg-faint')} />
                  {b.label}
                </p>
                <p className="mt-1 text-[17px] font-semibold num">{d ? d.batches : '–'} <span className="text-[12px] font-normal text-muted">batches</span></p>
                <p className="text-[12px] text-muted num">{d ? money(d.value) : ''}</p>
              </button>
            );
          })}
        </div>
      )}
      extraFilters={(s, set) => (
        <Select value={s.expiry} onChange={(e) => set({ expiry: e.target.value })} className="w-56" aria-label="Expiry period">
          <option value="all_risk">Expired + within 90 days</option>
          {BUCKETS.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
          <option value="all">All batches</option>
        </Select>
      )}
      columnsFor={({ onAdjust }) => [
        c.product, c.batch, c.expiry,
        { key: 'days', header: 'Days left', align: 'right', cell: (r) => (r.daysToExpiry === null ? '—' : <span className={cn('num', r.daysToExpiry < 0 ? 'font-medium text-danger' : r.daysToExpiry <= 30 ? 'text-warning' : '')}>{r.daysToExpiry < 0 ? `${-r.daysToExpiry} ago` : r.daysToExpiry}</span>) },
        c.qty, c.value, c.supplier,
        { key: 'a', header: '', align: 'right', cell: (r) => <ActionsCell row={r} onAdjust={onAdjust} /> },
      ]}
    />
  );
}

export function BatchesPage() {
  const c = useCommonColumns();
  return (
    <BatchTable
      title="Batch management"
      description="Correct expiry dates, quarantine a batch (recall or cold-chain breach), or include empty and disposed batches."
      icon={Layers}
      defaults={{ status: '', includeEmpty: '', sort: 'product', order: 'asc' }}
      extraFilters={(s, set) => (
        <>
          <Select value={s.status} onChange={(e) => set({ status: e.target.value })} className="w-36" aria-label="Batch status">
            <option value="">Any batch status</option>
            <option value="active">Active</option>
            <option value="quarantined">Quarantined</option>
            <option value="disposed">Disposed</option>
          </Select>
          <label className="flex items-center gap-2 text-[12.5px] text-muted">
            <input type="checkbox" checked={s.includeEmpty === 'true'} onChange={(e) => set({ includeEmpty: e.target.checked ? 'true' : '' })} className="accent-[var(--brand-600)]" />
            Include empty
          </label>
        </>
      )}
      columnsFor={({ onAdjust, onEdit }) => [
        c.product, c.batch,
        { key: 'mfg', header: 'Manufactured', cell: (r) => <MfgDate value={r.manufactureDate} />, hideBelow: 'xl' },
        c.expiry,
        { key: 'recv', header: 'Received', align: 'right', cell: (r) => <span className="text-muted num">{r.quantityReceived.toLocaleString()}</span>, hideBelow: 'lg' },
        c.qty, c.cost, c.supplier,
        { key: 'bs', header: 'Batch status', cell: (r) => <Badge tone={r.status === 'active' ? 'success' : r.status === 'quarantined' ? 'warning' : 'neutral'}>{r.status[0].toUpperCase() + r.status.slice(1)}</Badge> },
        { key: 'a', header: '', align: 'right', cell: (r) => <ActionsCell row={r} onAdjust={onAdjust} onEdit={onEdit} /> },
      ]}
    />
  );
}

function MfgDate({ value }: { value: string | null }) {
  const { date } = useFormat();
  return <span className="text-muted">{value ? date(value) : '—'}</span>;
}
