import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Minus, PackageSearch, Plus, ScanLine, Search, ShoppingCart, Trash2, X } from 'lucide-react';
import { computeCart, fromCents, toCents } from '@dawa/shared';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDebounced } from '@/lib/hooks';
import { useFormat } from '@/lib/settings';
import { cn } from '@/lib/cn';
import type { CustomerOption, PosProduct } from '@/lib/types';
import { Alert, Badge, Button, EmptyState, IconButton, Input, Select, Spinner, useToast } from '@/components/ui';
import { CustomerPicker } from '@/components/CustomerPicker';
import { RxTag } from '@/components/StatusBadges';
import { ReceiptModal } from '../sales/ReceiptModal';
import { PaymentModal, type PaymentResult } from './PaymentModal';
import { PrescriptionPicker, type LoadedPrescription } from './PrescriptionPicker';

export interface CartLine {
  key: string;
  product: PosProduct;
  quantity: number;
  batchId: number | null;
  /** Line discount in currency units. */
  discount: number;
  /** 'pack' sells whole packs at the pack price; quantity then counts packs. */
  sellBy: 'unit' | 'pack';
  prescriptionItemId?: number;
}

/** Price per sold unit and the most that can be sold, for the line's selling mode. */
export function lineMode(l: CartLine) {
  const pack = l.sellBy === 'pack';
  return {
    price: pack ? l.product.packSellingPrice ?? l.product.sellingPrice : l.product.sellingPrice,
    max: pack ? Math.floor(l.product.sellable / l.product.packSize) : l.product.sellable,
  };
}

/** Keyboard-wedge barcode scanners type fast and finish with Enter. */
function useScanner(onScan: (code: string) => void) {
  const buffer = useRef('');
  const last = useRef(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select, [role=dialog]')) return;
      const now = Date.now();
      if (now - last.current > 60) buffer.current = '';
      last.current = now;
      if (e.key === 'Enter') {
        if (buffer.current.length >= 6) {
          onScan(buffer.current);
          e.preventDefault();
        }
        buffer.current = '';
      } else if (e.key.length === 1) {
        buffer.current += e.key;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onScan]);
}

export function PosPage() {
  const { can } = useAuth();
  const { money, amount, settings, date, today } = useFormat();
  const toast = useToast();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const searchRef = useRef<HTMLInputElement>(null);

  const [term, setTerm] = useState('');
  const [cursor, setCursor] = useState(0);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [prescription, setPrescription] = useState<LoadedPrescription | null>(null);
  const [cartDiscount, setCartDiscount] = useState(0);
  const [paying, setPaying] = useState(false);
  const [rxPicker, setRxPicker] = useState(false);
  const [receiptFor, setReceiptFor] = useState<number | null>(null);

  const q = useDebounced(term.trim(), 150);
  const search = useQuery({
    queryKey: ['pos-search', q],
    queryFn: () => api.get<{ exactMatch: boolean; results: PosProduct[] }>('/products/pos-search', { q }),
    enabled: q.length >= 1,
    staleTime: 5_000,
  });
  const results = search.data?.results ?? [];
  useEffect(() => setCursor(0), [q]);

  const taxInclusive = settings?.sales.taxInclusive ?? true;
  const maxDiscount = settings?.sales.maxDiscountPercent ?? 0;
  const canDiscount = can('pos.discount', 'pos.discount_override');
  const canOverride = can('pos.discount_override');

  const totals = useMemo(
    () => computeCart(cart.map((l) => ({ quantity: l.quantity, unitPriceCents: toCents(lineMode(l).price), discountCents: toCents(l.discount), taxRate: Number(l.product.taxRate) })), toCents(cartDiscount), taxInclusive),
    [cart, cartDiscount, taxInclusive],
  );

  const addProduct = useCallback(
    (product: PosProduct, quantity = 1) => {
      if (product.sellable <= 0) {
        toast.error(`${product.name} is out of stock`, 'No sellable (unexpired) stock is available.');
        return;
      }
      setCart((lines) => {
        const existing = lines.find((l) => l.product.id === product.id && l.batchId === null && l.sellBy === 'unit');
        if (existing) return lines.map((l) => (l === existing ? { ...l, quantity: Math.min(l.quantity + quantity, product.sellable) } : l));
        return [...lines, { key: `${product.id}-${Date.now()}`, product, quantity: Math.min(quantity, product.sellable), batchId: null, discount: 0, sellBy: 'unit' }];
      });
      setTerm('');
      searchRef.current?.focus();
    },
    [toast],
  );

  const scan = useCallback(
    async (code: string) => {
      try {
        const r = await api.get<{ exactMatch: boolean; results: PosProduct[] }>('/products/pos-search', { q: code });
        if (r.exactMatch && r.results[0]) addProduct(r.results[0]);
        else toast.error('Barcode not recognised', `No active product has barcode or SKU “${code}”.`);
      } catch (e) {
        toast.error('Lookup failed', (e as Error).message);
      }
    },
    [addProduct, toast],
  );
  useScanner(scan);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === 'F9' && cart.length && !paying) { e.preventDefault(); setPaying(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cart.length, paying]);

  const loadPrescription = useCallback((rx: LoadedPrescription) => {
    setPrescription(rx);
    setCustomer(rx.customer);
    setCart(
      rx.items
        .filter((i) => i.quantityRemaining > 0 && i.product.sellable > 0)
        .map((i) => ({
          key: `rx-${i.id}`,
          product: i.product,
          quantity: Math.min(i.quantity, i.quantityRemaining, i.product.sellable),
          batchId: null,
          discount: 0,
          sellBy: 'unit' as const,
          prescriptionItemId: i.id,
        })),
    );
    const unavailable = rx.items.filter((i) => i.quantityRemaining > 0 && i.product.sellable <= 0);
    if (unavailable.length) toast.info('Some items are out of stock', unavailable.map((i) => i.product.name).join(', '));
  }, [toast]);

  // Dispense from the prescription page: /pos?prescription=ID
  const rxParam = params.get('prescription');
  useEffect(() => {
    if (!rxParam) return;
    PrescriptionPicker.load(Number(rxParam))
      .then(loadPrescription)
      .catch((e) => toast.error('Could not load prescription', (e as Error).message))
      .finally(() => setParams({}, { replace: true }));
  }, [rxParam, loadPrescription, setParams, toast]);

  const reset = () => {
    setCart([]);
    setCustomer(null);
    setPrescription(null);
    setCartDiscount(0);
    setTerm('');
    searchRef.current?.focus();
  };

  const onPaid = (r: PaymentResult) => {
    setPaying(false);
    reset();
    setReceiptFor(r.id);
    qc.invalidateQueries({ queryKey: ['pos-search'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    toast.success(`Sale ${r.invoiceNo} completed`);
  };

  const update = (key: string, patch: Partial<CartLine>) => setCart((lines) => lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const rxIssues = cart.filter((l) => l.product.requiresPrescription && settings?.sales.requirePrescriptionForRx && !l.prescriptionItemId);
  const units = cart.reduce((a, l) => a + l.quantity, 0);

  return (
    <div className="flex h-full flex-col lg:flex-row">
      {/* Product search */}
      <section className="flex min-h-0 flex-1 flex-col border-line lg:border-r">
        <div className="border-b border-line bg-surface px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
              <input
                ref={searchRef}
                autoFocus
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, results.length - 1)); }
                  if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (term.trim().length >= 6 && /^[\w-]+$/.test(term.trim()) && !results.length) scan(term.trim());
                    else if (results[cursor]) addProduct(results[cursor]);
                  }
                  if (e.key === 'Escape') setTerm('');
                }}
                placeholder="Scan a barcode, or search by name, generic name or SKU"
                aria-label="Search products"
                className="h-10 w-full rounded-md border border-line-strong bg-surface pl-9 pr-24 text-[14px] placeholder:text-faint focus:border-brand-600 focus:outline-none focus:ring-3 focus:ring-[var(--ring)]"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1.5 text-[11px] text-faint">
                <ScanLine className="size-3.5" /> F2
              </span>
            </div>
            {can('prescriptions.dispense') && (
              <Button size="lg" icon={<ClipboardList className="size-4" />} onClick={() => setRxPicker(true)}>
                <span className="max-sm:hidden">Prescription</span>
              </Button>
            )}
          </div>
        </div>

        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
          {q.length === 0 ? (
            <EmptyState
              icon={PackageSearch}
              title="Ready to sell"
              description="Scan a product barcode at any time, or start typing a medicine name. Press Enter to add the highlighted item."
            />
          ) : search.isLoading ? (
            <div className="flex justify-center py-10"><Spinner /></div>
          ) : results.length === 0 ? (
            <EmptyState icon={PackageSearch} title={`No products match “${q}”`} description="Check the spelling or search by generic name." />
          ) : (
            <ul className="divide-y divide-line">
              {results.map((p, i) => {
                const nearest = p.batches[0];
                const out = p.sellable <= 0;
                return (
                  <li key={p.id}>
                    <button
                      onClick={() => addProduct(p)}
                      onMouseEnter={() => setCursor(i)}
                      disabled={out}
                      className={cn(
                        'flex w-full items-center gap-4 px-4 py-2.5 text-left sm:px-5',
                        i === cursor && !out && 'bg-brand-50/60',
                        out ? 'cursor-not-allowed opacity-55' : 'hover:bg-hover',
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 truncate text-[13.5px] font-medium">
                          {p.name}
                          {p.requiresPrescription && <RxTag />}
                        </p>
                        <p className="truncate text-[12px] text-muted">
                          {[p.genericName, p.dosageForm, p.sku].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      <div className="hidden w-36 text-right text-[12px] sm:block">
                        {out ? (
                          <Badge tone="neutral">Out of stock</Badge>
                        ) : (
                          <>
                            <p className="num">{p.sellable.toLocaleString()} {p.unit}{p.sellable === 1 ? '' : 's'}</p>
                            {nearest?.expiryDate && <p className="text-muted">Next exp. {date(nearest.expiryDate)}</p>}
                          </>
                        )}
                      </div>
                      <p className="w-24 text-right text-[13.5px] font-semibold num">{amount(p.sellingPrice)}</p>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {/* Cart */}
      <aside className="flex min-h-[60vh] w-full flex-col bg-surface lg:min-h-0 lg:w-[440px] xl:w-[480px]">
        <div className="space-y-2 border-b border-line px-4 py-3">
          <CustomerPicker value={customer} onChange={(c) => { setCustomer(c); if (prescription && c?.id !== prescription.customer.id) setPrescription(null); }} />
          {prescription && (
            <div className="flex items-center gap-2 rounded-md border border-info-line bg-info-bg px-2.5 py-1.5 text-[12.5px] text-info">
              <ClipboardList className="size-3.5" />
              <span className="flex-1">
                Dispensing <Link to={`/prescriptions/${prescription.id}`} className="font-medium underline-offset-2 hover:underline">{prescription.rxNumber}</Link> · {prescription.prescriberName}
              </span>
              <button aria-label="Detach prescription" onClick={() => setPrescription(null)} className="rounded p-0.5 hover:bg-white/40"><X className="size-3.5" /></button>
            </div>
          )}
        </div>

        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
          {cart.length === 0 ? (
            <EmptyState icon={ShoppingCart} title="Cart is empty" description="Products you add appear here." compact />
          ) : (
            <ul className="divide-y divide-line">
              {cart.map((l, idx) => {
                const t = totals.lines[idx];
                const pct = t.grossCents ? (toCents(l.discount) / t.grossCents) * 100 : 0;
                const overLimit = pct > maxDiscount + 1e-9 && !canOverride;
                return (
                  <li key={l.key} className="px-4 py-3">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 text-[13px] font-medium leading-snug">
                          <span className="truncate">{l.product.name}</span>
                          {l.product.requiresPrescription && <RxTag />}
                        </p>
                        <div className="mt-1 flex items-center gap-2">
                          <Select
                            aria-label="Batch"
                            value={l.batchId ?? ''}
                            onChange={(e) => update(l.key, { batchId: e.target.value ? Number(e.target.value) : null })}
                            className="w-full max-w-60 [&_select]:h-7 [&_select]:text-[12px]"
                          >
                            <option value="">Auto — earliest expiry first</option>
                            {l.product.batches.map((b) => (
                              <option key={b.id} value={b.id}>
                                {b.batchNumber} · exp {b.expiryDate ? date(b.expiryDate) : 'n/a'} · {b.quantity} left
                              </option>
                            ))}
                          </Select>
                        </div>
                      </div>
                      <IconButton label="Remove" size="sm" onClick={() => setCart((c) => c.filter((x) => x.key !== l.key))}>
                        <Trash2 className="size-3.5" />
                      </IconButton>
                    </div>
                    <div className="mt-2 flex items-center gap-3">
                      <div className="flex items-center rounded-md border border-line-strong">
                        <button aria-label="Decrease" className="flex size-7 items-center justify-center text-muted hover:text-fg disabled:opacity-40" disabled={l.quantity <= 1} onClick={() => update(l.key, { quantity: l.quantity - 1 })}>
                          <Minus className="size-3.5" />
                        </button>
                        <input
                          aria-label="Quantity"
                          inputMode="numeric"
                          value={l.quantity}
                          onChange={(e) => {
                            const n = Math.max(1, Math.min(Number(e.target.value.replace(/\D/g, '')) || 1, lineMode(l).max));
                            update(l.key, { quantity: n });
                          }}
                          className="h-7 w-11 border-x border-line text-center text-[13px] num focus:outline-none"
                        />
                        <button aria-label="Increase" className="flex size-7 items-center justify-center text-muted hover:text-fg disabled:opacity-40" disabled={l.quantity >= lineMode(l).max} onClick={() => update(l.key, { quantity: l.quantity + 1 })}>
                          <Plus className="size-3.5" />
                        </button>
                      </div>
                      <span className="text-[12px] text-muted num">× {amount(lineMode(l).price)}</span>
                      {l.product.packSellingPrice && l.product.packSize > 1 && !l.prescriptionItemId && (
                        <div role="group" aria-label="Sell by" className="flex rounded-md border border-line p-0.5 text-[11.5px]">
                          {(['unit', 'pack'] as const).map((mode) => (
                            <button
                              key={mode}
                              aria-pressed={l.sellBy === mode}
                              disabled={mode === 'pack' && l.product.sellable < l.product.packSize}
                              onClick={() => update(l.key, { sellBy: mode, quantity: 1, discount: 0 })}
                              className={cn('rounded px-1.5 py-0.5 font-medium disabled:opacity-40', l.sellBy === mode ? 'bg-brand-50 text-brand-700' : 'text-muted hover:text-fg')}
                            >
                              {mode === 'unit' ? l.product.unit : `pack of ${l.product.packSize}`}
                            </button>
                          ))}
                        </div>
                      )}
                      <span className="ml-auto text-[13.5px] font-semibold num">{amount(fromCents(t.totalCents))}</span>
                    </div>
                    {canDiscount && (
                      <div className="mt-2 flex items-center gap-2 text-[12px]">
                        <span className="text-muted">Discount</span>
                        <Input
                          aria-label="Line discount"
                          inputMode="decimal"
                          value={l.discount || ''}
                          placeholder="0"
                          onChange={(e) => update(l.key, { discount: Math.max(0, Math.min(Number(e.target.value.replace(/[^\d.]/g, '')) || 0, fromCents(t.grossCents))) })}
                          className="h-7 w-24 text-right text-[12px]"
                        />
                        {pct > 0 && <span className={cn('num', overLimit ? 'text-danger' : 'text-muted')}>{pct.toFixed(1)}%{overLimit && ` · limit ${maxDiscount}%`}</span>}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="border-t border-line bg-subtle/50 px-4 py-3">
          {rxIssues.length > 0 && (
            <Alert tone="warning" className="mb-3">
              {rxIssues.map((l) => l.product.name).join(', ')} {rxIssues.length === 1 ? 'is' : 'are'} prescription-only. Attach the patient's prescription to dispense.
            </Alert>
          )}
          <dl className="space-y-1 text-[13px]">
            <div className="flex justify-between text-muted"><dt>Subtotal · {units} item{units === 1 ? '' : 's'}</dt><dd className="num">{money(fromCents(totals.subtotalCents))}</dd></div>
            {canDiscount && cart.length > 0 && (
              <div className="flex items-center justify-between text-muted">
                <dt>Cart discount</dt>
                <dd>
                  <Input
                    aria-label="Cart discount"
                    inputMode="decimal"
                    value={cartDiscount || ''}
                    placeholder="0"
                    onChange={(e) => setCartDiscount(Math.max(0, Number(e.target.value.replace(/[^\d.]/g, '')) || 0))}
                    className="h-7 w-28 text-right text-[12px]"
                  />
                </dd>
              </div>
            )}
            {totals.discountCents > 0 && <div className="flex justify-between text-muted"><dt>Discount</dt><dd className="num">−{money(fromCents(totals.discountCents))}</dd></div>}
            {totals.taxCents > 0 && <div className="flex justify-between text-muted"><dt>{taxInclusive ? 'VAT (included)' : 'VAT'}</dt><dd className="num">{money(fromCents(totals.taxCents))}</dd></div>}
            <div className="flex items-baseline justify-between pt-1.5"><dt className="text-[14px] font-semibold">Total</dt><dd className="text-[22px] font-semibold tracking-[-0.015em] num">{money(fromCents(totals.totalCents))}</dd></div>
          </dl>
          <div className="mt-3 flex gap-2">
            <Button size="lg" onClick={reset} disabled={!cart.length && !customer}>Clear</Button>
            <Button size="lg" variant="primary" className="flex-1" disabled={!cart.length || rxIssues.length > 0} onClick={() => setPaying(true)}>
              Charge {cart.length > 0 && money(fromCents(totals.totalCents))} <kbd className="ml-1 rounded bg-white/15 px-1 text-[10.5px]">F9</kbd>
            </Button>
          </div>
        </div>
      </aside>

      <PaymentModal
        open={paying}
        onClose={() => setPaying(false)}
        cart={cart}
        cartDiscount={cartDiscount}
        totalCents={totals.totalCents}
        customer={customer}
        prescriptionId={prescription?.id ?? null}
        onPaid={onPaid}
        onError={(e) => {
          if (e instanceof ApiError && e.status === 422) qc.invalidateQueries({ queryKey: ['pos-search'] });
        }}
      />
      <PrescriptionPicker open={rxPicker} onClose={() => setRxPicker(false)} onPick={(rx) => { loadPrescription(rx); setRxPicker(false); }} today={today()} />
      <ReceiptModal saleId={receiptFor} onClose={() => { setReceiptFor(null); searchRef.current?.focus(); }} title="Sale complete" />
    </div>
  );
}
