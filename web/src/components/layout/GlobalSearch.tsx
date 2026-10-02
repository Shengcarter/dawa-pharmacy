import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, FileText, Package, Search, Truck, User, Receipt } from 'lucide-react';
import { api } from '@/lib/api';
import { useDebounced } from '@/lib/hooks';
import { useFormat } from '@/lib/settings';
import { cn } from '@/lib/cn';
import { Spinner } from '../ui';

interface SearchResults {
  products?: { id: number; name: string; sku: string; barcode: string | null; strength: string | null; genericName: string | null }[];
  customers?: { id: number; fullName: string; code: string; phone: string | null }[];
  suppliers?: { id: number; name: string; code: string }[];
  invoices?: { id: number; invoiceNo: string; total: number; customerName: string | null }[];
  purchaseOrders?: { id: number; poNumber: string; status: string; supplierName: string }[];
  prescriptions?: { id: number; rxNumber: string; status: string; customerName: string }[];
}

interface Hit { key: string; group: string; icon: typeof Package; title: string; sub?: string; to: string }

export function GlobalSearch() {
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { money } = useFormat();
  const q = useDebounced(term.trim(), 200);
  const { data, isFetching } = useQuery({
    queryKey: ['search', q],
    queryFn: () => api.get<SearchResults>('/search', { q }),
    enabled: q.length >= 2,
    staleTime: 10_000,
  });

  const hits = useMemo<Hit[]>(() => {
    if (!data || q.length < 2) return [];
    return [
      ...(data.products ?? []).map((p) => ({ key: `p${p.id}`, group: 'Products', icon: Package, title: `${p.name}`, sub: [p.sku, p.genericName].filter(Boolean).join(' · '), to: `/inventory/products/${p.id}` })),
      ...(data.invoices ?? []).map((s) => ({ key: `s${s.id}`, group: 'Invoices', icon: Receipt, title: s.invoiceNo, sub: `${s.customerName ?? 'Walk-in'} · ${money(s.total)}`, to: `/sales/${s.id}` })),
      ...(data.customers ?? []).map((c) => ({ key: `c${c.id}`, group: 'Customers', icon: User, title: c.fullName, sub: [c.code, c.phone].filter(Boolean).join(' · '), to: `/customers/${c.id}` })),
      ...(data.prescriptions ?? []).map((r) => ({ key: `r${r.id}`, group: 'Prescriptions', icon: ClipboardList, title: r.rxNumber, sub: r.customerName, to: `/prescriptions/${r.id}` })),
      ...(data.purchaseOrders ?? []).map((o) => ({ key: `o${o.id}`, group: 'Purchase orders', icon: FileText, title: o.poNumber, sub: o.supplierName, to: `/purchasing/orders/${o.id}` })),
      ...(data.suppliers ?? []).map((s) => ({ key: `u${s.id}`, group: 'Suppliers', icon: Truck, title: s.name, sub: s.code, to: `/purchasing/suppliers/${s.id}` })),
    ];
  }, [data, q, money]);

  useEffect(() => setCursor(0), [hits.length]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        input.current?.focus();
        setOpen(true);
      }
    };
    const onDoc = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDoc);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDoc);
    };
  }, []);

  const go = (hit: Hit) => {
    navigate(hit.to);
    setOpen(false);
    setTerm('');
    input.current?.blur();
  };

  let lastGroup = '';
  return (
    <div ref={box} className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
      <input
        ref={input}
        value={term}
        onChange={(e) => {
          setTerm(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, hits.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
          if (e.key === 'Enter' && hits[cursor]) go(hits[cursor]);
          if (e.key === 'Escape') { setOpen(false); input.current?.blur(); }
        }}
        placeholder="Search medicines, SKU, barcode, invoices, customers…"
        aria-label="Global search"
        className="h-8.5 w-full rounded-md border border-line bg-subtle pl-8 pr-14 text-[13px] placeholder:text-faint focus:border-brand-600 focus:bg-surface focus:outline-none focus:ring-3 focus:ring-[var(--ring)]"
      />
      <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-line bg-surface px-1.5 text-[10.5px] text-faint sm:block">Ctrl K</kbd>
      {open && q.length >= 2 && (
        <div className="animate-pop absolute left-0 right-0 z-40 mt-1.5 max-h-[70vh] overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-pop">
          {isFetching && !data ? (
            <div className="flex items-center gap-2 px-3 py-3 text-[12.5px] text-muted"><Spinner className="size-3.5" /> Searching…</div>
          ) : hits.length === 0 ? (
            <p className="px-3 py-3 text-[12.5px] text-muted">No results for “{q}”.</p>
          ) : (
            hits.map((h, i) => {
              const header = h.group !== lastGroup ? h.group : null;
              lastGroup = h.group;
              const Icon = h.icon;
              return (
                <div key={h.key}>
                  {header && <p className="px-2.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-[0.05em] text-faint">{header}</p>}
                  <button
                    type="button"
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => go(h)}
                    className={cn('flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left', i === cursor && 'bg-hover')}
                  >
                    <Icon className="size-3.5 shrink-0 text-muted" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px]">{h.title}</span>
                      {h.sub && <span className="block truncate text-[11.5px] text-muted">{h.sub}</span>}
                    </span>
                  </button>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
