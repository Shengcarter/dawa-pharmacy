import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeftRight } from 'lucide-react';
import { MOVEMENT_TYPES, addDays } from '@dawa/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useListState } from '@/lib/hooks';
import { useFormat } from '@/lib/settings';
import { cn } from '@/lib/cn';
import { Page } from '@/components/layout/AppLayout';
import { Card, DataTable, EmptyState, PageHeader, Pagination, SearchInput, Select, Toolbar } from '@/components/ui';
import { DateRangeFilter, ExportButton } from '@/components/Filters';
import { useStaffOptions } from '../sales/SalesPage';
import { referenceLink } from './ProductDetailPage';

interface MovementRow { id: number; movementType: string; quantity: number; quantityBefore: number; quantityAfter: number; reason: string | null; referenceType: string | null; referenceId: number | null; referenceNo: string | null; createdAt: string; productId: number; productName: string; sku: string; batchNumber: string; userName: string | null }

export function MovementsPage() {
  const { dateTime, today } = useFormat();
  const { can } = useAuth();
  const t = today();
  const staff = useStaffOptions(can('users.view', 'sales.view_all', 'inventory.view'));
  const [s, set] = useListState({ search: '', type: '', userId: '', from: addDays(t, -6), to: t });
  const query = { search: s.search, type: s.type, userId: s.userId, from: s.from, to: s.to, page: s.page, pageSize: s.pageSize };
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['movements', query],
    queryFn: () => api.get<{ data: MovementRow[]; total: number; page: number; pageSize: number }>('/inventory/movements', query),
    placeholderData: (p) => p,
  });
  return (
    <Page wide>
      <PageHeader title="Stock movements" description="The complete, unalterable history of every unit in and out — purchases, sales, returns and adjustments." actions={<ExportButton path="/inventory/movements" query={query} />} />
      <Card flush>
        <Toolbar>
          <SearchInput value={s.search} onChange={(v) => set({ search: v })} placeholder="Product, SKU, batch or reference" className="w-full sm:w-64" />
          <Select value={s.type} onChange={(e) => set({ type: e.target.value })} className="w-44" aria-label="Movement type">
            <option value="">All movements</option>
            {Object.entries(MOVEMENT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Select value={s.userId} onChange={(e) => set({ userId: e.target.value })} className="w-40" aria-label="User">
            <option value="">All staff</option>
            {staff.data?.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
          </Select>
          <DateRangeFilter value={{ from: s.from, to: s.to }} onChange={(r) => set(r)} today={t} />
        </Toolbar>
        <DataTable
          rows={data?.data} loading={isLoading} error={error} onRetry={refetch} rowKey={(r) => r.id}
          empty={<EmptyState icon={ArrowLeftRight} title="No movements in this period" />}
          columns={[
            { key: 'date', header: 'Date', cell: (r) => <span className="text-muted num">{dateTime(r.createdAt)}</span> },
            { key: 'product', header: 'Product', cell: (r) => <Link to={`/inventory/products/${r.productId}`} className="hover:text-brand-700">{r.productName}</Link> },
            { key: 'batch', header: 'Batch', cell: (r) => r.batchNumber, hideBelow: 'md' },
            { key: 'type', header: 'Movement', cell: (r) => MOVEMENT_TYPES[r.movementType as keyof typeof MOVEMENT_TYPES] },
            { key: 'qty', header: 'Qty', align: 'right', cell: (r) => <span className={cn('font-medium num', r.quantity > 0 && 'text-brand-700')}>{r.quantity > 0 ? '+' : ''}{r.quantity}</span> },
            { key: 'before', header: 'Before', align: 'right', cell: (r) => <span className="text-muted num">{r.quantityBefore}</span>, hideBelow: 'lg' },
            { key: 'after', header: 'After', align: 'right', cell: (r) => <span className="num">{r.quantityAfter}</span> },
            { key: 'ref', header: 'Reference', cell: (r) => { const to = referenceLink(r); return to ? <Link to={to} className="text-brand-700 hover:underline">{r.referenceNo}</Link> : r.referenceNo ?? '—'; }, hideBelow: 'md' },
            { key: 'reason', header: 'Reason', cell: (r) => <span className="text-muted">{r.reason ?? ''}</span>, hideBelow: 'xl' },
            { key: 'user', header: 'User', cell: (r) => r.userName ?? 'System', hideBelow: 'lg' },
          ]}
        />
        {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={(page) => set({ page }, false)} onPageSizeChange={(pageSize) => set({ pageSize })} />}
      </Card>
    </Page>
  );
}
