import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, PackagePlus, Pencil, Printer, Send, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFormat } from '@/lib/settings';
import { Page } from '@/components/layout/AppLayout';
import { Alert, Button, ButtonLink, Card, ConfirmDialog, DetailList, ErrorState, PageHeader, PageLoader, useToast } from '@/components/ui';
import { PoBadge } from '@/components/StatusBadges';

interface PoDetail {
  id: number; poNumber: string; status: string; orderDate: string; expectedDate: string | null; subtotal: number; discountTotal: number; taxTotal: number;
  total: number; notes: string | null; supplierId: number; supplierName: string; supplierPhone: string; supplierEmail: string | null; supplierAddress: string | null;
  paymentTermsDays: number; createdByName: string; approvedByName: string | null; approvedAt: string | null; cancelledReason: string | null; createdAt: string;
  items: { id: number; productId: number; productName: string; sku: string; unit: string; quantityOrdered: number; quantityReceived: number; unitCost: number; discountAmount: number; taxRate: number; lineTotal: number }[];
  receipts: { id: number; grnNumber: string; receivedDate: string; totalCost: number; receivedByName: string }[];
}

export function PurchaseOrderDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const { money, amount, date, dateTime, settings, today } = useFormat();
  const [confirm, setConfirm] = useState<null | 'cancel' | 'approve'>(null);
  const { data: po, isLoading, error, refetch } = useQuery({ queryKey: ['purchase-order', id], queryFn: () => api.get<PoDetail>(`/purchasing/orders/${id}`) });
  const transition = useMutation({
    mutationFn: ({ action, reason }: { action: string; reason?: string }) => api.post(`/purchasing/orders/${id}/transition`, { action, reason: reason || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase-order', id] });
      qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      toast.success('Purchase order updated');
      setConfirm(null);
    },
    onError: (e) => toast.error('Could not update', (e as Error).message),
  });

  if (isLoading) return <PageLoader />;
  if (error || !po) return <Page><ErrorState error={error} onRetry={refetch} /></Page>;
  const editable = ['draft', 'pending'].includes(po.status);
  const receivable = ['ordered', 'partially_received'].includes(po.status);
  const overdue = receivable && po.expectedDate && po.expectedDate < today();

  return (
    <Page>
      <PageHeader
        breadcrumbs={[{ label: 'Purchase orders', to: '/purchasing/orders' }, { label: po.poNumber }]}
        title={po.poNumber}
        meta={<PoBadge status={po.status} />}
        description={<>To <Link className="text-brand-700 hover:underline" to={`/purchasing/suppliers/${po.supplierId}`}>{po.supplierName}</Link> · ordered {date(po.orderDate)} by {po.createdByName}</>}
        actions={
          <>
            <Button icon={<Printer className="size-3.5" />} onClick={() => window.print()}>Print</Button>
            {editable && can('purchasing.manage') && <ButtonLink to={`/purchasing/orders/${po.id}/edit`} icon={<Pencil className="size-3.5" />}>Edit</ButtonLink>}
            {['draft', 'pending', 'ordered'].includes(po.status) && can('purchasing.manage') && !po.receipts.length && <Button icon={<XCircle className="size-3.5" />} onClick={() => setConfirm('cancel')}>Cancel order</Button>}
            {po.status === 'cancelled' && can('purchasing.manage') && <Button onClick={() => transition.mutate({ action: 'reopen' })}>Reopen as draft</Button>}
            {po.status === 'draft' && can('purchasing.manage') && <Button variant={can('purchasing.approve') ? 'secondary' : 'primary'} icon={<Send className="size-3.5" />} loading={transition.isPending} onClick={() => transition.mutate({ action: 'submit' })}>Submit for approval</Button>}
            {editable && can('purchasing.approve') && <Button variant="primary" icon={<CheckCircle2 className="size-3.5" />} onClick={() => setConfirm('approve')}>Approve & place order</Button>}
            {receivable && can('purchasing.receive') && <ButtonLink to={`/purchasing/receipts/new?po=${po.id}`} variant="primary" icon={<PackagePlus className="size-3.5" />}>Receive stock</ButtonLink>}
          </>
        }
      />
      {po.status === 'cancelled' && po.cancelledReason && <Alert tone="warning" className="mb-4" title="Cancelled">{po.cancelledReason}</Alert>}
      {overdue && <Alert tone="warning" className="mb-4">Delivery was expected on {date(po.expectedDate!)}. Follow up with {po.supplierName} on {po.supplierPhone}.</Alert>}

      <div className="print-area grid gap-4 lg:grid-cols-3">
        <div className="hidden print:block lg:col-span-3">
          <p className="text-[18px] font-bold">{settings?.general.pharmacyName} — Purchase order {po.poNumber}</p>
          <p className="text-[12px]">{settings?.general.address} · {settings?.general.phone} · TIN {settings?.general.tin}</p>
        </div>
        <Card title="Items" className="lg:col-span-2" flush>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-subtle text-[11.5px] uppercase tracking-[0.04em] text-muted">
                <tr className="border-b border-line">
                  <th className="px-4 py-2 text-left font-medium">Product</th>
                  <th className="px-3 py-2 text-right font-medium">Ordered</th>
                  <th className="px-3 py-2 text-right font-medium">Received</th>
                  <th className="px-3 py-2 text-right font-medium">Unit cost</th>
                  <th className="px-4 py-2 text-right font-medium">Line total</th>
                </tr>
              </thead>
              <tbody>
                {po.items.map((i) => (
                  <tr key={i.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2.5"><Link to={`/inventory/products/${i.productId}`} className="hover:text-brand-700">{i.productName}</Link><span className="block text-[11.5px] text-muted">{i.sku}{i.discountAmount > 0 ? ` · discount ${amount(i.discountAmount)}` : ''}{i.taxRate > 0 ? ` · VAT ${i.taxRate}%` : ''}</span></td>
                    <td className="px-3 py-2.5 text-right num">{i.quantityOrdered} <span className="text-muted">{i.unit}</span></td>
                    <td className={`px-3 py-2.5 text-right num ${i.quantityReceived >= i.quantityOrdered ? 'text-brand-700' : i.quantityReceived > 0 ? 'text-warning' : 'text-muted'}`}>{i.quantityReceived}</td>
                    <td className="px-3 py-2.5 text-right num">{amount(i.unitCost)}</td>
                    <td className="px-4 py-2.5 text-right font-medium num">{amount(i.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="ml-auto max-w-xs space-y-1 border-t border-line px-4 py-3 text-[13px]">
            <div className="flex justify-between text-muted"><dt>Subtotal</dt><dd className="num">{money(po.subtotal)}</dd></div>
            {po.discountTotal > 0 && <div className="flex justify-between text-muted"><dt>Discount</dt><dd className="num">−{money(po.discountTotal)}</dd></div>}
            {po.taxTotal > 0 && <div className="flex justify-between text-muted"><dt>VAT</dt><dd className="num">{money(po.taxTotal)}</dd></div>}
            <div className="flex justify-between pt-1 text-[14px] font-semibold"><dt>Total</dt><dd className="num">{money(po.total)}</dd></div>
          </dl>
        </Card>
        <div className="space-y-4">
          <Card title="Details">
            <DetailList columns={1} items={[
              { label: 'Supplier', value: <>{po.supplierName}<span className="block text-[12px] text-muted">{[po.supplierPhone, po.supplierEmail].filter(Boolean).join(' · ')}</span></> },
              { label: 'Expected delivery', value: po.expectedDate ? date(po.expectedDate) : null },
              { label: 'Payment terms', value: `${po.paymentTermsDays} days` },
              { label: 'Approved', value: po.approvedByName ? `${po.approvedByName}, ${dateTime(po.approvedAt!)}` : null, hidden: !po.approvedByName },
              { label: 'Notes', value: po.notes, hidden: !po.notes },
            ]} />
          </Card>
          <Card title="Deliveries" className="no-print" flush>
            {po.receipts.length ? (
              <ul className="divide-y divide-line">
                {po.receipts.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
                    <Link to={`/purchasing/receipts/${r.id}`} className="font-medium text-brand-700 hover:underline">{r.grnNumber}</Link>
                    <span className="text-muted">{date(r.receivedDate)}</span>
                    <span className="num">{amount(r.totalCost)}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="px-4 py-4 text-[12.5px] text-muted">Nothing received yet.</p>}
          </Card>
        </div>
      </div>
      <ConfirmDialog
        open={confirm === 'cancel'}
        onClose={() => setConfirm(null)}
        onConfirm={(reason) => transition.mutate({ action: 'cancel', reason })}
        loading={transition.isPending}
        tone="danger"
        title={`Cancel ${po.poNumber}?`}
        message="The supplier should be told separately. You can reopen a cancelled order as a draft."
        confirmLabel="Cancel order"
        requireReason
      />
      <ConfirmDialog
        open={confirm === 'approve'}
        onClose={() => setConfirm(null)}
        onConfirm={() => transition.mutate({ action: 'approve' })}
        loading={transition.isPending}
        title="Approve and place this order?"
        message={`${money(po.total)} to ${po.supplierName}. After approval the order can be received but no longer edited.`}
        confirmLabel="Approve"
      />
    </Page>
  );
}
