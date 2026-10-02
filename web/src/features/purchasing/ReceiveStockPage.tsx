import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { addDays, daysBetween } from '@dawa/shared';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFormat } from '@/lib/settings';
import { cn } from '@/lib/cn';
import { Page } from '@/components/layout/AppLayout';
import { Alert, Button, Card, Checkbox, EmptyState, Field, IconButton, Input, PageHeader, PageLoader, Select, useToast } from '@/components/ui';
import { ProductPicker } from '@/components/ProductPicker';
import { useSupplierOptions } from '../inventory/ProductFormPage';

interface Line {
  key: string; purchaseOrderItemId: number | null; productId: number; name: string; unit: string; tracked: boolean; outstanding: number | null;
  batchNumber: string; manufactureDate: string; expiryDate: string; quantity: string; unitCost: string; sellingPrice: string; currentPrice: number;
}
interface PoForReceipt {
  id: number; poNumber: string; status: string; supplierId: number; supplierName: string;
  items: { id: number; productId: number; productName: string; unit: string; isBatchTracked: boolean; quantityOrdered: number; quantityReceived: number; unitCost: number; currentSellingPrice: number }[];
}

/** Goods receipt: every line becomes (or tops up) a batch with its own expiry and cost. */
export function ReceiveStockPage() {
  const [params] = useSearchParams();
  const poId = params.get('po');
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const { money, amount, currency, today, date } = useFormat();
  const t = today();
  const suppliers = useSupplierOptions();
  const [supplierId, setSupplierId] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [receivedDate, setReceivedDate] = useState(t);
  const [notes, setNotes] = useState('');
  const [updatePrices, setUpdatePrices] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);

  const po = useQuery({ queryKey: ['purchase-order', poId], queryFn: () => api.get<PoForReceipt>(`/purchasing/orders/${poId}`), enabled: Boolean(poId) });
  useEffect(() => {
    if (!po.data) return;
    setSupplierId(String(po.data.supplierId));
    setLines(po.data.items.filter((i) => i.quantityOrdered > i.quantityReceived).map((i) => ({
      key: `po-${i.id}`, purchaseOrderItemId: i.id, productId: i.productId, name: i.productName, unit: i.unit, tracked: i.isBatchTracked,
      outstanding: i.quantityOrdered - i.quantityReceived, batchNumber: '', manufactureDate: '', expiryDate: '',
      quantity: String(i.quantityOrdered - i.quantityReceived), unitCost: String(i.unitCost), sellingPrice: '', currentPrice: i.currentSellingPrice,
    })));
  }, [po.data]);

  const update = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const total = lines.reduce((a, l) => a + (Number(l.quantity) || 0) * (Number(l.unitCost) || 0), 0);
  const lineIssue = (l: Line) => {
    if (!Number(l.quantity)) return 'Enter the quantity received';
    if (l.outstanding !== null && Number(l.quantity) > l.outstanding) return `Only ${l.outstanding} outstanding on the order`;
    if (l.tracked && !l.batchNumber.trim()) return 'Batch number is required';
    if (l.tracked && !l.expiryDate) return 'Expiry date is required';
    if (l.expiryDate && l.expiryDate <= receivedDate) return 'This batch is already expired — do not receive it';
    return null;
  };
  const issues = lines.map(lineIssue);

  const save = useMutation({
    mutationFn: () =>
      api.post<{ id: number; grnNumber: string }>('/purchasing/receipts', {
        purchaseOrderId: poId ? Number(poId) : null, supplierId, supplierInvoiceNo: invoiceNo || null, receivedDate, notes: notes || null,
        updateSellingPrices: updatePrices,
        items: lines.map((l) => ({
          purchaseOrderItemId: l.purchaseOrderItemId, productId: l.productId, batchNumber: l.tracked ? l.batchNumber.trim() : 'NO-BATCH',
          manufactureDate: l.manufactureDate || null, expiryDate: l.expiryDate || null, quantity: l.quantity, unitCost: l.unitCost, sellingPrice: l.sellingPrice || null,
        })),
      }),
    onSuccess: (r) => {
      ['products', 'batches', 'purchase-orders', 'purchase-order', 'receipts', 'dashboard', 'supplier', 'suppliers', 'expiry-summary'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast.success(`Stock received on ${r.grnNumber}`);
      navigate(`/purchasing/receipts/${r.id}`);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not save the receipt'),
  });

  if (poId && po.isLoading) return <PageLoader />;
  const blocked = !supplierId || !lines.length || issues.some(Boolean);

  return (
    <Page wide>
      <PageHeader
        breadcrumbs={[{ label: 'Receive stock', to: '/purchasing/receipts' }, { label: po.data ? po.data.poNumber : 'Direct delivery' }]}
        title={po.data ? `Receive ${po.data.poNumber}` : 'Receive stock'}
        description={po.data ? `From ${po.data.supplierName}. Enter the batch and expiry printed on each carton.` : 'Record a delivery without a purchase order. Enter the batch and expiry printed on each carton.'}
        actions={<><Button onClick={() => navigate(-1)}>Cancel</Button><Button variant="primary" disabled={blocked} loading={save.isPending} onClick={() => save.mutate()}>Receive {lines.length} line(s) · {money(total)}</Button></>}
      />
      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}
      <Card className="mb-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Supplier" required>{(id) => (
            <Select id={id} placeholder="Choose supplier" value={supplierId} disabled={Boolean(po.data)} onChange={(e) => setSupplierId(e.target.value)}>
              {suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          )}</Field>
          <Field label="Supplier invoice / delivery note">{(id) => <Input id={id} value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} />}</Field>
          <Field label="Received on" required>{(id) => <Input id={id} type="date" max={t} value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} />}</Field>
          <Field label="Notes">{(id) => <Input id={id} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. 2 cartons short, follow up" />}</Field>
        </div>
      </Card>
      <Card title="Items received" flush actions={can('products.manage_prices') && <Checkbox checked={updatePrices} onChange={(e) => setUpdatePrices(e.target.checked)} label="Update product selling prices from this delivery" />}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-[13px]">
            <thead className="bg-subtle text-[11.5px] uppercase tracking-[0.04em] text-muted">
              <tr className="border-b border-line">
                <th className="px-4 py-2 text-left font-medium">Product</th>
                <th className="px-2 py-2 text-left font-medium">Batch no.</th>
                <th className="px-2 py-2 text-left font-medium">Mfg date</th>
                <th className="px-2 py-2 text-left font-medium">Expiry</th>
                <th className="px-2 py-2 text-right font-medium">Qty</th>
                <th className="px-2 py-2 text-right font-medium">Unit cost</th>
                <th className="px-2 py-2 text-right font-medium">Sell price</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
                <th className="w-9" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const issue = issues[i];
                const shelfDays = l.expiryDate ? daysBetween(receivedDate, l.expiryDate) : null;
                return (
                  <tr key={l.key} className="border-b border-line align-top">
                    <td className="px-4 py-2">
                      <p className="font-medium">{l.name}</p>
                      <p className="text-[11.5px] text-muted">{l.outstanding !== null ? `${l.outstanding} ${l.unit} outstanding` : l.unit}{!l.tracked && ' · not batch-tracked'}</p>
                      {issue && <p className="mt-0.5 text-[11.5px] text-danger">{issue}</p>}
                      {!issue && shelfDays !== null && shelfDays < 180 && <p className="mt-0.5 text-[11.5px] text-warning">Short expiry: {shelfDays} days of shelf life</p>}
                    </td>
                    <td className="px-2 py-2"><Input aria-label="Batch number" disabled={!l.tracked} value={l.tracked ? l.batchNumber : '—'} onChange={(e) => update(l.key, { batchNumber: e.target.value.toUpperCase() })} className="w-28 font-mono" /></td>
                    <td className="px-2 py-2"><Input aria-label="Manufacturing date" type="date" disabled={!l.tracked} max={receivedDate} value={l.manufactureDate} onChange={(e) => update(l.key, { manufactureDate: e.target.value })} className="w-36" /></td>
                    <td className="px-2 py-2"><Input aria-label="Expiry date" type="date" disabled={!l.tracked} min={addDays(receivedDate, 1)} value={l.expiryDate} onChange={(e) => update(l.key, { expiryDate: e.target.value })} className={cn('w-36', l.tracked && !l.expiryDate && 'border-warning-line')} /></td>
                    <td className="px-2 py-2"><Input aria-label="Quantity" inputMode="numeric" value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value.replace(/\D/g, '') })} className="ml-auto w-20 text-right" /></td>
                    <td className="px-2 py-2"><Input aria-label="Unit cost" inputMode="decimal" value={l.unitCost} onChange={(e) => update(l.key, { unitCost: e.target.value.replace(/[^\d.]/g, '') })} className="ml-auto w-24 text-right" /></td>
                    <td className="px-2 py-2"><Input aria-label="Selling price" inputMode="decimal" placeholder={amount(l.currentPrice)} value={l.sellingPrice} onChange={(e) => update(l.key, { sellingPrice: e.target.value.replace(/[^\d.]/g, '') })} className="ml-auto w-24 text-right" /></td>
                    <td className="px-3 py-2 pt-3.5 text-right font-medium num">{amount((Number(l.quantity) || 0) * (Number(l.unitCost) || 0))}</td>
                    <td className="py-2 pr-2"><IconButton label="Remove line" size="sm" onClick={() => setLines(lines.filter((x) => x.key !== l.key))}><Trash2 className="size-3.5" /></IconButton></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!lines.length && <EmptyState compact title="No lines" description={po.data ? 'Everything on this order has been received.' : 'Search for the products in this delivery.'} />}
        {!po.data && (
          <div className="p-3">
            <ProductPicker showCost exclude={lines.map((l) => l.productId)} onPick={(p) => setLines((ls) => [...ls, {
              key: `p-${p.id}-${Date.now()}`, purchaseOrderItemId: null, productId: p.id, name: p.name, unit: p.unit, tracked: p.isBatchTracked, outstanding: null,
              batchNumber: '', manufactureDate: '', expiryDate: '', quantity: '', unitCost: String(p.purchasePrice), sellingPrice: '', currentPrice: p.sellingPrice,
            }])} />
          </div>
        )}
        <div className="flex justify-end border-t border-line px-4 py-3 text-[14px]">
          <span className="text-muted">Delivery value&nbsp;</span><b className="num">{money(total)}</b><span className="ml-2 text-[12px] text-muted">({currency}, excl. VAT)</span>
        </div>
      </Card>
      {po.data && <p className="mt-3 text-[12px] text-muted">Partial deliveries are fine — receive what arrived; the rest stays outstanding on <Link to={`/purchasing/orders/${po.data.id}`} className="text-brand-700 hover:underline">{po.data.poNumber}</Link>. Business date {date(t)}.</p>}
    </Page>
  );
}
