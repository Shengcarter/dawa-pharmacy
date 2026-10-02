import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, SlidersHorizontal } from 'lucide-react';
import { ADJUSTMENT_TYPES, addDays } from '@dawa/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useListState } from '@/lib/hooks';
import { useFormat } from '@/lib/settings';
import { cn } from '@/lib/cn';
import { Page } from '@/components/layout/AppLayout';
import { Badge, Button, Card, DataTable, EmptyState, PageHeader, Pagination, SearchInput, Select, Toolbar, type Tone } from '@/components/ui';
import { DateRangeFilter } from '@/components/Filters';
import { AdjustStockModal } from './StockModals';

interface AdjustmentRow { id: number; adjustmentNo: string; adjustmentType: string; quantityBefore: number; quantityAfter: number; change: number; valueChange: number; reason: string; createdAt: string; productId: number; productName: string; sku: string; batchNumber: string; userName: string }
const typeTone: Record<string, Tone> = { adjustment_in: 'success', adjustment_out: 'warning', damaged: 'danger', expired: 'danger', correction: 'info' };

export function AdjustmentsPage() {
  const { can } = useAuth();
  const { amount, dateTime, currency, today } = useFormat();
  const t = today();
  const [s, set] = useListState({ search: '', type: '', from: addDays(t, -89), to: t });
  const [open, setOpen] = useState(false);
  const query = { search: s.search, type: s.type, from: s.from, to: s.to, page: s.page, pageSize: s.pageSize };
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['adjustments', query],
    queryFn: () => api.get<{ data: AdjustmentRow[]; total: number; page: number; pageSize: number }>('/inventory/adjustments', query),
    placeholderData: (p) => p,
  });
  return (
    <Page wide>
      <PageHeader title="Stock adjustments" description="Damaged, missing, found and expired stock, and count corrections — each with a reason and the person who recorded it."
        actions={can('inventory.adjust') && <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setOpen(true)}>New adjustment</Button>} />
      <Card flush>
        <Toolbar>
          <SearchInput value={s.search} onChange={(v) => set({ search: v })} placeholder="Product, batch, number or reason" className="w-full sm:w-64" />
          <Select value={s.type} onChange={(e) => set({ type: e.target.value })} className="w-48" aria-label="Type">
            <option value="">All types</option>
            {Object.entries(ADJUSTMENT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <DateRangeFilter value={{ from: s.from, to: s.to }} onChange={(r) => set(r)} today={t} />
        </Toolbar>
        <DataTable
          rows={data?.data} loading={isLoading} error={error} onRetry={refetch} rowKey={(r) => r.id}
          empty={<EmptyState icon={SlidersHorizontal} title="No adjustments in this period" />}
          columns={[
            { key: 'no', header: 'Number', cell: (r) => <span className="font-medium">{r.adjustmentNo}</span>, hideBelow: 'md' },
            { key: 'date', header: 'Date', cell: (r) => <span className="text-muted num">{dateTime(r.createdAt)}</span> },
            { key: 'product', header: 'Product', cell: (r) => <Link to={`/inventory/products/${r.productId}`} className="hover:text-brand-700">{r.productName}<span className="block text-[11.5px] text-muted">Batch {r.batchNumber}</span></Link> },
            { key: 'type', header: 'Type', cell: (r) => <Badge tone={typeTone[r.adjustmentType]}>{ADJUSTMENT_TYPES[r.adjustmentType as keyof typeof ADJUSTMENT_TYPES]}</Badge> },
            { key: 'qty', header: 'Quantity', align: 'right', cell: (r) => <span className="num"><span className="text-muted">{r.quantityBefore} → </span><span className={cn('font-medium', r.change > 0 && 'text-brand-700')}>{r.quantityAfter}</span></span> },
            { key: 'value', header: `Value (${currency})`, align: 'right', cell: (r) => <span className={cn('num', r.valueChange < 0 ? 'text-danger' : 'text-brand-700')}>{r.valueChange > 0 ? '+' : ''}{amount(r.valueChange)}</span>, hideBelow: 'md' },
            { key: 'reason', header: 'Reason', cell: (r) => <span className="line-clamp-2 max-w-xs text-muted">{r.reason}</span>, hideBelow: 'lg' },
            { key: 'user', header: 'By', cell: (r) => r.userName, hideBelow: 'lg' },
          ]}
        />
        {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={(page) => set({ page }, false)} />}
      </Card>
      <AdjustStockModal open={open} onClose={() => setOpen(false)} />
    </Page>
  );
}
