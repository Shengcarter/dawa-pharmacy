import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CUSTOMER_TYPES, GENDERS, customerSchema } from '@dawa/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { applyServerErrors, useZodForm } from '@/lib/forms';
import { useFormat } from '@/lib/settings';
import { Alert, Button, Field, Input, Modal, Select, Textarea, useToast } from '@/components/ui';

export function CustomerFormModal({ open, onClose, customer, onSaved }: { open: boolean; onClose: () => void; customer?: Record<string, unknown> | null; onSaved?: (id: number) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const { currency } = useFormat();
  const [error, setError] = useState<string | null>(null);
  const form = useZodForm(customerSchema);
  useEffect(() => {
    if (!open) return;
    setError(null);
    const c = customer ?? {};
    const v = (k: string) => (c[k] as string) ?? '';
    form.reset({
      fullName: v('fullName'), phone: v('phone'), email: v('email'), address: v('address'), dateOfBirth: v('dateOfBirth'), gender: v('gender') || null,
      customerType: (c.customerType as 'regular') ?? 'regular', insuranceProvider: v('insuranceProvider'), insuranceMemberNo: v('insuranceMemberNo'),
      creditLimit: (c.creditLimit as number) ?? 0, notes: v('notes'), status: (c.status as 'active') ?? 'active',
    } as never);
  }, [open, customer, form]);
  const save = useMutation({ mutationFn: (body: unknown) => (customer?.id ? api.put<{ id: number }>(`/customers/${customer.id}`, body) : api.post<{ id: number }>('/customers', body)) });
  const submit = form.handleSubmit(async (data) => {
    try {
      const r = await save.mutateAsync(data);
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['customer'] });
      toast.success(customer ? 'Customer updated' : 'Customer registered');
      onSaved?.(r.id);
      onClose();
    } catch (e) {
      setError(applyServerErrors(form, e));
    }
  });
  const { errors } = form.formState;
  const r = form.register;
  const canCredit = can('sales.record_payment', 'users.manage');
  return (
    <Modal open={open} onClose={onClose} title={customer ? 'Edit customer' : 'Register customer'} size="lg"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={submit}>Save</Button></>}>
      <form onSubmit={submit} className="grid gap-3.5 sm:grid-cols-2">
        {error && <Alert tone="danger" className="sm:col-span-2">{error}</Alert>}
        <Field label="Full name" required error={errors.fullName?.message} className="sm:col-span-2">{(id) => <Input id={id} autoFocus {...r('fullName')} />}</Field>
        <Field label="Phone" error={errors.phone?.message}>{(id) => <Input id={id} type="tel" placeholder="+255 7xx xxx xxx" {...r('phone')} />}</Field>
        <Field label="Email" error={errors.email?.message}>{(id) => <Input id={id} type="email" {...r('email')} />}</Field>
        <Field label="Customer type">{(id) => <Select id={id} {...r('customerType')}>{Object.entries(CUSTOMER_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
        <Field label="Address">{(id) => <Input id={id} {...r('address')} />}</Field>
        <Field label="Date of birth" hint="Optional — helps confirm identity for prescriptions." error={errors.dateOfBirth?.message}>{(id) => <Input id={id} type="date" {...r('dateOfBirth')} />}</Field>
        <Field label="Gender" hint="Optional.">{(id) => <Select id={id} placeholder="Not recorded" {...r('gender')}>{Object.entries(GENDERS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
        <Field label="Insurance provider">{(id) => <Input id={id} {...r('insuranceProvider')} />}</Field>
        <Field label="Member number">{(id) => <Input id={id} {...r('insuranceMemberNo')} />}</Field>
        <Field label="Credit limit" error={errors.creditLimit?.message} hint={canCredit ? 'Zero means no credit sales.' : 'Only finance staff can change this.'}>{(id) => <Input id={id} inputMode="decimal" prefix={currency} disabled={!canCredit} {...r('creditLimit')} />}</Field>
        <Field label="Status">{(id) => <Select id={id} {...r('status')}><option value="active">Active</option><option value="inactive">Inactive</option></Select>}</Field>
        <Field label="Notes" className="sm:col-span-2" hint="Avoid recording medical details here.">{(id) => <Textarea id={id} rows={2} {...r('notes')} />}</Field>
      </form>
    </Modal>
  );
}
