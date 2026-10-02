import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FileText, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useListState } from '@/lib/hooks';
import { useFormat } from '@/lib/settings';
import { Page } from '@/components/layout/AppLayout';
import { ButtonLink, Card, DataTable, EmptyState, PageHeader, Pagination, SearchInput, Select, Tabs, Toolbar } from '@/components/ui';
import { PoBadge } from '@/components/StatusBadges';
import { useSupplierOptions } from '../inventory/ProductFormPage';

interface PoRow { id: number; poNumber: string; status: string; orderDate: string; expectedDate: string | null; total: number; supplierId: number; supplierName: string; createdByName: string; itemCount: number; receivedRatio: number }

export function PurchaseOrdersPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const { amount, date, currency, today } = useFormat();
  const suppliers = useSupplierOptions();
  const [s, set] = useListState({ search: '', status: '', supplierId: '' });
  const query = { search: s.search, status: s.status, supplierId: s.supplierId, page: s.page, pageSize: s.pageSize };
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['purchase-orders', query],
    queryFn: () => api.get<{ data: PoRow[]; total: number; page: number; pageSize: number }>('/purchasing/orders', query),
    placeholderData: (p) => p,
  });
  const t = today();
  return (
    <Page>
      <PageHeader title="Purchase orders" description="Order from suppliers, get approval, then receive stock against the order."
        actions={can('purchasing.manage') && <ButtonLink to="/purchasing/orders/new" variant="primary" icon={<Plus className="size-3.5" />}>New purchase order</ButtonLink>} />
      <Tabs className="mb-3" value={s.status} onChange={(v) => set({ status: v })} tabs={[
        { value: '', label: 'All' },
        { value: 'draft', label: 'Draft' },
        { value: 'pending', label: 'Pending approval' },
        { value: 'ordered', label: 'Ordered' },
        { value: 'partially_received', label: 'Partially received' },
        { value: 'received', label: 'Received' },
        { value: 'cancelled', label: 'Cancelled' },
      ]} />
      <Card flush>
        <Toolbar>
          <SearchInput value={s.search} onChange={(v) => set({ search: v })} placeholder="PO number or supplier" className="w-full sm:w-64" />
          <Select value={s.supplierId} onChange={(e) => set({ supplierId: e.target.value })} className="w-52" aria-label="Supplier">
            <option value="">All suppliers</option>
            {suppliers.data?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select>
        </Toolbar>
        <DataTable
          rows={data?.data} loading={isLoading} error={error} onRetry={refetch} rowKey={(r) => r.id}
          onRowClick={(r) => navigate(`/purchasing/orders/${r.id}`)}
          empty={<EmptyState icon={FileText} title="No purchase orders" description={can('purchasing.manage') ? 'Create one from the reorder suggestions to restock low items.' : undefined} />}
          columns={[
            { key: 'no', header: 'PO number', cell: (r) => <span className="font-medium">{r.poNumber}</span> },
            { key: 'sup', header: 'Supplier', cell: (r) => r.supplierName },
            { key: 'date', header: 'Order date', cell: (r) => date(r.orderDate), hideBelow: 'md' },
            {
              key: 'exp', header: 'Expected', hideBelow: 'lg',
              cell: (r) => r.expectedDate ? <span className={['ordered', 'partially_received'].includes(r.status) && r.expectedDate < t ? 'font-medium text-warning' : ''}>{date(r.expectedDate)}</span> : '—',
            },
            { key: 'items', header: 'Lines', align: 'right', cell: (r) => <span className="num">{r.itemCount}</span>, hideBelow: 'lg' },
            { key: 'recv', header: 'Received', align: 'right', cell: (r) => <span className="text-muted num">{Math.round(r.receivedRatio * 100)}%</span>, hideBelow: 'md' },
            { key: 'total', header: `Total (${currency})`, align: 'right', cell: (r) => <span className="font-medium num">{amount(r.total)}</span> },
            { key: 'status', header: 'Status', cell: (r) => <PoBadge status={r.status} /> },
            { key: 'by', header: 'Created by', cell: (r) => r.createdByName, hideBelow: 'xl' },
          ]}
        />
        {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={(page) => set({ page }, false)} />}
      </Card>
    </Page>
  );
}
