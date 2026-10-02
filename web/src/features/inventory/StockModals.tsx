import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ADJUSTMENT_TYPES, batchUpdateSchema, stockAdjustmentSchema } from '@dawa/shared';
import { api } from '@/lib/api';
import { applyServerErrors, useZodForm } from '@/lib/forms';
import { useDebounced } from '@/lib/hooks';
import { useFormat } from '@/lib/settings';
import type { BatchRow, Paginated } from '@/lib/types';
import { Alert, Button, Field, Input, Modal, SearchInput, Select, Textarea, useToast } from '@/components/ui';

export interface BatchLite {
  id: number;
  batchNumber: string;
  expiryDate: string | null;
  manufactureDate?: string | null;
  quantityOnHand: number;
  status: string;
  productName?: string;
}

/** Record an adjustment against one batch. Pass `batches` to choose among a product's batches, or nothing to search. */
export function AdjustStockModal({ open, onClose, batches, initialBatchId, productName }: {
  open: boolean;
  onClose: () => void;
  batches?: BatchLite[];
  initialBatchId?: number | null;
  productName?: string;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const { date } = useFormat();
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const q = useDebounced(search, 250);
  const lookup = useQuery({
    queryKey: ['batch-lookup', q],
    queryFn: () => api.get<Paginated<BatchRow>>('/inventory/batches', { search: q, pageSize: 10, includeEmpty: 'true' }),
    enabled: open && !batches && q.length >= 2,
  });
  const options: BatchLite[] = batches ?? (lookup.data?.data.map((b) => ({ ...b, productName: b.productName })) ?? []);
  const form = useZodForm(stockAdjustmentSchema, { defaultValues: { batchId: initialBatchId ?? undefined, type: 'damaged', quantity: 1, reason: '' } as never });
  useEffect(() => {
    if (open) {
      form.reset({ batchId: initialBatchId ?? (batches?.length === 1 ? batches[0].id : undefined), type: 'damaged', quantity: 1, reason: '' } as never);
      setError(null);
      setSearch('');
    }
  }, [open, initialBatchId, batches, form]);
  const type = form.watch('type');
  const batchId = Number(form.watch('batchId'));
  const qty = Number(form.watch('quantity')) || 0;
  const batch = options.find((b) => b.id === batchId);
  const after = batch ? (type === 'correction' ? qty : type === 'adjustment_in' ? batch.quantityOnHand + qty : batch.quantityOnHand - qty) : null;

  const save = useMutation({ mutationFn: (body: unknown) => api.post<{ adjustmentNo: string }>('/inventory/adjustments', body) });
  const submit = form.handleSubmit(async (data) => {
    try {
      const r = await save.mutateAsync(data);
      ['products', 'product', 'batches', 'adjustments', 'movements', 'expiry-summary', 'dashboard'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast.success(`Adjustment ${r.adjustmentNo} recorded`);
      onClose();
    } catch (e) {
      setError(applyServerErrors(form, e));
    }
  });
  const { errors } = form.formState;
  return (
    <Modal open={open} onClose={onClose} title="Adjust stock" description={productName ?? 'Every adjustment is recorded with your name and reason.'} size="md"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={submit}>Record adjustment</Button></>}>
      <form onSubmit={submit} className="space-y-3.5">
        {error && <Alert tone="danger">{error}</Alert>}
        {!batches && <SearchInput value={search} onChange={setSearch} placeholder="Find product or batch number" autoFocus />}
        <Field label="Batch" required error={errors.batchId?.message}>
          {(id) => (
            <Select id={id} placeholder={options.length ? 'Choose a batch' : batches ? 'No batches' : 'Search above first'} {...form.register('batchId')}>
              {options.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.productName ? `${b.productName} — ` : ''}{b.batchNumber} · exp {b.expiryDate ? date(b.expiryDate) : 'n/a'} · {b.quantityOnHand} on hand
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="Adjustment" required>
            {(id) => <Select id={id} {...form.register('type')}>{Object.entries(ADJUSTMENT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}
          </Field>
          <Field label={type === 'correction' ? 'Counted quantity' : 'Quantity'} required error={errors.quantity?.message}>
            {(id) => <Input id={id} inputMode="numeric" {...form.register('quantity')} />}
          </Field>
        </div>
        {batch && after !== null && (
          <p className="text-[12.5px] text-muted">
            On hand <b className="text-fg num">{batch.quantityOnHand}</b> → <b className={after < 0 ? 'text-danger num' : 'text-fg num'}>{after}</b>
          </p>
        )}
        <Field label="Reason" required error={errors.reason?.message} hint="Be specific — this appears in the audit log.">
          {(id) => <Textarea id={id} rows={2} placeholder="e.g. Bottle cracked during shelf restock" {...form.register('reason')} />}
        </Field>
      </form>
    </Modal>
  );
}

export function EditBatchModal({ open, onClose, batch }: { open: boolean; onClose: () => void; batch: BatchLite | null }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const form = useZodForm(batchUpdateSchema);
  useEffect(() => {
    if (open && batch) {
      form.reset({ expiryDate: batch.expiryDate ?? '', manufactureDate: batch.manufactureDate ?? '', status: batch.status === 'quarantined' ? 'quarantined' : 'active', reason: '' } as never);
      setError(null);
    }
  }, [open, batch, form]);
  const save = useMutation({ mutationFn: (body: unknown) => api.put(`/inventory/batches/${batch?.id}`, body) });
  const submit = form.handleSubmit(async (data) => {
    try {
      await save.mutateAsync(data);
      ['product', 'batches', 'expiry-summary', 'products'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast.success('Batch updated');
      onClose();
    } catch (e) {
      setError(applyServerErrors(form, e));
    }
  });
  const { errors } = form.formState;
  return (
    <Modal open={open} onClose={onClose} title={`Batch ${batch?.batchNumber ?? ''}`} description="Correct batch details or quarantine it to stop sales." size="sm"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={submit}>Save</Button></>}>
      <form onSubmit={submit} className="space-y-3.5">
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="Expiry date" error={errors.expiryDate?.message}>{(id) => <Input id={id} type="date" {...form.register('expiryDate')} />}</Field>
          <Field label="Manufacturing date" error={errors.manufactureDate?.message}>{(id) => <Input id={id} type="date" {...form.register('manufactureDate')} />}</Field>
        </div>
        <Field label="Status" hint="Quarantined batches stay in stock but cannot be sold (e.g. recall, cold-chain breach).">
          {(id) => <Select id={id} {...form.register('status')}><option value="active">Active — available for sale</option><option value="quarantined">Quarantined — blocked from sale</option></Select>}
        </Field>
        <Field label="Reason for change" required error={errors.reason?.message}>{(id) => <Textarea id={id} rows={2} {...form.register('reason')} />}</Field>
      </form>
    </Modal>
  );
}
