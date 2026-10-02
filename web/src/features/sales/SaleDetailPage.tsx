import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, Printer, Undo2 } from 'lucide-react';
import { PAYMENT_METHODS, REFUND_METHODS, RETURN_CONDITIONS, RETURN_REASONS, SALE_PAYMENT_TYPES, recordSalePaymentSchema } from '@dawa/shared';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFormat } from '@/lib/settings';
import { applyServerErrors, useZodForm } from '@/lib/forms';
import { Page } from '@/components/layout/AppLayout';
import { Alert, Badge, Button, Card, DetailList, ErrorState, Field, Input, Modal, PageHeader, PageLoader, Select, Textarea, useToast } from '@/components/ui';
import { PaymentStatusBadge, SaleStatusBadge } from '@/components/StatusBadges';
import { ReceiptModal } from './ReceiptModal';

interface SaleItem {
  id: number; productId: number; batchId: number; quantity: number; quantityReturned: number; unitPrice: number; discountAmount: number;
  taxRate: number; netAmount: number; taxAmount: number; lineTotal: number; unitCost?: number; productName: string; sku: string; unitsPerSaleUnit: number;
  unit: string; batchNumber: string; expiryDate: string | null;
}
export interface SaleDetail {
  id: number; invoiceNo: string; createdAt: string; status: string; paymentType: string; paymentStatus: string; subtotal: number;
  discountTotal: number; taxTotal: number; total: number; amountPaid: number; balanceDue: number; costTotal?: number; taxInclusive: boolean;
  cashTendered: number | null; changeGiven: number | null; notes: string | null; customerId: number | null; customerName: string | null;
  customerPhone: string | null; customerCode: string | null; cashierName: string; rxNumber: string | null; prescriptionId: number | null;
  items: SaleItem[];
  payments: { id: number; paymentNo: string; method: string; amount: number; reference: string | null; receivedAt: string; receivedByName: string }[];
  returns: { id: number; returnNo: string; reason: string; refundMethod: string; totalAmount: number; refundAmount: number; balanceReduction: number; createdAt: string; processedByName: string }[];
}

export function SaleDetailPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const { can } = useAuth();
  const { money, amount, dateTime, date, currency } = useFormat();
  const [receipt, setReceipt] = useState(false);
  const [paying, setPaying] = useState(false);
  const [returning, setReturning] = useState(params.get('return') === '1');
  const { data: sale, isLoading, error, refetch } = useQuery({ queryKey: ['sale', id], queryFn: () => api.get<SaleDetail>(`/sales/${id}`) });

  if (isLoading) return <PageLoader />;
  if (error || !sale) return <Page><ErrorState error={error} onRetry={refetch} /></Page>;

  const returnable = sale.items.some((i) => i.quantityReturned < i.quantity);
  const showCost = sale.costTotal !== undefined;
  return (
    <Page>
      <PageHeader
        breadcrumbs={[{ label: 'Invoices', to: '/sales' }, { label: sale.invoiceNo }]}
        title={sale.invoiceNo}
        meta={<><SaleStatusBadge status={sale.status} /><PaymentStatusBadge status={sale.paymentStatus} /></>}
        description={`${dateTime(sale.createdAt)} · served by ${sale.cashierName}`}
        actions={
          <>
            {can('sales.return') && returnable && <Button icon={<Undo2 className="size-3.5" />} onClick={() => setReturning(true)}>Process return</Button>}
            {can('sales.record_payment') && sale.balanceDue > 0 && <Button icon={<Banknote className="size-3.5" />} onClick={() => setPaying(true)}>Record payment</Button>}
            <Button variant="primary" icon={<Printer className="size-3.5" />} onClick={() => setReceipt(true)}>Receipt</Button>
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Items" flush>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-subtle text-[11.5px] uppercase tracking-[0.04em] text-muted">
                  <tr className="border-b border-line">
                    <th className="px-4 py-2 text-left font-medium">Product</th>
                    <th className="px-3 py-2 text-left font-medium max-md:hidden">Batch</th>
                    <th className="px-3 py-2 text-right font-medium">Qty</th>
                    <th className="px-3 py-2 text-right font-medium">Price</th>
                    <th className="px-3 py-2 text-right font-medium max-sm:hidden">Discount</th>
                    <th className="px-4 py-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {sale.items.map((i) => (
                    <tr key={i.id} className="border-b border-line last:border-0">
                      <td className="px-4 py-2.5">
                        <Link to={`/inventory/products/${i.productId}`} className="hover:text-brand-700">{i.productName}</Link>
                        {i.quantityReturned > 0 && <Badge tone="warning" className="ml-2">{i.quantityReturned} returned</Badge>}
                        {showCost && i.unitCost !== undefined && <p className="text-[11.5px] text-muted num">Cost {amount(i.unitCost)} / {i.unit}</p>}
                      </td>
                      <td className="px-3 py-2.5 text-muted max-md:hidden">{i.batchNumber}{i.expiryDate && <span className="block text-[11.5px]">exp {date(i.expiryDate)}</span>}</td>
                      <td className="px-3 py-2.5 text-right num">{i.unitsPerSaleUnit > 1 ? <>{i.quantity / i.unitsPerSaleUnit} × pack<span className="block text-[11.5px] text-muted">{i.quantity} {i.unit}</span></> : i.quantity}</td>
                      <td className="px-3 py-2.5 text-right num">{amount(i.unitPrice)}</td>
                      <td className="px-3 py-2.5 text-right num max-sm:hidden">{i.discountAmount > 0 ? amount(i.discountAmount) : '—'}</td>
                      <td className="px-4 py-2.5 text-right font-medium num">{amount(i.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="ml-auto max-w-xs space-y-1 border-t border-line px-4 py-3 text-[13px]">
              <Line label="Subtotal" value={money(sale.subtotal)} />
              {sale.discountTotal > 0 && <Line label="Discount" value={`−${money(sale.discountTotal)}`} />}
              {sale.taxTotal > 0 && <Line label={sale.taxInclusive ? 'VAT (included)' : 'VAT'} value={money(sale.taxTotal)} />}
              <Line label="Total" value={money(sale.total)} strong />
              {showCost && sale.costTotal !== undefined && <Line label="Cost of goods" value={money(sale.costTotal)} muted />}
            </div>
          </Card>
          {sale.returns.length > 0 && (
            <Card title="Returns" flush>
              <ul className="divide-y divide-line">
                {sale.returns.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-[13px]">
                    <span className="font-medium">{r.returnNo}</span>
                    <span className="text-muted">{RETURN_REASONS[r.reason as keyof typeof RETURN_REASONS]}</span>
                    <span className="text-muted">{dateTime(r.createdAt)} · {r.processedByName}</span>
                    <span className="ml-auto num">
                      {r.refundAmount > 0 && <>Refunded {money(r.refundAmount)} ({REFUND_METHODS[r.refundMethod as keyof typeof REFUND_METHODS]})</>}
                      {r.balanceReduction > 0 && <> · balance −{money(r.balanceReduction)}</>}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
        <div className="space-y-4">
          <Card title="Customer">
            {sale.customerId ? (
              <DetailList columns={1} items={[
                { label: 'Name', value: <Link to={`/customers/${sale.customerId}`} className="text-brand-700 hover:underline">{sale.customerName}</Link> },
                { label: 'Phone', value: sale.customerPhone },
                { label: 'Prescription', value: sale.prescriptionId ? <Link to={`/prescriptions/${sale.prescriptionId}`} className="text-brand-700 hover:underline">{sale.rxNumber}</Link> : null, hidden: !sale.prescriptionId },
              ]} />
            ) : (
              <p className="text-[13px] text-muted">Walk-in customer</p>
            )}
          </Card>
          <Card title="Payment">
            <DetailList columns={1} items={[
              { label: 'Method', value: SALE_PAYMENT_TYPES[sale.paymentType as keyof typeof SALE_PAYMENT_TYPES] },
              { label: 'Paid', value: <span className="num">{money(sale.amountPaid)}</span> },
              { label: 'Balance due', value: <span className={sale.balanceDue > 0 ? 'font-medium text-warning num' : 'num'}>{money(sale.balanceDue)}</span> },
              { label: 'Cash tendered', value: sale.cashTendered != null ? <span className="num">{money(sale.cashTendered)} (change {money(sale.changeGiven ?? 0)})</span> : null, hidden: sale.cashTendered == null },
            ]} />
            {sale.payments.length > 0 && (
              <ul className="mt-4 space-y-2 border-t border-line pt-3">
                {sale.payments.map((p) => (
                  <li key={p.id} className="flex justify-between gap-3 text-[12.5px]">
                    <span>
                      {PAYMENT_METHODS[p.method as keyof typeof PAYMENT_METHODS]}
                      <span className="block text-[11.5px] text-muted">{p.paymentNo}{p.reference ? ` · ${p.reference}` : ''} · {dateTime(p.receivedAt)}</span>
                    </span>
                    <span className="font-medium num">{amount(p.amount)} {currency}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {sale.notes && <Card title="Notes"><p className="text-[13px]">{sale.notes}</p></Card>}
        </div>
      </div>
      <ReceiptModal saleId={receipt ? sale.id : null} onClose={() => setReceipt(false)} />
      <RecordPaymentModal sale={sale} open={paying} onClose={() => setPaying(false)} />
      <ReturnModal sale={sale} open={returning} onClose={() => { setReturning(false); if (params.has('return')) setParams({}, { replace: true }); }} />
    </Page>
  );
}

function Line({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? 'pt-1 text-[14px] font-semibold' : muted ? 'text-faint' : 'text-muted'}`}>
      <span>{label}</span>
      <span className="num">{value}</span>
    </div>
  );
}

function RecordPaymentModal({ sale, open, onClose }: { sale: SaleDetail; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { money } = useFormat();
  const [error, setError] = useState<string | null>(null);
  const form = useZodForm(recordSalePaymentSchema, { defaultValues: { method: 'mobile_money', amount: sale.balanceDue, reference: '', notes: '' } });
  useEffect(() => {
    if (open) { form.reset({ method: 'mobile_money', amount: sale.balanceDue, reference: '', notes: '' }); setError(null); }
  }, [open, sale.balanceDue, form]);
  const pay = useMutation({ mutationFn: (body: unknown) => api.post(`/sales/${sale.id}/payments`, body) });
  const submit = form.handleSubmit(async (data) => {
    try {
      await pay.mutateAsync(data);
      qc.invalidateQueries({ queryKey: ['sale', String(sale.id)] });
      qc.invalidateQueries({ queryKey: ['sales'] });
      toast.success('Payment recorded');
      onClose();
    } catch (e) {
      setError(applyServerErrors(form, e));
    }
  });
  const { errors } = form.formState;
  return (
    <Modal open={open} onClose={onClose} title="Record customer payment" description={`${sale.invoiceNo} · balance ${money(sale.balanceDue)}`} size="sm"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={pay.isPending} onClick={submit}>Save payment</Button></>}>
      <form onSubmit={submit} className="space-y-3.5">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Method" required>{(id) => (
          <Select id={id} {...form.register('method')}>
            <option value="cash">Cash</option><option value="mobile_money">Mobile Money</option><option value="card">Card</option><option value="bank_transfer">Bank Transfer</option>
          </Select>
        )}</Field>
        <Field label="Amount" required error={errors.amount?.message}>{(id) => <Input id={id} inputMode="decimal" {...form.register('amount')} />}</Field>
        <Field label="Reference" error={errors.reference?.message}>{(id) => <Input id={id} {...form.register('reference')} />}</Field>
      </form>
    </Modal>
  );
}

function ReturnModal({ sale, open, onClose }: { sale: SaleDetail; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { money } = useFormat();
  const [qty, setQty] = useState<Record<number, number>>({});
  const [condition, setCondition] = useState<Record<number, string>>({});
  const [reason, setReason] = useState('not_needed');
  const [refundMethod, setRefundMethod] = useState('cash');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) { setQty({}); setCondition({}); setReason('not_needed'); setRefundMethod('cash'); setNotes(''); setError(null); }
  }, [open]);
  const lines = sale.items.filter((i) => i.quantity > i.quantityReturned);
  const refund = useMemo(
    () => lines.reduce((a, i) => a + (qty[i.id] ? Math.round((i.lineTotal * qty[i.id] * 100) / i.quantity) / 100 : 0), 0),
    [lines, qty],
  );
  const fromBalance = Math.min(refund, sale.balanceDue);
  const submit = useMutation({
    mutationFn: () =>
      api.post<{ returnNo: string }>('/sales/returns', {
        saleId: sale.id, reason, refundMethod, notes: notes || null,
        items: lines.filter((i) => qty[i.id] > 0).map((i) => ({ saleItemId: i.id, quantity: qty[i.id], condition: condition[i.id] ?? 'resellable' })),
      }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['sale', String(sale.id)] });
      qc.invalidateQueries({ queryKey: ['sales'] });
      toast.success(`Return ${r.returnNo} processed`);
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Return failed.'),
  });
  const any = Object.values(qty).some((v) => v > 0);
  return (
    <Modal open={open} onClose={onClose} title="Process return" description={`${sale.invoiceNo} · ${sale.customerName ?? 'Walk-in customer'}`} size="lg"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!any} loading={submit.isPending} onClick={() => submit.mutate()}>Confirm return · {money(refund)}</Button></>}>
      {error && <Alert tone="danger" className="mb-3">{error}</Alert>}
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="w-full text-[13px]">
          <thead className="bg-subtle text-[11.5px] uppercase tracking-[0.04em] text-muted">
            <tr><th className="px-3 py-2 text-left font-medium">Item</th><th className="px-3 py-2 text-right font-medium">Returnable</th><th className="px-3 py-2 font-medium">Return qty</th><th className="px-3 py-2 text-left font-medium">Condition</th></tr>
          </thead>
          <tbody>
            {lines.map((i) => (
              <tr key={i.id} className="border-t border-line">
                <td className="px-3 py-2">{i.productName}<span className="block text-[11.5px] text-muted">Batch {i.batchNumber} · {money(i.lineTotal / i.quantity)} each</span></td>
                <td className="px-3 py-2 text-right num">{i.quantity - i.quantityReturned}</td>
                <td className="px-3 py-2"><Input aria-label="Return quantity" inputMode="numeric" className="mx-auto w-20 text-right" value={qty[i.id] ?? ''} placeholder="0"
                  onChange={(e) => setQty({ ...qty, [i.id]: Math.min(Number(e.target.value.replace(/\D/g, '')) || 0, i.quantity - i.quantityReturned) })} /></td>
                <td className="px-3 py-2">
                  <Select aria-label="Condition" value={condition[i.id] ?? 'resellable'} onChange={(e) => setCondition({ ...condition, [i.id]: e.target.value })} className="w-56">
                    {Object.entries(RETURN_CONDITIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Reason" required>{(id) => <Select id={id} value={reason} onChange={(e) => setReason(e.target.value)}>{Object.entries(RETURN_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
        <Field label="Refund by" required hint={!sale.customerId ? 'Store credit needs a customer on the invoice.' : undefined}>{(id) => (
          <Select id={id} value={refundMethod} onChange={(e) => setRefundMethod(e.target.value)}>
            {Object.entries(REFUND_METHODS).filter(([k]) => k !== 'store_credit' || sale.customerId).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        )}</Field>
        <Field label="Notes" className="sm:col-span-2">{(id) => <Textarea id={id} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
      </div>
      {any && (
        <Alert tone="info" className="mt-4">
          Return value {money(refund)}.
          {fromBalance > 0 && ` ${money(fromBalance)} clears the unpaid balance;`}
          {refund - fromBalance > 0 && ` ${money(refund - fromBalance)} to refund by ${REFUND_METHODS[refundMethod as keyof typeof REFUND_METHODS].toLowerCase()}.`}
          {' '}Only resellable, unexpired items go back into stock.
        </Alert>
      )}
    </Modal>
  );
}
