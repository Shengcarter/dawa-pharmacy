import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supplierSchema, supplierPaymentSchema, SUPPLIER_PAYMENT_METHODS } from '@dawa/shared';
import { api } from '@/lib/api';
import { applyServerErrors, useZodForm } from '@/lib/forms';
import { useFormat } from '@/lib/settings';
import { Alert, Button, Field, Input, Modal, Select, Textarea, useToast } from '@/components/ui';

export function SupplierFormModal({ open, onClose, supplier, onSaved }: { open: boolean; onClose: () => void; supplier?: Record<string, unknown> | null; onSaved?: (id: number) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { currency } = useFormat();
  const [error, setError] = useState<string | null>(null);
  const form = useZodForm(supplierSchema);
  useEffect(() => {
    if (!open) return;
    setError(null);
    const s = supplier ?? {};
    form.reset({
      name: (s.name as string) ?? '', contactPerson: (s.contactPerson as string) ?? '', phone: (s.phone as string) ?? '', email: (s.email as string) ?? '',
      address: (s.address as string) ?? '', tin: (s.tin as string) ?? '', vrn: (s.vrn as string) ?? '', paymentTermsDays: (s.paymentTermsDays as number) ?? 30,
      creditLimit: (s.creditLimit as number) ?? 0, status: (s.status as 'active') ?? 'active', notes: (s.notes as string) ?? '',
    } as never);
  }, [open, supplier, form]);
  const save = useMutation({ mutationFn: (body: unknown) => (supplier?.id ? api.put<{ id: number }>(`/suppliers/${supplier.id}`, body) : api.post<{ id: number }>('/suppliers', body)) });
  const submit = form.handleSubmit(async (data) => {
    try {
      const r = await save.mutateAsync(data);
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      qc.invalidateQueries({ queryKey: ['supplier'] });
      qc.invalidateQueries({ queryKey: ['supplier-options'] });
      toast.success(supplier ? 'Supplier updated' : 'Supplier added');
      onSaved?.(r.id);
      onClose();
    } catch (e) {
      setError(applyServerErrors(form, e));
    }
  });
  const { errors } = form.formState;
  const r = form.register;
  return (
    <Modal open={open} onClose={onClose} title={supplier ? 'Edit supplier' : 'Add supplier'} size="lg"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={submit}>Save supplier</Button></>}>
      <form onSubmit={submit} className="grid gap-3.5 sm:grid-cols-2">
        {error && <Alert tone="danger" className="sm:col-span-2">{error}</Alert>}
        <Field label="Supplier name" required error={errors.name?.message} className="sm:col-span-2">{(id) => <Input id={id} autoFocus {...r('name')} />}</Field>
        <Field label="Contact person" error={errors.contactPerson?.message}>{(id) => <Input id={id} {...r('contactPerson')} />}</Field>
        <Field label="Phone" required error={errors.phone?.message}>{(id) => <Input id={id} type="tel" placeholder="+255 7xx xxx xxx" {...r('phone')} />}</Field>
        <Field label="Email" error={errors.email?.message}>{(id) => <Input id={id} type="email" {...r('email')} />}</Field>
        <Field label="Address" error={errors.address?.message}>{(id) => <Input id={id} {...r('address')} />}</Field>
        <Field label="TIN" error={errors.tin?.message}>{(id) => <Input id={id} {...r('tin')} />}</Field>
        <Field label="VRN" error={errors.vrn?.message}>{(id) => <Input id={id} {...r('vrn')} />}</Field>
        <Field label="Payment terms (days)" error={errors.paymentTermsDays?.message} hint="Deliveries become overdue after this.">{(id) => <Input id={id} inputMode="numeric" {...r('paymentTermsDays')} />}</Field>
        <Field label="Credit limit" error={errors.creditLimit?.message}>{(id) => <Input id={id} inputMode="decimal" prefix={currency} {...r('creditLimit')} />}</Field>
        <Field label="Status">{(id) => <Select id={id} {...r('status')}><option value="active">Active</option><option value="inactive">Inactive</option></Select>}</Field>
        <Field label="Notes" className="sm:col-span-2">{(id) => <Textarea id={id} rows={2} {...r('notes')} />}</Field>
      </form>
    </Modal>
  );
}

export function SupplierPaymentModal({ open, onClose, supplierId, supplierName, outstanding, receipts }: {
  open: boolean; onClose: () => void; supplierId: number; supplierName: string; outstanding: number;
  receipts: { id: number; grnNumber: string; totalCost: number; paid: number }[];
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const { money, currency, today } = useFormat();
  const [error, setError] = useState<string | null>(null);
  const form = useZodForm(supplierPaymentSchema);
  useEffect(() => {
    if (open) { form.reset({ supplierId, goodsReceiptId: '', amount: outstanding, method: 'bank_transfer', reference: '', paidDate: today(), notes: '' } as never); setError(null); }
  }, [open, supplierId, outstanding, form, today]);
  const save = useMutation({ mutationFn: (body: unknown) => api.post<{ paymentNo: string }>('/suppliers/payments', body) });
  const submit = form.handleSubmit(async (data) => {
    try {
      const r = await save.mutateAsync(data);
      qc.invalidateQueries({ queryKey: ['supplier'] });
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      toast.success(`Payment ${r.paymentNo} recorded`);
      onClose();
    } catch (e) {
      setError(applyServerErrors(form, e));
    }
  });
  const unpaid = receipts.filter((g) => g.totalCost - g.paid > 0.009);
  const { errors } = form.formState;
  return (
    <Modal open={open} onClose={onClose} title="Pay supplier" description={`${supplierName} · outstanding ${money(outstanding)}`} size="sm"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={submit}>Record payment</Button></>}>
      <form onSubmit={submit} className="space-y-3.5">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Against delivery" hint="Optional — leave blank to pay the account generally.">{(id) => (
          <Select id={id} placeholder="Account (oldest first)" {...form.register('goodsReceiptId')}>
            {unpaid.map((g) => <option key={g.id} value={g.id}>{g.grnNumber} · {money(g.totalCost - g.paid)} unpaid</option>)}
          </Select>
        )}</Field>
        <Field label="Amount" required error={errors.amount?.message}>{(id) => <Input id={id} inputMode="decimal" prefix={currency} {...form.register('amount')} />}</Field>
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="Method" required>{(id) => <Select id={id} {...form.register('method')}>{Object.entries(SUPPLIER_PAYMENT_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
          <Field label="Date" required error={errors.paidDate?.message}>{(id) => <Input id={id} type="date" max={today()} {...form.register('paidDate')} />}</Field>
        </div>
        <Field label="Reference" hint="Bank or mobile money transaction reference.">{(id) => <Input id={id} {...form.register('reference')} />}</Field>
      </form>
    </Modal>
  );
}
