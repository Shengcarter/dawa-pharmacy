import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Banknote, BookUser, CreditCard, Landmark, Plus, Smartphone, Trash2, Wallet } from 'lucide-react';
import { fromCents, toCents, type PaymentMethod } from '@dawa/shared';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFormat } from '@/lib/settings';
import { cn } from '@/lib/cn';
import type { CustomerOption } from '@/lib/types';
import { Alert, Button, Field, Input, Modal, Select } from '@/components/ui';
import type { CartLine } from './PosPage';

export interface PaymentResult { id: number; invoiceNo: string }
type Mode = PaymentMethod | 'credit';

const METHODS: { value: Mode; label: string; icon: typeof Banknote }[] = [
  { value: 'cash', label: 'Cash', icon: Banknote },
  { value: 'mobile_money', label: 'Mobile Money', icon: Smartphone },
  { value: 'card', label: 'Card', icon: CreditCard },
  { value: 'bank_transfer', label: 'Bank', icon: Landmark },
  { value: 'store_credit', label: 'Store credit', icon: Wallet },
  { value: 'credit', label: 'On account', icon: BookUser },
];

interface SplitRow { method: PaymentMethod; amount: string; reference: string }

export function PaymentModal({ open, onClose, cart, cartDiscount, totalCents, customer, prescriptionId, onPaid, onError }: {
  open: boolean;
  onClose: () => void;
  cart: CartLine[];
  cartDiscount: number;
  totalCents: number;
  customer: CustomerOption | null;
  prescriptionId: number | null;
  onPaid: (r: PaymentResult) => void;
  onError: (e: unknown) => void;
}) {
  const { can } = useAuth();
  const { money, amount, settings } = useFormat();
  const [mode, setMode] = useState<Mode>('cash');
  const [split, setSplit] = useState(false);
  const [rows, setRows] = useState<SplitRow[]>([]);
  const [tendered, setTendered] = useState('');
  const [reference, setReference] = useState('');
  const [remainderOnCredit, setRemainderOnCredit] = useState(false);
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMode('cash');
    setSplit(false);
    setRows([{ method: 'cash', amount: '', reference: '' }]);
    setTendered('');
    setReference('');
    setRemainderOnCredit(false);
    setError(null);
    setKey(crypto.randomUUID());
  }, [open]);

  const total = fromCents(totalCents);
  const creditAllowed = Boolean(settings?.sales.allowCreditSales && can('pos.credit_sale') && customer && customer.creditLimit > 0);
  const creditAvailable = customer ? Math.max(customer.creditLimit - customer.outstanding, 0) : 0;
  const storeCredit = customer?.storeCreditBalance ?? 0;
  const available = (m: Mode) =>
    m === 'credit' ? creditAllowed : m === 'store_credit' ? storeCredit > 0 : true;

  const payments = useMemo(() => {
    if (split) return rows.filter((r) => Number(r.amount) > 0).map((r) => ({ method: r.method, amount: Number(r.amount), reference: r.reference || null }));
    if (mode === 'credit') return [];
    if (mode === 'store_credit') return [{ method: mode, amount: Math.min(total, storeCredit), reference: null }];
    return [{ method: mode, amount: total, reference: reference || null }];
  }, [split, rows, mode, total, reference, storeCredit]);
  const paidCents = payments.reduce((a, p) => a + toCents(p.amount), 0);
  const remainingCents = totalCents - paidCents;
  const onCredit = split ? remainderOnCredit && remainingCents > 0 : mode === 'credit';
  const cashCents = payments.filter((p) => p.method === 'cash').reduce((a, p) => a + toCents(p.amount), 0);
  const tenderedCents = tendered ? toCents(Number(tendered)) : 0;
  const changeCents = cashCents > 0 && tenderedCents >= cashCents ? tenderedCents - cashCents : null;

  const problem =
    paidCents > totalCents ? 'Payments are more than the total.'
      : remainingCents > 0 && !onCredit ? `Still to pay: ${money(fromCents(remainingCents))}.`
      : onCredit && !creditAllowed ? 'Credit is not available for this customer.'
      : onCredit && fromCents(remainingCents) > creditAvailable ? `Exceeds the customer's available credit (${money(creditAvailable)}).`
      : tendered && cashCents > 0 && tenderedCents < cashCents ? 'Cash tendered is less than the cash amount.'
      : null;

  const submit = useMutation({
    mutationFn: () =>
      api.post<PaymentResult>('/sales', {
        customerId: customer?.id ?? null,
        prescriptionId,
        items: cart.map((l) => ({ productId: l.product.id, quantity: l.quantity, sellBy: l.sellBy, batchId: l.batchId, discount: l.discount })),
        cartDiscount,
        payments,
        cashTendered: cashCents > 0 && tendered ? Number(tendered) : null,
        onCredit,
        idempotencyKey: key,
      }),
    onSuccess: onPaid,
    onError: (e) => {
      setError(e instanceof ApiError ? e.message : 'The sale could not be completed.');
      onError(e);
    },
  });

  const quickCash = useMemo(() => {
    const round = (step: number) => Math.ceil(total / step) * step;
    return [...new Set([total, round(1000), round(5000), round(10000)])].filter((v) => v >= total).slice(0, 4);
  }, [total]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Take payment"
      description={customer ? `Customer: ${customer.fullName}` : 'Walk-in customer'}
      size="md"
      footer={
        <>
          <Button onClick={onClose}>Back to cart</Button>
          <Button variant="primary" size="lg" loading={submit.isPending} disabled={Boolean(problem)} onClick={() => submit.mutate()} data-primary>
            Complete sale
          </Button>
        </>
      }
    >
      <div className="mb-4 flex items-baseline justify-between rounded-lg border border-line bg-subtle px-4 py-3">
        <span className="text-[13px] text-muted">Amount due</span>
        <span className="text-[26px] font-semibold tracking-[-0.02em] num">{money(total)}</span>
      </div>

      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}

      {!split ? (
        <>
          <div className="grid grid-cols-3 gap-2">
            {METHODS.map((m) => {
              const ok = available(m.value);
              const Icon = m.icon;
              return (
                <button
                  key={m.value}
                  type="button"
                  disabled={!ok}
                  onClick={() => setMode(m.value)}
                  className={cn(
                    'flex h-16 flex-col items-center justify-center gap-1 rounded-md border text-[12.5px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                    mode === m.value ? 'border-brand-600 bg-brand-50 text-brand-700 ring-1 ring-brand-600' : 'border-line-strong hover:bg-hover',
                  )}
                  title={!ok ? (m.value === 'credit' ? 'Select a customer with a credit limit' : 'Customer has no store credit') : undefined}
                >
                  <Icon className="size-4" />
                  {m.label}
                </button>
              );
            })}
          </div>

          <div className="mt-4 space-y-3">
            {mode === 'cash' && (
              <>
                <Field label="Cash received" hint="Optional — enter it to show the change to give.">
                  {(id) => <Input id={id} inputMode="decimal" autoFocus value={tendered} onChange={(e) => setTendered(e.target.value.replace(/[^\d.]/g, ''))} prefix={settings?.general.currency} className="text-[15px]" />}
                </Field>
                <div className="flex flex-wrap gap-1.5">
                  {quickCash.map((v) => (
                    <Button key={v} size="sm" onClick={() => setTendered(String(v))}>{amount(v)}</Button>
                  ))}
                </div>
                {changeCents !== null && (
                  <div className="flex items-baseline justify-between rounded-md bg-brand-50 px-3 py-2 text-brand-800">
                    <span className="text-[13px] font-medium">Change to give</span>
                    <span className="text-[18px] font-semibold num">{money(fromCents(changeCents))}</span>
                  </div>
                )}
              </>
            )}
            {(mode === 'mobile_money' || mode === 'card' || mode === 'bank_transfer') && (
              <Field label={mode === 'mobile_money' ? 'Transaction ID' : 'Reference'} hint="Recorded on the payment for reconciliation.">
                {(id) => <Input id={id} autoFocus value={reference} onChange={(e) => setReference(e.target.value)} placeholder={mode === 'mobile_money' ? 'e.g. QJ72K1X9PT' : ''} />}
              </Field>
            )}
            {mode === 'store_credit' && (
              <Alert tone="info">
                {money(Math.min(total, storeCredit))} will be taken from store credit ({money(storeCredit)} available).
                {storeCredit < total && ' Use split payment to pay the rest another way.'}
              </Alert>
            )}
            {mode === 'credit' && customer && (
              <Alert tone={total > creditAvailable ? 'danger' : 'warning'} title="Sale on account">
                {money(total)} will be added to {customer.fullName}'s balance. Available credit: {money(creditAvailable)}.
              </Alert>
            )}
          </div>
          <button type="button" className="mt-4 text-[12.5px] font-medium text-brand-700 hover:underline" onClick={() => { setSplit(true); setRows([{ method: 'cash', amount: String(total), reference: '' }]); }}>
            Split between payment methods
          </button>
        </>
      ) : (
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <Select value={r.method} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, method: e.target.value as PaymentMethod } : x)))} className="w-40" aria-label="Method">
                {METHODS.filter((m) => m.value !== 'credit' && available(m.value)).map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </Select>
              <Input inputMode="decimal" aria-label="Amount" value={r.amount} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, amount: e.target.value.replace(/[^\d.]/g, '') } : x)))} className="w-32 text-right" />
              <Input aria-label="Reference" placeholder="Reference" value={r.reference} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, reference: e.target.value } : x)))} className="flex-1" />
              <button aria-label="Remove payment" className="rounded p-1.5 text-faint hover:bg-hover hover:text-fg" onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 className="size-3.5" /></button>
            </div>
          ))}
          <div className="flex items-center justify-between pt-1">
            <Button size="sm" icon={<Plus className="size-3.5" />} disabled={rows.length >= 4} onClick={() => setRows([...rows, { method: 'mobile_money', amount: remainingCents > 0 ? String(fromCents(remainingCents)) : '', reference: '' }])}>
              Add payment
            </Button>
            <span className={cn('text-[12.5px] num', remainingCents === 0 ? 'text-brand-700' : 'text-warning')}>
              {remainingCents === 0 ? 'Fully allocated' : remainingCents > 0 ? `${money(fromCents(remainingCents))} remaining` : `${money(fromCents(-remainingCents))} over`}
            </span>
          </div>
          {cashCents > 0 && (
            <Field label="Cash received (optional)" className="pt-2">
              {(id) => <Input id={id} inputMode="decimal" value={tendered} onChange={(e) => setTendered(e.target.value.replace(/[^\d.]/g, ''))} className="w-40" />}
            </Field>
          )}
          {changeCents !== null && changeCents > 0 && <p className="text-[13px] font-medium text-brand-700">Change: {money(fromCents(changeCents))}</p>}
          {creditAllowed && remainingCents > 0 && (
            <label className="flex items-center gap-2 pt-1 text-[13px]">
              <input type="checkbox" checked={remainderOnCredit} onChange={(e) => setRemainderOnCredit(e.target.checked)} className="accent-[var(--brand-600)]" />
              Put the remaining {money(fromCents(remainingCents))} on {customer?.fullName}'s account
            </label>
          )}
          <button type="button" className="pt-2 text-[12.5px] font-medium text-brand-700 hover:underline" onClick={() => setSplit(false)}>Use a single payment method</button>
        </div>
      )}
      {problem && !error && (split || mode !== 'cash') && <p className="mt-3 text-[12.5px] text-warning">{problem}</p>}
    </Modal>
  );
}
