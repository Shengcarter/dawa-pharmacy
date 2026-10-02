import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { api } from '@/lib/api';
import { useDebounced } from '@/lib/hooks';
import { useFormat } from '@/lib/settings';
import type { Paginated, ProductRow } from '@/lib/types';
import { RxTag } from './StatusBadges';

/** Type-ahead product search for document lines (orders, receipts, prescriptions). */
export function ProductPicker({ onPick, placeholder = 'Add a product — search name, SKU or scan barcode', exclude = [], showCost }: {
  onPick: (p: ProductRow) => void;
  placeholder?: string;
  exclude?: number[];
  showCost?: boolean;
}) {
  const { amount } = useFormat();
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const q = useDebounced(term.trim(), 200);
  const { data } = useQuery({
    queryKey: ['product-picker', q],
    queryFn: () => api.get<Paginated<ProductRow>>('/products', { search: q, pageSize: 10, status: 'active' }),
    enabled: q.length >= 1,
  });
  const results = (data?.data ?? []).filter((p) => !exclude.includes(p.id));
  useEffect(() => setCursor(0), [q]);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  const pick = (p: ProductRow) => {
    onPick(p);
    setTerm('');
    setOpen(false);
  };
  return (
    <div ref={box} className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
      <input
        value={term}
        onChange={(e) => { setTerm(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, results.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
          if (e.key === 'Enter') { e.preventDefault(); if (results[cursor]) pick(results[cursor]); }
        }}
        placeholder={placeholder}
        aria-label="Add product"
        className="h-8.5 w-full rounded-md border border-dashed border-line-strong bg-surface pl-8 pr-2.5 text-[13px] placeholder:text-faint focus:border-brand-600 focus:border-solid focus:outline-none focus:ring-3 focus:ring-[var(--ring)]"
      />
      {open && q.length >= 1 && (
        <div className="animate-pop absolute left-0 right-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-pop">
          {results.length ? results.map((p, i) => (
            <button key={p.id} type="button" onMouseEnter={() => setCursor(i)} onClick={() => pick(p)} className={`flex w-full items-center gap-3 rounded-md px-2.5 py-1.5 text-left ${i === cursor ? 'bg-hover' : ''}`}>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 truncate text-[13px]">{p.name}{p.requiresPrescription && <RxTag />}</span>
                <span className="block truncate text-[11.5px] text-muted">{p.sku} · {p.sellable} {p.unit} in stock</span>
              </span>
              <span className="shrink-0 text-[12px] text-muted num">{amount(showCost ? p.purchasePrice : p.sellingPrice)}</span>
            </button>
          )) : <p className="px-2.5 py-2 text-[12.5px] text-muted">No active products match.</p>}
        </div>
      )}
    </div>
  );
}
