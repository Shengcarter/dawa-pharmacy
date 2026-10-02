import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { CUSTOMER_TYPES, GENDERS, SALE_PAYMENT_TYPES } from '@dawa/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFormat } from '@/lib/settings';
import { Page } from '@/components/layout/AppLayout';
import { Button, Card, DataTable, DetailList, EmptyState, ErrorState, Figure, PageHeader, PageLoader, SummaryStrip, Tabs } from '@/components/ui';
import { ActiveBadge, PaymentStatusBadge, RxStatusBadge } from '@/components/StatusBadges';
import { CustomerFormModal } from './CustomerForm';

interface CustomerDetail {
  id: number; code: string; fullName: string; phone: string | null; email: string | null; address: string | null; dateOfBirth: string | null; gender: string | null;
  customerType: string; insuranceProvider: string | null; insuranceSchemeName?: string | null; insuranceSchemeId?: number | null; insuranceMemberNo?: string | null; creditLimit: number; storeCreditBalance: number; notes: string | null; status: string;
  createdAt: string; outstanding: number; lastPurchase: string | null; lifetimeValue: number; visits: number;
  sales: { id: number; invoiceNo: string; createdAt: string; total: number; balanceDue: number; paymentType: string; paymentStatus: string; status: string; lineCount: number }[];
  prescriptions: { id: number; rxNumber: string; prescriberName: string; prescriptionDate: string; status: string }[] | null;
}

export function CustomerDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const navigate = useNavigate();
  const { money, amount, date, dateTime, currency } = useFormat();
  const [tab, setTab] = useState<'purchases' | 'prescriptions'>('purchases');
  const [editing, setEditing] = useState(false);
  const { data: c, isLoading, error, refetch } = useQuery({ queryKey: ['customer', id], queryFn: () => api.get<CustomerDetail>(`/customers/${id}`) });
  if (isLoading) return <PageLoader />;
  if (error || !c) return <Page><ErrorState error={error} onRetry={refetch} /></Page>;
  return (
    <Page>
      <PageHeader breadcrumbs={[{ label: 'Customers', to: '/customers' }, { label: c.code }]} title={c.fullName} meta={<ActiveBadge status={c.status} />}
        description={[CUSTOMER_TYPES[c.customerType as keyof typeof CUSTOMER_TYPES], c.phone, c.email].filter(Boolean).join(' · ')}
        actions={can('customers.manage') && <Button icon={<Pencil className="size-3.5" />} onClick={() => setEditing(true)}>Edit</Button>} />
      <SummaryStrip className="mb-4">
        <Figure label="Balance owed" value={money(c.outstanding)} tone={c.outstanding > 0 ? 'warning' : undefined} sub={c.creditLimit > 0 ? `Limit ${money(c.creditLimit)}` : 'No credit'} />
        <Figure label="Store credit" value={money(c.storeCreditBalance)} />
        <Figure label="Total spent" value={money(c.lifetimeValue)} sub={`${c.visits} visit(s)`} />
        <Figure label="Last purchase" value={c.lastPurchase ? date(c.lastPurchase) : '—'} />
      </SummaryStrip>
      <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
        <Card flush>
          <div className="px-4 pt-3">
            <Tabs value={tab} onChange={setTab} tabs={[
              { value: 'purchases', label: 'Purchases', count: c.sales.length },
              ...(c.prescriptions ? [{ value: 'prescriptions' as const, label: 'Prescriptions', count: c.prescriptions.length }] : []),
            ]} />
          </div>
          {tab === 'purchases' ? (
            <DataTable rows={c.sales} rowKey={(r) => r.id} onRowClick={(r) => navigate(`/sales/${r.id}`)} empty={<EmptyState compact title="No purchases yet" />} columns={[
              { key: 'inv', header: 'Invoice', cell: (r) => <span className="font-medium">{r.invoiceNo}</span> },
              { key: 'date', header: 'Date', cell: (r) => <span className="text-muted num">{dateTime(r.createdAt)}</span> },
              { key: 'method', header: 'Method', cell: (r) => SALE_PAYMENT_TYPES[r.paymentType as keyof typeof SALE_PAYMENT_TYPES], hideBelow: 'md' },
              { key: 'total', header: `Total (${currency})`, align: 'right', cell: (r) => <span className="num">{amount(r.total)}</span> },
              { key: 'bal', header: 'Balance', align: 'right', cell: (r) => (r.balanceDue > 0 ? <span className="text-warning num">{amount(r.balanceDue)}</span> : <span className="text-faint">—</span>), hideBelow: 'sm' },
              { key: 'st', header: 'Payment', cell: (r) => <PaymentStatusBadge status={r.paymentStatus} /> },
            ]} />
          ) : (
            <DataTable rows={c.prescriptions ?? []} rowKey={(r) => r.id} onRowClick={(r) => navigate(`/prescriptions/${r.id}`)} empty={<EmptyState compact title="No prescriptions" />} columns={[
              { key: 'no', header: 'Rx number', cell: (r) => <span className="font-medium">{r.rxNumber}</span> },
              { key: 'date', header: 'Date', cell: (r) => date(r.prescriptionDate) },
              { key: 'by', header: 'Prescriber', cell: (r) => r.prescriberName },
              { key: 'st', header: 'Status', cell: (r) => <RxStatusBadge status={r.status} /> },
            ]} />
          )}
        </Card>
        <Card title="Details">
          <DetailList columns={1} items={[
            { label: 'Customer code', value: c.code },
            { label: 'Address', value: c.address },
            { label: 'Date of birth', value: c.dateOfBirth ? date(c.dateOfBirth) : null },
            { label: 'Gender', value: c.gender ? GENDERS[c.gender as keyof typeof GENDERS] : null },
            { label: 'Insurance', value: [c.insuranceSchemeName ?? c.insuranceProvider, c.insuranceMemberNo].filter(Boolean).join(' · ') || null },
            { label: 'Notes', value: c.notes, hidden: !c.notes },
            { label: 'Registered', value: date(c.createdAt) },
          ]} />
          {c.outstanding > 0 && can('sales.record_payment') && (
            <p className="mt-4 border-t border-line pt-3 text-[12.5px] text-muted">Record payments on each unpaid invoice under <Link to={`/sales?customerId=${c.id}&from=2000-01-01`} className="text-brand-700 hover:underline">Invoices</Link>.</p>
          )}
        </Card>
      </div>
      <CustomerFormModal open={editing} onClose={() => setEditing(false)} customer={c as unknown as Record<string, unknown>} />
    </Page>
  );
}
