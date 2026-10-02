import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Banknote, Pencil, Plus } from 'lucide-react';
import { SUPPLIER_PAYMENT_METHODS } from '@dawa/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFormat } from '@/lib/settings';
import { Page } from '@/components/layout/AppLayout';
import { Badge, Button, ButtonLink, Card, DataTable, DetailList, EmptyState, ErrorState, Figure, PageHeader, PageLoader, SummaryStrip, Tabs } from '@/components/ui';
import { ActiveBadge, PoBadge } from '@/components/StatusBadges';
import { SupplierFormModal, SupplierPaymentModal } from './SupplierForm';

interface SupplierDetail {
  id: number; code: string; name: string; contactPerson: string | null; phone: string; email: string | null; address: string | null; tin: string | null; vrn: string | null;
  paymentTermsDays: number; creditLimit: number; status: string; notes: string | null; outstanding: number; overdue: number; lastDelivery: string | null;
  receipts: { id: number; grnNumber: string; receivedDate: string; dueDate: string; totalCost: number; paid: number; supplierInvoiceNo: string | null; poNumber: string | null }[];
  payments: { id: number; paymentNo: string; amount: number; method: string; reference: string | null; paidDate: string; grnNumber: string | null; recordedByName: string }[];
  purchaseOrders: { id: number; poNumber: string; status: string; orderDate: string; total: number }[];
  products: { id: number; sku: string; name: string; lastCost: number; lastSuppliedAt: string }[];
}

export function SupplierDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const { money, amount, date, currency, today } = useFormat();
  const [tab, setTab] = useState<'deliveries' | 'payments' | 'orders' | 'products'>('deliveries');
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState(false);
  const { data: s, isLoading, error, refetch } = useQuery({ queryKey: ['supplier', id], queryFn: () => api.get<SupplierDetail>(`/suppliers/${id}`) });
  if (isLoading) return <PageLoader />;
  if (error || !s) return <Page><ErrorState error={error} onRetry={refetch} /></Page>;
  const t = today();
  return (
    <Page>
      <PageHeader
        breadcrumbs={[{ label: 'Suppliers', to: '/purchasing/suppliers' }, { label: s.code }]}
        title={s.name}
        meta={<ActiveBadge status={s.status} />}
        description={[s.contactPerson, s.phone, s.email].filter(Boolean).join(' · ')}
        actions={
          <>
            {can('suppliers.manage') && <Button icon={<Pencil className="size-3.5" />} onClick={() => setEditing(true)}>Edit</Button>}
            {can('purchasing.manage') && <ButtonLink to={`/purchasing/orders/new?supplierId=${s.id}`} icon={<Plus className="size-3.5" />}>New order</ButtonLink>}
            {can('suppliers.payments') && s.outstanding > 0 && <Button variant="primary" icon={<Banknote className="size-3.5" />} onClick={() => setPaying(true)}>Pay supplier</Button>}
          </>
        }
      />
      <SummaryStrip className="mb-4">
        <Figure label="Outstanding balance" value={money(s.outstanding)} />
        <Figure label="Overdue" value={money(s.overdue)} tone={s.overdue > 0 ? 'danger' : undefined} sub={`Terms: ${s.paymentTermsDays} days`} />
        <Figure label="Credit limit" value={money(s.creditLimit)} sub={s.creditLimit > 0 ? `${Math.round((s.outstanding / s.creditLimit) * 100)}% used` : undefined} />
        <Figure label="Last delivery" value={s.lastDelivery ? date(s.lastDelivery) : '—'} />
      </SummaryStrip>
      <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
        <Card flush>
          <div className="px-4 pt-3">
            <Tabs value={tab} onChange={setTab} tabs={[
              { value: 'deliveries', label: 'Deliveries', count: s.receipts.length },
              { value: 'payments', label: 'Payments', count: s.payments.length },
              { value: 'orders', label: 'Purchase orders', count: s.purchaseOrders.length },
              { value: 'products', label: 'Products supplied', count: s.products.length },
            ]} />
          </div>
          {tab === 'deliveries' && (
            <DataTable rows={s.receipts} rowKey={(r) => r.id} empty={<EmptyState compact title="No deliveries yet" />} columns={[
              { key: 'grn', header: 'Receipt', cell: (r) => <Link to={`/purchasing/receipts/${r.id}`} className="font-medium text-brand-700 hover:underline">{r.grnNumber}</Link> },
              { key: 'inv', header: 'Supplier invoice', cell: (r) => r.supplierInvoiceNo ?? '—', hideBelow: 'md' },
              { key: 'date', header: 'Received', cell: (r) => date(r.receivedDate) },
              { key: 'due', header: 'Due', cell: (r) => <span className={r.totalCost - r.paid > 0.009 && r.dueDate < t ? 'font-medium text-danger' : ''}>{date(r.dueDate)}</span>, hideBelow: 'md' },
              { key: 'total', header: `Total (${currency})`, align: 'right', cell: (r) => <span className="num">{amount(r.totalCost)}</span> },
              { key: 'paid', header: 'Payment', cell: (r) => (r.paid >= r.totalCost - 0.009 ? <Badge tone="success">Paid</Badge> : r.paid > 0 ? <Badge tone="warning">Part paid</Badge> : <Badge tone={r.dueDate < t ? 'danger' : 'neutral'}>{r.dueDate < t ? 'Overdue' : 'Unpaid'}</Badge>) },
            ]} />
          )}
          {tab === 'payments' && (
            <DataTable rows={s.payments} rowKey={(r) => r.id} empty={<EmptyState compact title="No payments recorded" />} columns={[
              { key: 'no', header: 'Payment', cell: (r) => <span className="font-medium">{r.paymentNo}</span> },
              { key: 'date', header: 'Date', cell: (r) => date(r.paidDate) },
              { key: 'method', header: 'Method', cell: (r) => SUPPLIER_PAYMENT_METHODS[r.method as keyof typeof SUPPLIER_PAYMENT_METHODS], hideBelow: 'md' },
              { key: 'ref', header: 'Reference', cell: (r) => r.reference ?? '—', hideBelow: 'lg' },
              { key: 'grn', header: 'For', cell: (r) => r.grnNumber ?? 'Account', hideBelow: 'md' },
              { key: 'amt', header: `Amount (${currency})`, align: 'right', cell: (r) => <span className="font-medium num">{amount(r.amount)}</span> },
            ]} />
          )}
          {tab === 'orders' && (
            <DataTable rows={s.purchaseOrders} rowKey={(r) => r.id} empty={<EmptyState compact title="No purchase orders" />} columns={[
              { key: 'no', header: 'PO', cell: (r) => <Link to={`/purchasing/orders/${r.id}`} className="font-medium text-brand-700 hover:underline">{r.poNumber}</Link> },
              { key: 'date', header: 'Date', cell: (r) => date(r.orderDate) },
              { key: 'total', header: `Total (${currency})`, align: 'right', cell: (r) => <span className="num">{amount(r.total)}</span> },
              { key: 'status', header: 'Status', cell: (r) => <PoBadge status={r.status} /> },
            ]} />
          )}
          {tab === 'products' && (
            <DataTable rows={s.products} rowKey={(r) => r.id} empty={<EmptyState compact title="No products supplied yet" />} columns={[
              { key: 'name', header: 'Product', cell: (r) => <Link to={`/inventory/products/${r.id}`} className="hover:text-brand-700">{r.name}</Link> },
              { key: 'sku', header: 'SKU', cell: (r) => <span className="font-mono text-[12px] text-muted">{r.sku}</span>, hideBelow: 'md' },
              { key: 'cost', header: `Last cost (${currency})`, align: 'right', cell: (r) => <span className="num">{amount(r.lastCost)}</span> },
              { key: 'when', header: 'Last supplied', cell: (r) => (r.lastSuppliedAt ? date(r.lastSuppliedAt) : '—') },
            ]} />
          )}
        </Card>
        <Card title="Details">
          <DetailList columns={1} items={[
            { label: 'Address', value: s.address },
            { label: 'TIN / VRN', value: [s.tin, s.vrn].filter(Boolean).join(' / ') || null },
            { label: 'Payment terms', value: `${s.paymentTermsDays} days` },
            { label: 'Notes', value: s.notes, hidden: !s.notes },
          ]} />
        </Card>
      </div>
      <SupplierFormModal open={editing} onClose={() => setEditing(false)} supplier={s as unknown as Record<string, unknown>} />
      <SupplierPaymentModal open={paying} onClose={() => setPaying(false)} supplierId={s.id} supplierName={s.name} outstanding={s.outstanding} receipts={s.receipts} />
    </Page>
  );
}
