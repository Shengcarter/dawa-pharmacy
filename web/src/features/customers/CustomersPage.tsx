import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { UserPlus, Users } from 'lucide-react';
import { CUSTOMER_TYPES } from '@dawa/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useListState } from '@/lib/hooks';
import { useFormat } from '@/lib/settings';
import { Page } from '@/components/layout/AppLayout';
import { Badge, Button, Card, Checkbox, DataTable, EmptyState, PageHeader, Pagination, SearchInput, Select, Toolbar } from '@/components/ui';
import { CustomerFormModal } from './CustomerForm';

interface CustomerRow { id: number; code: string; fullName: string; phone: string | null; email: string | null; customerType: string; status: string; creditLimit: number; storeCreditBalance: number; outstanding: number; lastPurchase: string | null; lifetimeValue: number; visits: number }

export function CustomersPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const { amount, date, currency } = useFormat();
  const [creating, setCreating] = useState(false);
  const [s, set] = useListState({ search: '', type: '', withBalance: '', sort: 'name', order: 'asc' });
  const query = { search: s.search, type: s.type, withBalance: s.withBalance, sort: s.sort, order: s.order, page: s.page, pageSize: s.pageSize };
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['customers', query],
    queryFn: () => api.get<{ data: CustomerRow[]; total: number; page: number; pageSize: number }>('/customers', query),
    placeholderData: (p) => p,
  });
  return (
    <Page>
      <PageHeader title="Customers & patients" description="Contact details, purchase history and account balances."
        actions={can('customers.manage') && <Button variant="primary" icon={<UserPlus className="size-3.5" />} onClick={() => setCreating(true)}>Register customer</Button>} />
      <Card flush>
        <Toolbar>
          <SearchInput value={s.search} onChange={(v) => set({ search: v })} placeholder="Name, phone, code or email" className="w-full sm:w-64" />
          <Select value={s.type} onChange={(e) => set({ type: e.target.value })} className="w-36" aria-label="Type"><option value="">All types</option>{Object.entries(CUSTOMER_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          <Checkbox label="Owing money" checked={s.withBalance === 'true'} onChange={(e) => set({ withBalance: e.target.checked ? 'true' : '' })} />
        </Toolbar>
        <DataTable
          rows={data?.data} loading={isLoading} error={error} onRetry={refetch} rowKey={(r) => r.id}
          sort={s.sort} order={s.order as 'asc' | 'desc'} onSort={(sort, order) => set({ sort, order })}
          onRowClick={(r) => navigate(`/customers/${r.id}`)}
          empty={<EmptyState icon={Users} title="No customers found" />}
          columns={[
            { key: 'name', header: 'Customer', sortKey: 'name', cell: (r) => <div><p className="font-medium">{r.fullName}</p><p className="text-[12px] text-muted">{r.code}</p></div> },
            { key: 'phone', header: 'Phone', cell: (r) => r.phone ?? '—', hideBelow: 'sm' },
            { key: 'type', header: 'Type', cell: (r) => CUSTOMER_TYPES[r.customerType as keyof typeof CUSTOMER_TYPES], hideBelow: 'md' },
            { key: 'visits', header: 'Visits', align: 'right', cell: (r) => <span className="num">{r.visits}</span>, hideBelow: 'lg' },
            { key: 'value', header: `Spent (${currency})`, align: 'right', cell: (r) => <span className="num">{amount(r.lifetimeValue)}</span>, hideBelow: 'lg' },
            { key: 'last', header: 'Last purchase', sortKey: 'lastPurchase', cell: (r) => <span className="text-muted">{r.lastPurchase ? date(r.lastPurchase) : '—'}</span>, hideBelow: 'md' },
            { key: 'owed', header: `Balance (${currency})`, align: 'right', sortKey: 'balance', cell: (r) => (r.outstanding > 0 ? <span className="font-medium text-warning num">{amount(r.outstanding)}</span> : <span className="text-faint num">0</span>) },
            { key: 'status', header: '', cell: (r) => r.status !== 'active' && <Badge>Inactive</Badge>, hideBelow: 'md' },
          ]}
        />
        {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={(page) => set({ page }, false)} />}
      </Card>
      <CustomerFormModal open={creating} onClose={() => setCreating(false)} onSaved={(id) => navigate(`/customers/${id}`)} />
    </Page>
  );
}
