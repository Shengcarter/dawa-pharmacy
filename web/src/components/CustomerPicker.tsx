import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { UserPlus, UserRound, X } from 'lucide-react';
import { customerSchema } from '@dawa/shared';
import { api } from '@/lib/api';
import { useDebounced } from '@/lib/hooks';
import { useFormat } from '@/lib/settings';
import { applyServerErrors, useZodForm } from '@/lib/forms';
import { useAuth } from '@/lib/auth';
import type { CustomerOption } from '@/lib/types';
import { cn } from '@/lib/cn';
import { Alert, Button, Field, Input, Modal } from './ui';

/** Search-as-you-type customer selector with quick registration. */
export function CustomerPicker({ value, onChange, placeholder = 'Walk-in customer — search name or phone', autoFocus }: {
  value: CustomerOption | null;
  onChange: (c: CustomerOption | null) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const { can } = useAuth();
  const { money } = useFormat();
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const q = useDebounced(term.trim(), 200);
  const { data } = useQuery({
    queryKey: ['customer-lookup', q],
    queryFn: () => api.get<CustomerOption[]>('/customers/lookup', { q }),
    enabled: q.length >= 2,
  });
  useEffect(() => {
    const onDoc = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  if (value) {
    return (
      <div className="flex items-center gap-2.5 rounded-md border border-line bg-subtle px-2.5 py-1.5">
        <UserRound className="size-4 text-muted" />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[13px] font-medium">{value.fullName}</p>
          <p className="truncate text-[11.5px] text-muted">
            {[value.code, value.phone].filter(Boolean).join(' · ')}
            {value.outstanding > 0 && <span className="text-warning"> · owes {money(value.outstanding)}</span>}
            {value.storeCreditBalance > 0 && <span className="text-brand-700"> · credit {money(value.storeCreditBalance)}</span>}
          </p>
        </div>
        <button aria-label="Remove customer" onClick={() => onChange(null)} className="rounded p-1 text-faint hover:bg-hover hover:text-fg">
          <X className="size-3.5" />
        </button>
      </div>
    );
  }
  return (
    <div ref={box} className="relative">
      <div className="flex gap-1.5">
        <Input
          value={term}
          autoFocus={autoFocus}
          onChange={(e) => { setTerm(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          aria-label="Customer"
        />
        {can('customers.manage') && (
          <Button aria-label="New customer" title="Register a new customer" onClick={() => setCreating(true)} className="shrink-0 px-2.5">
            <UserPlus className="size-3.5" />
          </Button>
        )}
      </div>
      {open && q.length >= 2 && (
        <div className="animate-pop absolute left-0 right-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-pop">
          {data?.length ? (
            data.map((c) => (
              <button key={c.id} className="flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-left hover:bg-hover" onClick={() => { onChange(c); setTerm(''); setOpen(false); }}>
                <span className="min-w-0">
                  <span className="block truncate text-[13px]">{c.fullName}</span>
                  <span className="block text-[11.5px] text-muted">{[c.code, c.phone].filter(Boolean).join(' · ')}</span>
                </span>
                {c.outstanding > 0 && <span className="shrink-0 text-[11.5px] text-warning num">owes {money(c.outstanding)}</span>}
              </button>
            ))
          ) : (
            <p className="px-2.5 py-2 text-[12.5px] text-muted">No match.{can('customers.manage') && <button className="ml-1 font-medium text-brand-700 hover:underline" onClick={() => setCreating(true)}>Register “{term}”</button>}</p>
          )}
        </div>
      )}
      <QuickCustomerModal open={creating} initialName={term} onClose={() => setCreating(false)} onCreated={(c) => { onChange(c); setTerm(''); setCreating(false); }} />
    </div>
  );
}

function QuickCustomerModal({ open, initialName, onClose, onCreated }: { open: boolean; initialName: string; onClose: () => void; onCreated: (c: CustomerOption) => void }) {
  const form = useZodForm(customerSchema, { defaultValues: { fullName: '', phone: '', customerType: 'regular' } });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      form.reset({ fullName: /\d{6,}/.test(initialName) ? '' : initialName, phone: /\d{6,}/.test(initialName) ? initialName : '', customerType: 'regular' });
      setError(null);
    }
  }, [open, initialName, form]);
  const create = useMutation({ mutationFn: (body: unknown) => api.post<CustomerOption>('/customers', body) });
  const submit = form.handleSubmit(async (data) => {
    try {
      onCreated(await create.mutateAsync(data));
    } catch (e) {
      setError(applyServerErrors(form, e));
    }
  });
  const { errors } = form.formState;
  return (
    <Modal open={open} onClose={onClose} title="Register customer" size="sm" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={create.isPending} onClick={submit}>Save customer</Button></>}>
      <form onSubmit={submit} className="space-y-3.5">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Full name" required error={errors.fullName?.message}>{(id) => <Input id={id} autoFocus {...form.register('fullName')} />}</Field>
        <Field label="Phone" error={errors.phone?.message} hint="Used to find the customer next time.">{(id) => <Input id={id} type="tel" placeholder="+255 7xx xxx xxx" {...form.register('phone')} />}</Field>
        <p className={cn('text-[12px] text-muted')}>Only name and phone are needed at the till. Add more details later from Customers.</p>
      </form>
    </Modal>
  );
}
