import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, Truck } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useListState } from '@/lib/hooks';
import { useFormat } from '@/lib/settings';
import { Page } from '@/components/layout/AppLayout';
import { Button, Card, DataTable, EmptyState, PageHeader, Pagination, SearchInput, Select, Toolbar } from '@/components/ui';
import { ActiveBadge } from '@/components/StatusBadges';
import { SupplierFormModal } from './SupplierForm';

interface SupplierRow { id: number; code: string; name: string; contactPerson: string | null; phone: string; email: string | null; paymentTermsDays: number; creditLimit: number; status: string; outstanding: number; lastDelivery: string | null }

export function SuppliersPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const { amount, date, currency } = useFormat();
  const [creating, setCreating] = useState(false);
  const [s, set] = useListState({ search: '', status: '', sort: 'name', order: 'asc' });
  const query = { search: s.search, status: s.status, sort: s.sort, order: s.order, page: s.page, pageSize: s.pageSize };
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['suppliers', query],
    queryFn: () => api.get<{ data: SupplierRow[]; total: number; page: number; pageSize: number }>('/suppliers', query),
    placeholderData: (p) => p,
  });
  return (
    <Page>
      <PageHeader title="Suppliers" description="Distributors and wholesalers, their terms and what you owe them."
        actions={can('suppliers.manage') && <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setCreating(true)}>Add supplier</Button>} />
      <Card flush>
        <Toolbar>
          <SearchInput value={s.search} onChange={(v) => set({ search: v })} placeholder="Name, code, contact or phone" className="w-full sm:w-64" />
          <Select value={s.status} onChange={(e) => set({ status: e.target.value })} className="w-32" aria-label="Status"><option value="">Any status</option><option value="active">Active</option><option value="inactive">Inactive</option></Select>
        </Toolbar>
        <DataTable
          rows={data?.data} loading={isLoading} error={error} onRetry={refetch} rowKey={(r) => r.id}
          sort={s.sort} order={s.order as 'asc' | 'desc'} onSort={(sort, order) => set({ sort, order })}
          onRowClick={(r) => navigate(`/purchasing/suppliers/${r.id}`)}
          empty={<EmptyState icon={Truck} title="No suppliers found" />}
          columns={[
            { key: 'name', header: 'Supplier', sortKey: 'name', cell: (r) => <div><p className="font-medium">{r.name}</p><p className="text-[12px] text-muted">{r.code}</p></div> },
            { key: 'contact', header: 'Contact', cell: (r) => <div><p>{r.contactPerson ?? '—'}</p><p className="text-[12px] text-muted">{r.phone}</p></div>, hideBelow: 'md' },
            { key: 'terms', header: 'Terms', cell: (r) => `${r.paymentTermsDays} days`, hideBelow: 'lg' },
            { key: 'last', header: 'Last delivery', sortKey: 'lastDelivery', cell: (r) => (r.lastDelivery ? date(r.lastDelivery) : '—'), hideBelow: 'lg' },
            { key: 'owed', header: `Outstanding (${currency})`, align: 'right', sortKey: 'outstanding', cell: (r) => <span className={r.outstanding > 0 ? 'font-medium num' : 'text-muted num'}>{amount(r.outstanding)}</span> },
            { key: 'status', header: 'Status', cell: (r) => <ActiveBadge status={r.status} /> },
          ]}
        />
        {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={(page) => set({ page }, false)} />}
      </Card>
      <SupplierFormModal open={creating} onClose={() => setCreating(false)} onSaved={(id) => navigate(`/purchasing/suppliers/${id}`)} />
    </Page>
  );
}
