import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ShieldPlus } from 'lucide-react';
import { INSURANCE_COVERAGE, insuranceSchemeSchema } from '@dawa/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { applyServerErrors, useZodForm } from '@/lib/forms';
import { useFormat } from '@/lib/settings';
import { Page } from '@/components/layout/AppLayout';
import { Alert, Button, Card, Checkbox, DataTable, EmptyState, Field, Input, Modal, PageHeader, Select, Textarea, useToast } from '@/components/ui';
import { ActiveBadge } from '@/components/StatusBadges';

export interface Scheme {
  id: number; code: string; name: string; contactName: string | null; phone: string | null; email: string | null; address: string | null;
  copayPercent: number; coverage: keyof typeof INSURANCE_COVERAGE; requiresPrescription: boolean; claimTermsDays: number;
  status: 'active' | 'inactive'; notes: string | null; priceCount?: number; memberCount?: number; outstanding?: number;
}

export function useSchemes(all = true) {
  return useQuery({ queryKey: ['insurance-schemes', all], queryFn: () => api.get<Scheme[]>('/insurance/schemes', { all: String(all) }), staleTime: 60_000 });
}

export function SchemesPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const { amount, currency } = useFormat();
  const [creating, setCreating] = useState(false);
  const schemes = useSchemes(true);
  return (
    <Page>
      <PageHeader
        title="Insurance schemes"
        description="Each scheme's co-pay, what it covers and its agreed price list. Patients are linked to a scheme on their customer record."
        actions={can('insurance.manage') && <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setCreating(true)}>Add scheme</Button>}
      />
      <Card flush>
        <DataTable
          rows={schemes.data} loading={schemes.isLoading} error={schemes.error} onRetry={schemes.refetch} rowKey={(r) => r.id}
          onRowClick={(r) => navigate(`/insurance/schemes/${r.id}`)}
          empty={<EmptyState icon={ShieldPlus} title="No insurance schemes yet" description="Add NHIF or a private insurer, then enter the prices they have approved." />}
          columns={[
            { key: 'name', header: 'Scheme', cell: (r) => <div><p className="font-medium">{r.name}</p><p className="text-[12px] text-muted">{r.code}</p></div> },
            { key: 'copay', header: 'Co-pay', cell: (r) => `${Number(r.copayPercent)}%` },
            { key: 'coverage', header: 'Covers', cell: (r) => (r.coverage === 'all_products' ? 'All medicines' : 'Listed medicines only'), hideBelow: 'md' },
            { key: 'prices', header: 'Prices', align: 'right', cell: (r) => <span className="num">{r.priceCount}</span>, hideBelow: 'sm' },
            { key: 'members', header: 'Members', align: 'right', cell: (r) => <span className="num">{r.memberCount}</span>, hideBelow: 'md' },
            { key: 'owed', header: `Owed (${currency})`, align: 'right', cell: (r) => <span className={Number(r.outstanding) > 0 ? 'font-medium num' : 'text-muted num'}>{amount(Number(r.outstanding))}</span> },
            { key: 'status', header: 'Status', cell: (r) => <ActiveBadge status={r.status} /> },
          ]}
        />
      </Card>
      <SchemeFormModal open={creating} onClose={() => setCreating(false)} onSaved={(id) => navigate(`/insurance/schemes/${id}`)} />
    </Page>
  );
}

export function SchemeFormModal({ open, onClose, scheme, onSaved }: { open: boolean; onClose: () => void; scheme?: Scheme | null; onSaved?: (id: number) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const form = useZodForm(insuranceSchemeSchema);
  useEffect(() => {
    if (!open) return;
    setError(null);
    const s = scheme;
    form.reset({
      code: s?.code ?? '', name: s?.name ?? '', contactName: s?.contactName ?? '', phone: s?.phone ?? '', email: s?.email ?? '', address: s?.address ?? '',
      copayPercent: s ? Number(s.copayPercent) : 0, coverage: s?.coverage ?? 'listed_only', requiresPrescription: s?.requiresPrescription ?? true,
      claimTermsDays: s?.claimTermsDays ?? 30, status: s?.status ?? 'active', notes: s?.notes ?? '',
    } as never);
  }, [open, scheme, form]);
  const save = useMutation({ mutationFn: (body: unknown) => (scheme ? api.put<{ id: number }>(`/insurance/schemes/${scheme.id}`, body) : api.post<{ id: number }>('/insurance/schemes', body)) });
  const submit = form.handleSubmit(async (data) => {
    try {
      const r = await save.mutateAsync(data);
      qc.invalidateQueries({ queryKey: ['insurance-schemes'] });
      qc.invalidateQueries({ queryKey: ['insurance-scheme'] });
      toast.success(scheme ? 'Scheme updated' : 'Scheme added');
      onSaved?.(r.id);
      onClose();
    } catch (e) {
      setError(applyServerErrors(form, e));
    }
  });
  const { errors } = form.formState;
  const r = form.register;
  return (
    <Modal open={open} onClose={onClose} title={scheme ? `Edit ${scheme.name}` : 'Add insurance scheme'} size="lg"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={submit}>Save scheme</Button></>}>
      <form onSubmit={submit} className="grid gap-3.5 sm:grid-cols-2">
        {error && <Alert tone="danger" className="sm:col-span-2">{error}</Alert>}
        <Field label="Scheme name" required error={errors.name?.message}>{(id) => <Input id={id} autoFocus placeholder="e.g. NHIF" {...r('name')} />}</Field>
        <Field label="Short code" required error={errors.code?.message} hint="Used on claim batch references.">{(id) => <Input id={id} className="uppercase" placeholder="NHIF" {...r('code')} />}</Field>
        <Field label="Co-pay" error={errors.copayPercent?.message} hint="The patient's share of each covered item, paid at the till.">
          {(id) => <Input id={id} inputMode="decimal" suffix="%" {...r('copayPercent')} />}
        </Field>
        <Field label="Insurer pays within" error={errors.claimTermsDays?.message} hint="Submitted claims unpaid after this are flagged overdue.">
          {(id) => <Input id={id} inputMode="numeric" suffix="days" {...r('claimTermsDays')} />}
        </Field>
        <Field label="Covers" className="sm:col-span-2">
          {(id) => <Select id={id} {...r('coverage')}>{Object.entries(INSURANCE_COVERAGE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}
        </Field>
        <div className="sm:col-span-2"><Checkbox label="Only pays for medicines on a recorded prescription" {...r('requiresPrescription')} /></div>
        <Field label="Contact person" error={errors.contactName?.message}>{(id) => <Input id={id} {...r('contactName')} />}</Field>
        <Field label="Phone" error={errors.phone?.message}>{(id) => <Input id={id} type="tel" {...r('phone')} />}</Field>
        <Field label="Claims email" error={errors.email?.message}>{(id) => <Input id={id} type="email" {...r('email')} />}</Field>
        <Field label="Status">{(id) => <Select id={id} {...r('status')}><option value="active">Active</option><option value="inactive">Inactive — no new insured sales</option></Select>}</Field>
        <Field label="Address" className="sm:col-span-2" error={errors.address?.message}>{(id) => <Input id={id} {...r('address')} />}</Field>
        <Field label="Notes" className="sm:col-span-2" hint="Submission rules, pre-authorisation requirements…">{(id) => <Textarea id={id} rows={2} {...r('notes')} />}</Field>
      </form>
    </Modal>
  );
}
