import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lightbulb, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useFormat } from '@/lib/settings';
import { Page } from '@/components/layout/AppLayout';
import { Alert, Button, Card, EmptyState, ErrorState, Field, IconButton, Input, Modal, PageHeader, PageLoader, Select, Textarea, useToast } from '@/components/ui';
import { ProductPicker } from '@/components/ProductPicker';
import { useSupplierOptions } from '../inventory/ProductFormPage';

interface Line { productId: number; name: string; sku: string; unit: string; packSize: number; quantity: string; unitCost: string; discount: string; taxRate: string }
interface Suggestion { id: number; sku: string; name: string; unit: string; packSize: number; reorderLevel: number; purchasePrice: number; sellable: number; suggestedQuantity: number; supplierName: string | null; defaultSupplierId: number | null; onOpenOrder: boolean }

export function PurchaseOrderFormPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { money, amount, currency, today } = useFormat();
  const suppliers = useSupplierOptions();
  const [supplierId, setSupplierId] = useState(params.get('supplierId') ?? '');
  const [orderDate, setOrderDate] = useState(today());
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);

  const existing = useQuery({
    queryKey: ['purchase-order', id],
    queryFn: () => api.get<{ supplierId: number; orderDate: string; expectedDate: string | null; notes: string | null; status: string; poNumber: string; items: { productId: number; productName: string; sku: string; unit: string; packSize: number; quantityOrdered: number; unitCost: number; discountAmount: number; taxRate: number }[] }>(`/purchasing/orders/${id}`),
    enabled: editing,
  });
  useEffect(() => {
    const po = existing.data;
    if (!po) return;
    setSupplierId(String(po.supplierId));
    setOrderDate(po.orderDate);
    setExpectedDate(po.expectedDate ?? '');
    setNotes(po.notes ?? '');
    setLines(po.items.map((i) => ({ productId: i.productId, name: i.productName, sku: i.sku, unit: i.unit, packSize: i.packSize, quantity: String(i.quantityOrdered), unitCost: String(i.unitCost), discount: String(i.discountAmount || ''), taxRate: String(i.taxRate) })));
  }, [existing.data]);

  const totals = useMemo(() => {
    let sub = 0, disc = 0, tax = 0;
    for (const l of lines) {
      const g = (Number(l.quantity) || 0) * (Number(l.unitCost) || 0);
      const d = Number(l.discount) || 0;
      sub += g; disc += d; tax += ((g - d) * (Number(l.taxRate) || 0)) / 100;
    }
    return { sub, disc, tax: Math.round(tax * 100) / 100, total: Math.round((sub - disc + tax) * 100) / 100 };
  }, [lines]);

  const save = useMutation({
    mutationFn: (submitAfter: boolean) => {
      const body = {
        supplierId, orderDate, expectedDate: expectedDate || null, notes: notes || null,
        items: lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitCost: l.unitCost, discount: l.discount || 0, taxRate: l.taxRate || 0 })),
      };
      return (editing ? api.put<{ id: number }>(`/purchasing/orders/${id}`, body) : api.post<{ id: number }>('/purchasing/orders', body)).then(async (r) => {
        if (submitAfter && (!editing || existing.data?.status === 'draft')) await api.post(`/purchasing/orders/${r.id}/transition`, { action: 'submit' });
        return r;
      });
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      qc.invalidateQueries({ queryKey: ['purchase-order', String(r.id)] });
      toast.success(editing ? 'Purchase order updated' : 'Purchase order created');
      navigate(`/purchasing/orders/${r.id}`);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not save'),
  });

  const addLine = (p: { id: number; name: string; sku: string; unit: string; packSize: number; purchasePrice: number }, qty?: number) =>
    setLines((ls) => (ls.some((l) => l.productId === p.id) ? ls : [...ls, { productId: p.id, name: p.name, sku: p.sku, unit: p.unit, packSize: p.packSize, quantity: String(qty ?? p.packSize), unitCost: String(p.purchasePrice), discount: '', taxRate: '0' }]));
  const update = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  if (editing && existing.isLoading) return <PageLoader />;
  if (editing && existing.error) return <Page><ErrorState error={existing.error} /></Page>;

  return (
    <Page>
      <PageHeader
        breadcrumbs={[{ label: 'Purchase orders', to: '/purchasing/orders' }, { label: editing ? existing.data?.poNumber ?? '' : 'New' }]}
        title={editing ? `Edit ${existing.data?.poNumber}` : 'New purchase order'}
        actions={
          <>
            <Button onClick={() => navigate(-1)}>Cancel</Button>
            <Button loading={save.isPending && !save.variables} disabled={!lines.length || !supplierId} onClick={() => save.mutate(false)}>Save as draft</Button>
            <Button variant="primary" loading={save.isPending && save.variables} disabled={!lines.length || !supplierId} onClick={() => save.mutate(true)}>Submit for approval</Button>
          </>
        }
      />
      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}
      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <Card title="Order lines" actions={<Button size="sm" icon={<Lightbulb className="size-3.5" />} onClick={() => setSuggesting(true)}>Reorder suggestions</Button>} flush>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-subtle text-[11.5px] uppercase tracking-[0.04em] text-muted">
                <tr className="border-b border-line">
                  <th className="px-4 py-2 text-left font-medium">Product</th>
                  <th className="px-2 py-2 text-right font-medium">Quantity</th>
                  <th className="px-2 py-2 text-right font-medium">Unit cost</th>
                  <th className="px-2 py-2 text-right font-medium">Discount</th>
                  <th className="px-2 py-2 text-right font-medium">VAT %</th>
                  <th className="px-4 py-2 text-right font-medium">Line total</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => {
                  const g = (Number(l.quantity) || 0) * (Number(l.unitCost) || 0) - (Number(l.discount) || 0);
                  const lt = g + (g * (Number(l.taxRate) || 0)) / 100;
                  return (
                    <tr key={l.productId} className="border-b border-line">
                      <td className="px-4 py-2"><p className="font-medium">{l.name}</p><p className="text-[11.5px] text-muted">{l.sku} · {l.packSize} {l.unit} per pack</p></td>
                      <td className="px-2 py-2"><Input aria-label="Quantity" inputMode="numeric" value={l.quantity} onChange={(e) => update(i, { quantity: e.target.value.replace(/\D/g, '') })} className="ml-auto w-20 text-right" /></td>
                      <td className="px-2 py-2"><Input aria-label="Unit cost" inputMode="decimal" value={l.unitCost} onChange={(e) => update(i, { unitCost: e.target.value.replace(/[^\d.]/g, '') })} className="ml-auto w-24 text-right" /></td>
                      <td className="px-2 py-2"><Input aria-label="Discount" inputMode="decimal" value={l.discount} placeholder="0" onChange={(e) => update(i, { discount: e.target.value.replace(/[^\d.]/g, '') })} className="ml-auto w-24 text-right" /></td>
                      <td className="px-2 py-2"><Select aria-label="VAT" value={l.taxRate} onChange={(e) => update(i, { taxRate: e.target.value })} className="ml-auto w-20"><option value="0">0</option><option value="18">18</option></Select></td>
                      <td className="px-4 py-2 text-right font-medium num">{amount(lt)}</td>
                      <td className="pr-2"><IconButton label="Remove line" size="sm" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 className="size-3.5" /></IconButton></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!lines.length && <EmptyState compact title="No products on this order yet" description="Search below, or use reorder suggestions to add everything that is running low." />}
          <div className="p-3"><ProductPicker onPick={(p) => addLine(p)} exclude={lines.map((l) => l.productId)} showCost /></div>
        </Card>
        <div className="space-y-4">
          <Card title="Order details">
            <div className="space-y-3.5">
              <Field label="Supplier" required>{(fid) => <Select id={fid} placeholder="Choose supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>{suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>}</Field>
              <Field label="Order date" required>{(fid) => <Input id={fid} type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />}</Field>
              <Field label="Expected delivery">{(fid) => <Input id={fid} type="date" min={orderDate} value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />}</Field>
              <Field label="Notes for supplier">{(fid) => <Textarea id={fid} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
            </div>
          </Card>
          <Card title="Summary">
            <dl className="space-y-1.5 text-[13px]">
              <div className="flex justify-between text-muted"><dt>Subtotal</dt><dd className="num">{money(totals.sub)}</dd></div>
              {totals.disc > 0 && <div className="flex justify-between text-muted"><dt>Discount</dt><dd className="num">−{money(totals.disc)}</dd></div>}
              {totals.tax > 0 && <div className="flex justify-between text-muted"><dt>VAT</dt><dd className="num">{money(totals.tax)}</dd></div>}
              <div className="flex justify-between border-t border-line pt-2 text-[15px] font-semibold"><dt>Total</dt><dd className="num">{money(totals.total)}</dd></div>
            </dl>
            <p className="mt-2 text-[11.5px] text-muted">Purchase costs exclude VAT; amounts in {currency}.</p>
          </Card>
        </div>
      </div>
      <SuggestionsModal open={suggesting} onClose={() => setSuggesting(false)} supplierId={supplierId} onAdd={(items) => { items.forEach((s) => addLine(s, s.suggestedQuantity)); if (!supplierId && items[0]?.defaultSupplierId) setSupplierId(String(items[0].defaultSupplierId)); setSuggesting(false); }} />
    </Page>
  );
}

function SuggestionsModal({ open, onClose, supplierId, onAdd }: { open: boolean; onClose: () => void; supplierId: string; onAdd: (s: Suggestion[]) => void }) {
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const { data, isLoading } = useQuery({
    queryKey: ['reorder', supplierId],
    queryFn: () => api.get<Suggestion[]>('/purchasing/reorder-suggestions', { supplierId: supplierId || undefined }),
    enabled: open,
  });
  useEffect(() => { if (data) setPicked(new Set(data.filter((s) => !s.onOpenOrder).map((s) => s.id))); }, [data]);
  return (
    <Modal open={open} onClose={onClose} size="lg" title="Reorder suggestions" description={supplierId ? 'Low-stock products whose default supplier is the selected supplier.' : 'All products at or below their reorder level.'}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!picked.size} onClick={() => onAdd((data ?? []).filter((s) => picked.has(s.id)))}>Add {picked.size} product(s)</Button></>}>
      {isLoading ? <PageLoader /> : !data?.length ? <EmptyState compact title="Nothing needs reordering" /> : (
        <div className="overflow-hidden rounded-md border border-line">
          <table className="w-full text-[13px]">
            <thead className="bg-subtle text-[11.5px] uppercase tracking-[0.04em] text-muted"><tr><th className="w-9" /><th className="px-3 py-2 text-left font-medium">Product</th><th className="px-3 py-2 text-right font-medium">In stock</th><th className="px-3 py-2 text-right font-medium">Reorder</th><th className="px-3 py-2 text-right font-medium">Suggested</th></tr></thead>
            <tbody>
              {data.map((s) => (
                <tr key={s.id} className="border-t border-line">
                  <td className="px-3"><input type="checkbox" aria-label={`Select ${s.name}`} className="accent-[var(--brand-600)]" checked={picked.has(s.id)} onChange={() => { const n = new Set(picked); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); setPicked(n); }} /></td>
                  <td className="px-3 py-2">{s.name}<span className="block text-[11.5px] text-muted">{s.supplierName ?? 'No default supplier'}{s.onOpenOrder && ' · already on an open order'}</span></td>
                  <td className="px-3 py-2 text-right num">{s.sellable}</td>
                  <td className="px-3 py-2 text-right text-muted num">{s.reorderLevel}</td>
                  <td className="px-3 py-2 text-right font-medium num">{s.suggestedQuantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
