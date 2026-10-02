import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Pill, Printer, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFormat } from '@/lib/settings';
import { Page } from '@/components/layout/AppLayout';
import { Alert, Button, ButtonLink, Card, ConfirmDialog, DataTable, DetailList, EmptyState, ErrorState, PageHeader, PageLoader, useToast } from '@/components/ui';
import { RxStatusBadge, RxTag } from '@/components/StatusBadges';

interface RxDetail {
  id: number; rxNumber: string; status: string; prescriberName: string; prescriberFacility: string | null; prescriberRegNo: string | null; prescriptionDate: string; validUntil: string | null;
  diagnosisNote: string | null; notes: string | null; cancelledReason: string | null; customerId: number; customerName: string; customerPhone: string | null; dateOfBirth: string | null;
  recordedByName: string; createdAt: string; isExpired: boolean;
  items: { id: number; productId: number; productName: string; strength: string | null; requiresPrescription: boolean; dosageInstructions: string; quantity: number; durationDays: number | null; refillsAllowed: number; quantityDispensed: number; quantityRemaining: number; unit: string }[];
  dispensings: { id: number; quantity: number; dispensedAt: string; productName: string; saleId: number; invoiceNo: string; dispensedByName: string }[];
}

export function PrescriptionDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { date, dateTime, settings } = useFormat();
  const [cancelling, setCancelling] = useState(false);
  const { data: rx, isLoading, error, refetch } = useQuery({ queryKey: ['prescription', id], queryFn: () => api.get<RxDetail>(`/prescriptions/${id}`) });
  const cancel = useMutation({
    mutationFn: (reason: string) => api.post(`/prescriptions/${id}/cancel`, { reason }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['prescription', id] }); qc.invalidateQueries({ queryKey: ['prescriptions'] }); toast.success('Prescription cancelled'); setCancelling(false); },
    onError: (e) => toast.error('Could not cancel', (e as Error).message),
  });
  if (isLoading) return <PageLoader />;
  if (error || !rx) return <Page><ErrorState error={error} onRetry={refetch} /></Page>;
  const open = ['pending', 'partially_dispensed'].includes(rx.status);
  return (
    <Page>
      <PageHeader
        breadcrumbs={[{ label: 'Prescriptions', to: '/prescriptions' }, { label: rx.rxNumber }]}
        title={rx.rxNumber}
        meta={<RxStatusBadge status={rx.status} />}
        description={<>For <Link to={`/customers/${rx.customerId}`} className="text-brand-700 hover:underline">{rx.customerName}</Link> · written {date(rx.prescriptionDate)} by {rx.prescriberName}</>}
        actions={
          <>
            <Button icon={<Printer className="size-3.5" />} onClick={() => window.print()}>Print</Button>
            {rx.status === 'pending' && can('prescriptions.manage') && <ButtonLink to={`/prescriptions/${rx.id}/edit`} icon={<Pencil className="size-3.5" />}>Edit</ButtonLink>}
            {open && can('prescriptions.manage') && <Button icon={<XCircle className="size-3.5" />} onClick={() => setCancelling(true)}>Cancel</Button>}
            {open && !rx.isExpired && can('prescriptions.dispense') && can('pos.sell') && (
              <Button variant="primary" icon={<Pill className="size-3.5" />} onClick={() => navigate(`/pos?prescription=${rx.id}`)}>Dispense at till</Button>
            )}
          </>
        }
      />
      {rx.isExpired && open && <Alert tone="warning" className="mb-4">This prescription expired on {date(rx.validUntil!)} and can no longer be dispensed.</Alert>}
      {rx.status === 'cancelled' && <Alert tone="warning" className="mb-4" title="Cancelled">{rx.cancelledReason}</Alert>}
      <div className="print-area grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <div className="hidden print:block"><p className="text-[16px] font-bold">{settings?.general.pharmacyName} — Prescription {rx.rxNumber}</p></div>
          <Card title="Medicines" flush>
            <ul className="divide-y divide-line">
              {rx.items.map((i) => {
                const authorised = i.quantity * (i.refillsAllowed + 1);
                return (
                  <li key={i.id} className="flex flex-wrap items-start gap-4 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 font-medium"><Link to={`/inventory/products/${i.productId}`} className="hover:text-brand-700">{i.productName}</Link>{i.requiresPrescription && <RxTag />}</p>
                      <p className="mt-0.5 text-[13px]">{i.dosageInstructions}</p>
                      <p className="mt-0.5 text-[12px] text-muted">{i.quantity} {i.unit}{i.durationDays ? ` · ${i.durationDays} days` : ''}{i.refillsAllowed ? ` · ${i.refillsAllowed} refill(s)` : ''}</p>
                    </div>
                    <div className="text-right text-[12.5px]">
                      <p className="num"><b>{i.quantityDispensed}</b> of {authorised} dispensed</p>
                      <div className="mt-1.5 h-1.5 w-32 rounded-full bg-subtle"><div className="h-1.5 rounded-full bg-brand-600" style={{ width: `${Math.min((i.quantityDispensed / authorised) * 100, 100)}%` }} /></div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
          <Card title="Dispensing history" flush className="no-print">
            <DataTable rows={rx.dispensings} rowKey={(d) => d.id} empty={<EmptyState compact title="Not dispensed yet" />} columns={[
              { key: 'when', header: 'Date', cell: (d) => <span className="num">{dateTime(d.dispensedAt)}</span> },
              { key: 'p', header: 'Medicine', cell: (d) => d.productName },
              { key: 'q', header: 'Qty', align: 'right', cell: (d) => <span className="num">{d.quantity}</span> },
              { key: 'inv', header: 'Invoice', cell: (d) => <Link to={`/sales/${d.saleId}`} className="text-brand-700 hover:underline">{d.invoiceNo}</Link> },
              { key: 'by', header: 'Pharmacist', cell: (d) => d.dispensedByName, hideBelow: 'md' },
            ]} />
          </Card>
        </div>
        <Card title="Details">
          <DetailList columns={1} items={[
            { label: 'Patient', value: <>{rx.customerName}<span className="block text-[12px] text-muted">{[rx.customerPhone, rx.dateOfBirth && `born ${date(rx.dateOfBirth)}`].filter(Boolean).join(' · ')}</span></> },
            { label: 'Prescriber', value: <>{rx.prescriberName}<span className="block text-[12px] text-muted">{[rx.prescriberFacility, rx.prescriberRegNo].filter(Boolean).join(' · ')}</span></> },
            { label: 'Valid until', value: rx.validUntil ? date(rx.validUntil) : 'No expiry set' },
            { label: 'Clinical note', value: rx.diagnosisNote, hidden: !rx.diagnosisNote },
            { label: 'Notes', value: rx.notes, hidden: !rx.notes },
            { label: 'Recorded', value: `${dateTime(rx.createdAt)} by ${rx.recordedByName}` },
          ]} />
        </Card>
      </div>
      <ConfirmDialog open={cancelling} onClose={() => setCancelling(false)} onConfirm={(r) => cancel.mutate(r)} loading={cancel.isPending} tone="danger" requireReason
        title={`Cancel ${rx.rxNumber}?`} message="Remaining quantities can no longer be dispensed. Dispensing history is kept." confirmLabel="Cancel prescription" />
    </Page>
  );
}
