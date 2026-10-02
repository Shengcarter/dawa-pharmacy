import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useFormat } from '@/lib/settings';
import type { CustomerOption } from '@/lib/types';
import { Page } from '@/components/layout/AppLayout';
import { Alert, Button, Card, EmptyState, Field, IconButton, Input, PageHeader, PageLoader, Textarea, useToast } from '@/components/ui';
import { CustomerPicker } from '@/components/CustomerPicker';
import { ProductPicker } from '@/components/ProductPicker';
import { RxTag } from '@/components/StatusBadges';

interface ItemLine { productId: number; name: string; requiresPrescription: boolean; dosageInstructions: string; quantity: string; durationDays: string; refillsAllowed: string }

export function PrescriptionFormPage() {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { today } = useFormat();
  const [patient, setPatient] = useState<CustomerOption | null>(null);
  const [prescriberName, setPrescriberName] = useState('');
  const [facility, setFacility] = useState('');
  const [regNo, setRegNo] = useState('');
  const [rxDate, setRxDate] = useState(today());
  const [validUntil, setValidUntil] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<ItemLine[]>([]);
  const [error, setError] = useState<string | null>(null);

  const existing = useQuery({ queryKey: ['prescription', id], queryFn: () => api.get<Record<string, never>>(`/prescriptions/${id}`), enabled: editing });
  useEffect(() => {
    const rx = existing.data as unknown as { customerId: number; customerName: string; customerCode: string; customerPhone: string | null; prescriberName: string; prescriberFacility: string | null; prescriberRegNo: string | null; prescriptionDate: string; validUntil: string | null; notes: string | null; items: { productId: number; productName: string; requiresPrescription: boolean; dosageInstructions: string; quantity: number; durationDays: number | null; refillsAllowed: number }[] } | undefined;
    if (!rx) return;
    setPatient({ id: rx.customerId, fullName: rx.customerName, code: rx.customerCode, phone: rx.customerPhone, customerType: 'regular', creditLimit: 0, storeCreditBalance: 0, outstanding: 0 });
    setPrescriberName(rx.prescriberName); setFacility(rx.prescriberFacility ?? ''); setRegNo(rx.prescriberRegNo ?? '');
    setRxDate(rx.prescriptionDate); setValidUntil(rx.validUntil ?? ''); setNotes(rx.notes ?? '');
    setItems(rx.items.map((i) => ({ productId: i.productId, name: i.productName, requiresPrescription: i.requiresPrescription, dosageInstructions: i.dosageInstructions, quantity: String(i.quantity), durationDays: i.durationDays ? String(i.durationDays) : '', refillsAllowed: String(i.refillsAllowed) })));
  }, [existing.data]);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        customerId: patient?.id, prescriberName, prescriberFacility: facility || null, prescriberRegNo: regNo || null, prescriptionDate: rxDate,
        validUntil: validUntil || null, notes: notes || null,
        items: items.map((i) => ({ productId: i.productId, dosageInstructions: i.dosageInstructions, quantity: i.quantity, durationDays: i.durationDays || null, refillsAllowed: i.refillsAllowed || 0 })),
      };
      return editing ? api.put<{ id: number }>(`/prescriptions/${id}`, body) : api.post<{ id: number; rxNumber: string }>('/prescriptions', body);
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['prescriptions'] });
      qc.invalidateQueries({ queryKey: ['prescription', String(r.id)] });
      toast.success(editing ? 'Prescription updated' : 'Prescription recorded');
      navigate(`/prescriptions/${r.id}`);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not save'),
  });
  const update = (i: number, patch: Partial<ItemLine>) => setItems((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  if (editing && existing.isLoading) return <PageLoader />;
  const ready = patient && prescriberName.trim() && items.length && items.every((i) => i.dosageInstructions.trim() && Number(i.quantity) > 0);

  return (
    <Page>
      <PageHeader breadcrumbs={[{ label: 'Prescriptions', to: '/prescriptions' }, { label: editing ? 'Edit' : 'New' }]} title={editing ? 'Edit prescription' : 'Record prescription'}
        description="Copy the prescription exactly as written. Dispense it from the till once recorded."
        actions={<><Button onClick={() => navigate(-1)}>Cancel</Button><Button variant="primary" disabled={!ready} loading={save.isPending} onClick={() => save.mutate()}>Save prescription</Button></>} />
      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card title="Prescribed medicines" flush>
          {items.length ? (
            <ul className="divide-y divide-line">
              {items.map((it, i) => (
                <li key={it.productId} className="grid gap-3 px-4 py-3 sm:grid-cols-[1fr_auto]">
                  <div className="space-y-2">
                    <p className="flex items-center gap-1.5 font-medium">{it.name}{it.requiresPrescription && <RxTag />}</p>
                    <Input aria-label="Dosage instructions" placeholder="Dosage instructions, e.g. 1 capsule three times daily after meals for 5 days" value={it.dosageInstructions} onChange={(e) => update(i, { dosageInstructions: e.target.value })} />
                  </div>
                  <div className="flex items-start gap-2">
                    <Field label="Qty">{(fid) => <Input id={fid} inputMode="numeric" value={it.quantity} onChange={(e) => update(i, { quantity: e.target.value.replace(/\D/g, '') })} className="w-16 text-right" />}</Field>
                    <Field label="Days">{(fid) => <Input id={fid} inputMode="numeric" value={it.durationDays} onChange={(e) => update(i, { durationDays: e.target.value.replace(/\D/g, '') })} className="w-16 text-right" />}</Field>
                    <Field label="Refills">{(fid) => <Input id={fid} inputMode="numeric" value={it.refillsAllowed} onChange={(e) => update(i, { refillsAllowed: e.target.value.replace(/\D/g, '').slice(0, 2) })} className="w-16 text-right" />}</Field>
                    <IconButton label="Remove" size="sm" className="mt-5" onClick={() => setItems(items.filter((_, j) => j !== i))}><Trash2 className="size-3.5" /></IconButton>
                  </div>
                </li>
              ))}
            </ul>
          ) : <EmptyState compact title="No medicines yet" description="Search for each medicine on the prescription." />}
          <div className="border-t border-line p-3">
            <ProductPicker placeholder="Add a medicine from the prescription" exclude={items.map((i) => i.productId)}
              onPick={(p) => setItems((ls) => [...ls, { productId: p.id, name: p.name, requiresPrescription: p.requiresPrescription, dosageInstructions: '', quantity: '1', durationDays: '', refillsAllowed: '0' }])} />
          </div>
        </Card>
        <div className="space-y-4">
          <Card title="Patient">
            <CustomerPicker value={patient} onChange={setPatient} placeholder="Search patient name or phone" />
            <p className="mt-2 text-[11.5px] text-muted">Only record what is needed to dispense safely. Diagnoses are not required.</p>
          </Card>
          <Card title="Prescriber">
            <div className="space-y-3.5">
              <Field label="Prescriber name" required>{(fid) => <Input id={fid} value={prescriberName} onChange={(e) => setPrescriberName(e.target.value)} placeholder="Dr. …" />}</Field>
              <Field label="Facility">{(fid) => <Input id={fid} value={facility} onChange={(e) => setFacility(e.target.value)} />}</Field>
              <Field label="Registration no.">{(fid) => <Input id={fid} value={regNo} onChange={(e) => setRegNo(e.target.value)} placeholder="MCT-…" />}</Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Prescription date" required>{(fid) => <Input id={fid} type="date" max={today()} value={rxDate} onChange={(e) => setRxDate(e.target.value)} />}</Field>
                <Field label="Valid until">{(fid) => <Input id={fid} type="date" min={rxDate} value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />}</Field>
              </div>
              <Field label="Notes">{(fid) => <Textarea id={fid} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
            </div>
          </Card>
        </div>
      </div>
    </Page>
  );
}
