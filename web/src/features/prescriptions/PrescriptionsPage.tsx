import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useListState } from '@/lib/hooks';
import { useFormat } from '@/lib/settings';
import { Page } from '@/components/layout/AppLayout';
import { ButtonLink, Card, DataTable, EmptyState, PageHeader, Pagination, SearchInput, Tabs, Toolbar } from '@/components/ui';
import { RxStatusBadge } from '@/components/StatusBadges';

interface RxRow { id: number; rxNumber: string; prescriptionDate: string; validUntil: string | null; status: string; prescriberName: string; prescriberFacility: string | null; customerId: number; customerName: string; customerPhone: string | null; recordedByName: string; itemCount: number; lastDispensedAt: string | null }

export function PrescriptionsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const { date, dateTime, today } = useFormat();
  const [s, set] = useListState({ search: '', status: '' });
  const query = { search: s.search, status: s.status, page: s.page, pageSize: s.pageSize };
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['prescriptions', query],
    queryFn: () => api.get<{ data: RxRow[]; total: number; page: number; pageSize: number }>('/prescriptions', query),
    placeholderData: (p) => p,
  });
  const t = today();
  return (
    <Page>
      <PageHeader title="Prescriptions" description="Record prescriptions as written by the prescriber, then dispense them at the till. The system never suggests or substitutes medicines."
        actions={can('prescriptions.manage') && <ButtonLink to="/prescriptions/new" variant="primary" icon={<Plus className="size-3.5" />}>Record prescription</ButtonLink>} />
      <Tabs className="mb-3" value={s.status} onChange={(v) => set({ status: v })} tabs={[
        { value: '', label: 'All' }, { value: 'pending', label: 'Pending' }, { value: 'partially_dispensed', label: 'Partially dispensed' },
        { value: 'dispensed', label: 'Dispensed' }, { value: 'cancelled', label: 'Cancelled' },
      ]} />
      <Card flush>
        <Toolbar><SearchInput value={s.search} onChange={(v) => set({ search: v })} placeholder="Rx number, patient, phone or prescriber" className="w-full sm:w-72" /></Toolbar>
        <DataTable
          rows={data?.data} loading={isLoading} error={error} onRetry={refetch} rowKey={(r) => r.id}
          onRowClick={(r) => navigate(`/prescriptions/${r.id}`)}
          empty={<EmptyState icon={ClipboardList} title="No prescriptions found" />}
          columns={[
            { key: 'no', header: 'Rx number', cell: (r) => <span className="font-medium">{r.rxNumber}</span> },
            { key: 'patient', header: 'Patient', cell: (r) => <div><p>{r.customerName}</p><p className="text-[12px] text-muted">{r.customerPhone ?? ''}</p></div> },
            { key: 'prescriber', header: 'Prescriber', cell: (r) => <div><p>{r.prescriberName}</p><p className="max-w-56 truncate text-[12px] text-muted">{r.prescriberFacility ?? ''}</p></div>, hideBelow: 'md' },
            { key: 'date', header: 'Date', cell: (r) => date(r.prescriptionDate), hideBelow: 'sm' },
            { key: 'valid', header: 'Valid until', cell: (r) => (r.validUntil ? <span className={r.validUntil < t && ['pending', 'partially_dispensed'].includes(r.status) ? 'text-danger' : ''}>{date(r.validUntil)}</span> : '—'), hideBelow: 'lg' },
            { key: 'items', header: 'Items', align: 'right', cell: (r) => <span className="num">{r.itemCount}</span>, hideBelow: 'lg' },
            { key: 'last', header: 'Last dispensed', cell: (r) => <span className="text-muted">{r.lastDispensedAt ? dateTime(r.lastDispensedAt) : '—'}</span>, hideBelow: 'xl' },
            { key: 'status', header: 'Status', cell: (r) => <RxStatusBadge status={r.status} /> },
          ]}
        />
        {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={(page) => set({ page }, false)} />}
      </Card>
    </Page>
  );
}
