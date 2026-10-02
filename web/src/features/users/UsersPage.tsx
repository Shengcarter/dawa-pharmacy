import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { UserPlus, UserCog } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useListState } from '@/lib/hooks';
import { useFormat } from '@/lib/settings';
import { Page } from '@/components/layout/AppLayout';
import { Badge, Button, Card, DataTable, EmptyState, PageHeader, Pagination, SearchInput, Select, Toolbar } from '@/components/ui';
import { initials } from '@/components/layout/Topbar';
import { UserFormModal } from './UserForm';

interface UserRow { id: number; fullName: string; email: string; phone: string | null; jobTitle: string | null; status: string; lastLoginAt: string | null; locked: boolean; roles: { id: number; code: string; name: string }[] }

export function UsersPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const { dateTime } = useFormat();
  const [creating, setCreating] = useState(false);
  const [s, set] = useListState({ search: '', status: '' });
  const query = { search: s.search, status: s.status, page: s.page, pageSize: s.pageSize };
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['users', query],
    queryFn: () => api.get<{ data: UserRow[]; total: number; page: number; pageSize: number }>('/users', query),
    placeholderData: (p) => p,
  });
  return (
    <Page>
      <PageHeader title="Employees & users" description="Staff accounts, their roles and sign-in activity. Roles control what each person can see and do."
        actions={can('users.manage') && <Button variant="primary" icon={<UserPlus className="size-3.5" />} onClick={() => setCreating(true)}>Add user</Button>} />
      <Card flush>
        <Toolbar>
          <SearchInput value={s.search} onChange={(v) => set({ search: v })} placeholder="Name, email or phone" className="w-full sm:w-64" />
          <Select value={s.status} onChange={(e) => set({ status: e.target.value })} className="w-36" aria-label="Status"><option value="">Any status</option><option value="active">Active</option><option value="suspended">Suspended</option></Select>
        </Toolbar>
        <DataTable
          rows={data?.data} loading={isLoading} error={error} onRetry={refetch} rowKey={(r) => r.id}
          onRowClick={(r) => navigate(`/users/${r.id}`)}
          empty={<EmptyState icon={UserCog} title="No users found" />}
          columns={[
            {
              key: 'name', header: 'Name',
              cell: (r) => (
                <div className="flex items-center gap-2.5">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-subtle text-[11px] font-semibold text-muted ring-1 ring-line">{initials(r.fullName)}</span>
                  <div><p className="font-medium">{r.fullName}</p><p className="text-[12px] text-muted">{r.jobTitle ?? r.email}</p></div>
                </div>
              ),
            },
            { key: 'email', header: 'Email', cell: (r) => r.email, hideBelow: 'lg' },
            { key: 'roles', header: 'Roles', cell: (r) => <div className="flex flex-wrap gap-1">{r.roles.map((x) => <Badge key={x.id} tone="brand">{x.name}</Badge>)}</div> },
            { key: 'last', header: 'Last sign-in', cell: (r) => <span className="text-muted">{r.lastLoginAt ? dateTime(r.lastLoginAt) : 'Never'}</span>, hideBelow: 'md' },
            { key: 'status', header: 'Status', cell: (r) => (r.status === 'suspended' ? <Badge tone="danger" dot>Suspended</Badge> : r.locked ? <Badge tone="warning" dot>Locked</Badge> : <Badge tone="success" dot>Active</Badge>) },
          ]}
        />
        {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={(page) => set({ page }, false)} />}
      </Card>
      <UserFormModal open={creating} onClose={() => setCreating(false)} onSaved={(id) => navigate(`/users/${id}`)} />
    </Page>
  );
}
