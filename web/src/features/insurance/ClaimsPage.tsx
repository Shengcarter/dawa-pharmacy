import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileCheck2, Send } from 'lucide-react';
import { CLAIM_PAYMENT_METHODS, CLAIM_SHORTFALL_OUTCOMES, CLAIM_STATUSES, claimPaymentSchema, closeClaimSchema } from '@dawa/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { applyServerErrors, useZodForm } from '@/lib/forms';
import { useListState } from '@/lib/hooks';
import { useFormat } from '@/lib/settings';
import { Page } from '@/components/layout/AppLayout';
import {
  Alert, Button, Card, DataTable, DetailList, EmptyState, Field, Figure, Input, Modal, PageHeader, Pagination, SearchInput, Select, SummaryStrip, Textarea, Toolbar, useToast,
} from '@/components/ui';
import { ClaimStatusBadge } from '@/components/StatusBadges';
import { useSchemes } from './SchemesPage';

interface ClaimRow {
  id: number; claimNo: string; status: string; amount: number; amountPaid: number; writtenOff: number; billedToPatient: number; outstanding: number;
  memberNo: string; submissionRef: string | null; submittedAt: string | null; createdAt: string; overdue: boolean;
  schemeId: number; schemeName: string; schemeCode: string; saleId: number; invoiceNo: string; customerId: number; customerName: string;
}
interface ClaimDetail extends ClaimRow {
  saleTotal: number; saleDate: string; customerCode: string; submittedByName: string | null; rxNumber: string | null; prescriberName: string | null;
  claimTermsDays: number; closedAt: string | null; closeReason: string | null;
  items: { productName: string; strength: string | null; unit: string; quantity: number; quantityReturned: number; unitPrice: number; unitsPerSaleUnit: number; lineTotal: number; insuranceAmount: number }[];
  payments: { id: number; amount: number; paidOn: string; method: string; reference: string | null; recordedByName: string }[];
}
interface Summary { pendingAmount: number; pendingCount: number; submittedAmount: number; submittedCount: number; overdueAmount: number; overdueCount: number; paidThisMonth: number }

export function ClaimsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const { money, amount, date, currency } = useFormat();
  const schemes = useSchemes(true);
  const [s, set] = useListState({ search: '', status: 'open', schemeId: '' });
  const [selected, setSelected] = useState<Set<number | string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [openClaim, setOpenClaim] = useState<number | null>(null);
  const query = { search: s.search, status: s.status, schemeId: s.schemeId, page: s.page, pageSize: s.pageSize };
  const claims = useQuery({
    queryKey: ['claims', query],
    queryFn: () => api.get<{ data: ClaimRow[]; total: number; page: number; pageSize: number }>('/insurance/claims', query),
    placeholderData: (p) => p,
  });
  const summary = useQuery({ queryKey: ['claims-summary'], queryFn: () => api.get<Summary>('/insurance/claims/summary') });
  useEffect(() => setSelected(new Set()), [s.status, s.schemeId, s.search, s.page]);

  const rows = claims.data?.data ?? [];
  const chosen = rows.filter((r) => selected.has(r.id));
  const canSubmit = chosen.length > 0 && chosen.every((r) => r.status === 'pending') && new Set(chosen.map((r) => r.schemeId)).size === 1;
  const sum = summary.data;

  return (
    <Page>
      <PageHeader title="Insurance claims" description="The insurer's share of insured sales: submit them in batches, record what each insurer pays, and settle any shortfall."
        actions={can('insurance.claims') && (
          <Button variant="primary" icon={<Send className="size-3.5" />} disabled={!canSubmit} onClick={() => setSubmitting(true)}
            title={chosen.length && !canSubmit ? 'Select claims not yet submitted, all for one scheme' : undefined}>
            Submit {chosen.length ? `${chosen.length} claim${chosen.length === 1 ? '' : 's'}` : 'claims'}
          </Button>
        )} />
      <SummaryStrip>
        <Figure label="Not yet submitted" value={money(Number(sum?.pendingAmount ?? 0))} sub={`${sum?.pendingCount ?? 0} claims`} />
        <Figure label="Awaiting payment" value={money(Number(sum?.submittedAmount ?? 0))} sub={`${sum?.submittedCount ?? 0} claims`} />
        <Figure label="Overdue" value={money(Number(sum?.overdueAmount ?? 0))} sub={`${sum?.overdueCount ?? 0} past the scheme's terms`} tone={Number(sum?.overdueCount) > 0 ? 'danger' : undefined} />
        <Figure label="Received this month" value={money(Number(sum?.paidThisMonth ?? 0))} />
      </SummaryStrip>
      <Card flush>
        <Toolbar>
          <SearchInput value={s.search} onChange={(v) => set({ search: v })} placeholder="Claim, invoice, patient or member no." className="w-full sm:w-72" />
          <Select aria-label="Scheme" value={s.schemeId} onChange={(e) => set({ schemeId: e.target.value })} className="w-44">
            <option value="">All schemes</option>
            {schemes.data?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select>
          <Select aria-label="Status" value={s.status} onChange={(e) => set({ status: e.target.value })} className="w-48">
            <option value="open">Open (unpaid)</option>
            <option value="overdue">Overdue</option>
            {Object.entries(CLAIM_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            <option value="">All claims</option>
          </Select>
        </Toolbar>
        <DataTable
          rows={claims.data?.data} loading={claims.isLoading} error={claims.error} onRetry={claims.refetch} rowKey={(r) => r.id}
          selectable={can('insurance.claims')} selected={selected} onSelectedChange={setSelected}
          onRowClick={(r) => setOpenClaim(r.id)}
          empty={<EmptyState icon={FileCheck2} title="No claims here" description="Claims are created automatically when a sale is billed to an insurance scheme." />}
          columns={[
            { key: 'claim', header: 'Claim', cell: (r) => <div><p className="font-medium">{r.claimNo}</p><p className="text-[12px] text-muted">{date(r.createdAt)}</p></div> },
            { key: 'patient', header: 'Patient', cell: (r) => <div><p>{r.customerName}</p><p className="text-[12px] text-muted">{r.schemeCode} · {r.memberNo}</p></div> },
            { key: 'invoice', header: 'Invoice', cell: (r) => <Link to={`/sales/${r.saleId}`} onClick={(e) => e.stopPropagation()} className="text-brand-700 hover:underline">{r.invoiceNo}</Link>, hideBelow: 'md' },
            { key: 'batch', header: 'Submitted', cell: (r) => (r.submittedAt ? <div><p>{date(r.submittedAt)}</p>{r.submissionRef && <p className="text-[12px] text-muted">{r.submissionRef}</p>}</div> : '—'), hideBelow: 'lg' },
            { key: 'amount', header: `Claimed (${currency})`, align: 'right', cell: (r) => <span className="num">{amount(Number(r.amount))}</span> },
            { key: 'outstanding', header: 'Outstanding', align: 'right', cell: (r) => <span className={Number(r.outstanding) > 0 ? 'font-medium num' : 'text-muted num'}>{amount(Number(r.outstanding))}</span>, hideBelow: 'sm' },
            { key: 'status', header: 'Status', cell: (r) => <ClaimStatusBadge status={r.status} overdue={r.overdue} /> },
          ]}
        />
        {claims.data && <Pagination page={claims.data.page} pageSize={claims.data.pageSize} total={claims.data.total} onChange={(page) => set({ page }, false)} />}
      </Card>
      <SubmitClaimsModal open={submitting} onClose={() => setSubmitting(false)} claims={chosen}
        onDone={() => { setSelected(new Set()); qc.invalidateQueries({ queryKey: ['claims'] }); qc.invalidateQueries({ queryKey: ['claims-summary'] }); toast.success('Claims submitted'); }} />
      <ClaimModal id={openClaim} onClose={() => setOpenClaim(null)} />
    </Page>
  );
}

function SubmitClaimsModal({ open, onClose, claims, onDone }: { open: boolean; onClose: () => void; claims: ClaimRow[]; onDone: () => void }) {
  const { money } = useFormat();
  const [ref, setRef] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setError(null); setRef(''); } }, [open]);
  const submit = useMutation({
    mutationFn: () => api.post('/insurance/claims/submit', { claimIds: claims.map((c) => c.id), submissionRef: ref }),
    onSuccess: () => { onDone(); onClose(); },
    onError: (e) => setError((e as Error).message),
  });
  const total = claims.reduce((a, c) => a + Number(c.amount), 0);
  return (
    <Modal open={open} onClose={onClose} size="sm" title={`Submit ${claims.length} claim${claims.length === 1 ? '' : 's'} to ${claims[0]?.schemeName ?? ''}`}
      description={`Total claimed: ${money(total)}`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={submit.isPending} onClick={() => submit.mutate()}>Mark as submitted</Button></>}>
      <div className="space-y-3.5">
        {error && <Alert tone="danger">{error}</Alert>}
        <p className="text-[13px] text-muted">Send the claims to the insurer the way they require (their portal, email or paper forms), then record the batch here so payments can be matched.</p>
        <Field label="Batch or submission reference" hint="Optional, e.g. the insurer's batch number.">{(id) => <Input id={id} value={ref} onChange={(e) => setRef(e.target.value)} />}</Field>
      </div>
    </Modal>
  );
}

function ClaimModal({ id, onClose }: { id: number | null; onClose: () => void }) {
  const { can } = useAuth();
  const { money, date, dateTime } = useFormat();
  const [mode, setMode] = useState<'view' | 'pay' | 'close'>('view');
  useEffect(() => setMode('view'), [id]);
  const claim = useQuery({ queryKey: ['claim', id], queryFn: () => api.get<ClaimDetail>(`/insurance/claims/${id}`), enabled: id !== null });
  const c = claim.data;
  const open = c && ['submitted', 'partially_paid'].includes(c.status);
  const closable = c && ['pending', 'submitted', 'partially_paid'].includes(c.status) && Number(c.outstanding) > 0;
  return (
    <Modal open={id !== null} onClose={onClose} size="lg" title={c ? `Claim ${c.claimNo}` : 'Claim'}
      description={c ? `${c.schemeName} · ${c.customerName} (${c.memberNo})` : undefined}
      footer={c && can('insurance.claims') && mode === 'view' ? (
        <>
          {closable && <Button onClick={() => setMode('close')}>{Number(c.amountPaid) > 0 ? 'Settle shortfall' : 'Rejected…'}</Button>}
          {open && <Button variant="primary" onClick={() => setMode('pay')}>Record payment</Button>}
          {!open && !closable && <Button onClick={onClose}>Close</Button>}
        </>
      ) : mode === 'view' ? <Button onClick={onClose}>Close</Button> : undefined}>
      {!c ? <p className="py-8 text-center text-muted">Loading…</p> : mode === 'pay' ? (
        <ClaimPaymentForm claim={c} onDone={() => setMode('view')} />
      ) : mode === 'close' ? (
        <CloseClaimForm claim={c} onDone={() => setMode('view')} />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2"><ClaimStatusBadge status={c.status} overdue={c.overdue} />
            {c.status === 'pending' && <span className="text-[12.5px] text-muted">Not yet sent to the insurer.</span>}
          </div>
          <DetailList items={[
            { label: 'Claimed', value: money(Number(c.amount)) },
            { label: 'Paid by insurer', value: money(Number(c.amountPaid)) },
            { label: 'Outstanding', value: <span className="font-medium">{money(Number(c.outstanding))}</span> },
            { label: 'Written off', value: Number(c.writtenOff) > 0 ? money(Number(c.writtenOff)) : null },
            { label: 'Billed to patient', value: Number(c.billedToPatient) > 0 ? money(Number(c.billedToPatient)) : null },
            { label: 'Invoice', value: <Link className="text-brand-700 hover:underline" to={`/sales/${c.saleId}`}>{c.invoiceNo}</Link> },
            { label: 'Sale date', value: dateTime(c.saleDate) },
            { label: 'Prescription', value: c.rxNumber ? `${c.rxNumber}${c.prescriberName ? ` · ${c.prescriberName}` : ''}` : null },
            { label: 'Submitted', value: c.submittedAt ? `${date(c.submittedAt)}${c.submittedByName ? ` by ${c.submittedByName}` : ''}${c.submissionRef ? ` · ${c.submissionRef}` : ''}` : null },
            { label: 'Closed', value: c.closedAt ? `${date(c.closedAt)}${c.closeReason ? ` — ${c.closeReason}` : ''}` : null },
          ]} />
          <div>
            <p className="mb-1.5 text-[12px] font-medium uppercase tracking-wide text-muted">Items claimed</p>
            <table className="w-full text-[13px]">
              <tbody>
                {c.items.map((i, n) => (
                  <tr key={n} className="border-t border-line">
                    <td className="py-1.5">{i.productName}{i.quantityReturned > 0 && <span className="ml-1 text-[12px] text-warning">({i.quantityReturned} returned)</span>}</td>
                    <td className="py-1.5 text-right text-muted num">{i.quantity} × {money(Number(i.unitPrice) / i.unitsPerSaleUnit)}</td>
                    <td className="py-1.5 text-right font-medium num">{money(Number(i.insuranceAmount))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {c.payments.length > 0 && (
            <div>
              <p className="mb-1.5 text-[12px] font-medium uppercase tracking-wide text-muted">Payments received</p>
              {c.payments.map((p) => (
                <p key={p.id} className="flex justify-between border-t border-line py-1.5 text-[13px]">
                  <span>{date(p.paidOn)} · {CLAIM_PAYMENT_METHODS[p.method as keyof typeof CLAIM_PAYMENT_METHODS] ?? p.method}{p.reference ? ` · ${p.reference}` : ''} <span className="text-muted">({p.recordedByName})</span></span>
                  <span className="font-medium num">{money(Number(p.amount))}</span>
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function useClaimRefresh() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['claim'] });
    qc.invalidateQueries({ queryKey: ['claims'] });
    qc.invalidateQueries({ queryKey: ['claims-summary'] });
    qc.invalidateQueries({ queryKey: ['sale'] });
  };
}

function ClaimPaymentForm({ claim, onDone }: { claim: ClaimDetail; onDone: () => void }) {
  const toast = useToast();
  const refresh = useClaimRefresh();
  const { money, currency, today } = useFormat();
  const [error, setError] = useState<string | null>(null);
  const form = useZodForm(claimPaymentSchema, { defaultValues: { amount: Number(claim.outstanding), paidOn: today(), method: 'bank_transfer', reference: '' } as never });
  const save = useMutation({ mutationFn: (body: unknown) => api.post<{ status: string }>(`/insurance/claims/${claim.id}/payments`, body) });
  const submit = form.handleSubmit(async (d) => {
    try {
      const r = await save.mutateAsync(d);
      refresh();
      toast.success(r.status === 'paid' ? 'Claim paid in full' : 'Part payment recorded');
      onDone();
    } catch (e) { setError(applyServerErrors(form, e)); }
  });
  const { errors } = form.formState;
  return (
    <form onSubmit={submit} className="space-y-3.5">
      {error && <Alert tone="danger">{error}</Alert>}
      <p className="text-[13px] text-muted">Outstanding on this claim: <b>{money(Number(claim.outstanding))}</b>. If the insurer paid less, record what arrived, then settle the shortfall.</p>
      <div className="grid gap-3.5 sm:grid-cols-2">
        <Field label="Amount received" required error={errors.amount?.message}>{(id) => <Input id={id} inputMode="decimal" prefix={currency} autoFocus {...form.register('amount')} />}</Field>
        <Field label="Date received" required error={errors.paidOn?.message}>{(id) => <Input id={id} type="date" max={today()} {...form.register('paidOn')} />}</Field>
        <Field label="Method">{(id) => <Select id={id} {...form.register('method')}>{Object.entries(CLAIM_PAYMENT_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
        <Field label="Remittance reference">{(id) => <Input id={id} {...form.register('reference')} />}</Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" onClick={onDone}>Back</Button>
        <Button type="submit" variant="primary" loading={save.isPending}>Record payment</Button>
      </div>
    </form>
  );
}

function CloseClaimForm({ claim, onDone }: { claim: ClaimDetail; onDone: () => void }) {
  const toast = useToast();
  const refresh = useClaimRefresh();
  const { money } = useFormat();
  const [error, setError] = useState<string | null>(null);
  const form = useZodForm(closeClaimSchema, { defaultValues: { outcome: 'write_off', reason: '' } as never });
  const save = useMutation({ mutationFn: (body: unknown) => api.post(`/insurance/claims/${claim.id}/close`, body) });
  const submit = form.handleSubmit(async (d) => {
    try {
      await save.mutateAsync(d);
      refresh();
      toast.success('Claim closed');
      onDone();
    } catch (e) { setError(applyServerErrors(form, e)); }
  });
  const { errors } = form.formState;
  return (
    <form onSubmit={submit} className="space-y-3.5">
      {error && <Alert tone="danger">{error}</Alert>}
      <Alert tone="warning" title={`${money(Number(claim.outstanding))} will not be paid by ${claim.schemeName}`}>
        Close the claim and decide what happens to the unpaid amount. This cannot be undone.
      </Alert>
      <Field label="What happens to the unpaid amount">
        {(id) => <Select id={id} {...form.register('outcome')}>{Object.entries(CLAIM_SHORTFALL_OUTCOMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}
      </Field>
      <Field label="Reason" required error={errors.reason?.message} hint="e.g. the insurer's rejection reason or remittance note.">{(id) => <Textarea id={id} rows={2} {...form.register('reason')} />}</Field>
      <div className="flex justify-end gap-2">
        <Button type="button" onClick={onDone}>Back</Button>
        <Button type="submit" variant="danger" loading={save.isPending}>Close claim</Button>
      </div>
    </form>
  );
}
