import { useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Pencil, Tags, Trash2, Upload } from 'lucide-react';
import { api, downloadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDebounced } from '@/lib/hooks';
import { useFormat } from '@/lib/settings';
import { Page } from '@/components/layout/AppLayout';
import {
  Alert, Badge, Button, Card, DataTable, DetailList, EmptyState, ErrorState, IconButton, Input, PageHeader, PageLoader, Pagination, SearchInput, Toolbar, useToast,
} from '@/components/ui';
import { ActiveBadge } from '@/components/StatusBadges';
import { ProductPicker } from '@/components/ProductPicker';
import { SchemeFormModal, type Scheme } from './SchemesPage';

interface PriceRow { productId: number; sku: string; name: string; strength: string | null; unit: string; sellingPrice: number; unitPrice: number; updatedAt: string; updatedByName: string | null }

/** Minimal CSV reader (quoted fields, commas, CRLF) for price-list imports. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 1; } else if (ch === '"') quoted = false; else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

export function SchemeDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const { money, amount, currency, dateTime } = useFormat();
  const canManage = can('insurance.manage');
  const [editing, setEditing] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const term = useDebounced(search, 250);
  /** Unsaved changes: product id → new price (null = remove). */
  const [draft, setDraft] = useState<Map<number, { price: string; name: string; sellingPrice: number; unit: string; isNew: boolean }>>(new Map());
  const [importError, setImportError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const scheme = useQuery({ queryKey: ['insurance-scheme', id], queryFn: () => api.get<Scheme>(`/insurance/schemes/${id}`) });
  const prices = useQuery({
    queryKey: ['insurance-prices', id, term, page],
    queryFn: () => api.get<{ data: PriceRow[]; total: number; page: number; pageSize: number }>(`/insurance/schemes/${id}/prices`, { search: term, page, pageSize: 50 }),
    placeholderData: (p) => p,
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['insurance-prices', id] });
    qc.invalidateQueries({ queryKey: ['insurance-schemes'] });
  };
  const save = useMutation({
    mutationFn: () => api.put<{ changed: number }>(`/insurance/schemes/${id}/prices`, {
      prices: [...draft].map(([productId, d]) => ({ productId, unitPrice: d.price.trim() === '' ? null : Number(d.price) })),
    }),
    onSuccess: (r) => { setDraft(new Map()); refresh(); toast.success(r.changed ? `${r.changed} price${r.changed === 1 ? '' : 's'} saved` : 'No changes'); },
    onError: (e) => toast.error('Prices not saved', (e as Error).message),
  });
  const importCsv = useMutation({
    mutationFn: (rows: { sku: string; unitPrice: string }[]) => api.post<{ changed: number }>(`/insurance/schemes/${id}/prices/import`, { rows }),
    onSuccess: (r) => { setImportError(null); refresh(); toast.success('Price list imported', `${r.changed} price${r.changed === 1 ? '' : 's'} added or changed.`); },
    onError: (e) => setImportError((e as Error).message),
  });

  const onFile = async (file: File) => {
    setImportError(null);
    const rows = parseCsv(await file.text());
    const header = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
    const skuCol = header.findIndex((h) => h === 'sku');
    let priceCol = header.findIndex((h) => h.includes('scheme price'));
    if (priceCol < 0) priceCol = header.findIndex((h) => h === 'price' || h === 'unit price');
    if (skuCol < 0 || priceCol < 0) {
      setImportError('The file needs a "SKU" column and a "Scheme price" (or "Price") column. Export the current list to get the format.');
      return;
    }
    const body = rows.slice(1).map((r) => ({ sku: (r[skuCol] ?? '').trim(), unitPrice: (r[priceCol] ?? '').replace(/[^\d.]/g, '') })).filter((r) => r.sku);
    if (!body.length) { setImportError('The file has no price rows.'); return; }
    importCsv.mutate(body);
  };

  if (scheme.isLoading) return <PageLoader />;
  if (scheme.error || !scheme.data) return <Page><ErrorState error={scheme.error} onRetry={scheme.refetch} /></Page>;
  const s = scheme.data;
  const pending = [...draft.entries()];
  const newRows = pending.filter(([, d]) => d.isNew);
  const set = (productId: number, d: { price: string; name: string; sellingPrice: number; unit: string; isNew: boolean }) => setDraft((m) => new Map(m).set(productId, d));
  const discard = (productId: number) => setDraft((m) => { const n = new Map(m); n.delete(productId); return n; });

  return (
    <Page>
      <PageHeader
        title={s.name}
        breadcrumbs={[{ label: 'Insurance schemes', to: '/insurance/schemes' }, { label: s.code }]}
        meta={<ActiveBadge status={s.status} />}
        actions={canManage && <Button icon={<Pencil className="size-3.5" />} onClick={() => setEditing(true)}>Edit scheme</Button>}
      />
      <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
        <Card title="Terms" className="self-start">
          <DetailList columns={1} items={[
            { label: 'Co-pay', value: `${Number(s.copayPercent)}% paid by the patient` },
            { label: 'Covers', value: s.coverage === 'all_products' ? 'All medicines — unlisted ones at the normal price' : 'Only medicines on the price list' },
            { label: 'Prescription', value: s.requiresPrescription ? 'Required for every insured sale' : 'Not required' },
            { label: 'Pays within', value: `${s.claimTermsDays} days of submission` },
            { label: 'Contact', value: [s.contactName, s.phone, s.email].filter(Boolean).join(' · ') || null },
            { label: 'Address', value: s.address },
            { label: 'Notes', value: s.notes },
          ]} />
        </Card>

        <Card flush title="Agreed price list" description={`Price per selling unit, in ${currency}. Prices apply at the till as soon as they are saved.`}
          actions={
            <div className="flex flex-wrap gap-2">
              <Button size="sm" icon={<Download className="size-3.5" />} onClick={() => downloadFile(`/insurance/schemes/${id}/prices/export`, undefined, `${s.code.toLowerCase()}-price-list.csv`).catch((e) => toast.error('Export failed', e.message))}>Export CSV</Button>
              {canManage && <Button size="sm" icon={<Upload className="size-3.5" />} loading={importCsv.isPending} onClick={() => fileRef.current?.click()}>Import CSV</Button>}
              <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onFile(f); }} />
            </div>
          }>
          {importError && <div className="px-4 pt-3"><Alert tone="danger" title="Import failed">{importError}</Alert></div>}
          {canManage && (
            <div className="border-b border-line px-4 py-3">
              <ProductPicker
                placeholder="Add a medicine to the list — search name, SKU or scan"
                onPick={(p) => set(p.id, { price: '', name: p.name, sellingPrice: Number(p.sellingPrice), unit: p.unit, isNew: true })}
              />
              {newRows.length > 0 && (
                <div className="mt-3 space-y-2">
                  {newRows.map(([productId, d]) => (
                    <div key={productId} className="flex flex-wrap items-center gap-2 text-[13px]">
                      <Badge tone="brand">New</Badge>
                      <span className="min-w-0 flex-1 font-medium">{d.name} <span className="text-muted">· normal {money(d.sellingPrice)} / {d.unit}</span></span>
                      <Input aria-label={`Scheme price for ${d.name}`} inputMode="decimal" prefix={currency} value={d.price} autoFocus
                        onChange={(e) => set(productId, { ...d, price: e.target.value.replace(/[^\d.]/g, '') })} className="w-36" />
                      <IconButton label="Discard" size="sm" onClick={() => discard(productId)}><Trash2 className="size-3.5" /></IconButton>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <Toolbar>
            <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search the list" className="w-full sm:w-64" />
            {pending.length > 0 && (
              <div className="ml-auto flex items-center gap-2">
                <span className="text-[12.5px] text-muted">{pending.length} unsaved change{pending.length === 1 ? '' : 's'}</span>
                <Button size="sm" onClick={() => setDraft(new Map())}>Discard</Button>
                <Button size="sm" variant="primary" loading={save.isPending}
                  disabled={pending.some(([, d]) => d.isNew && !(Number(d.price) > 0))}
                  onClick={() => save.mutate()}>Save prices</Button>
              </div>
            )}
          </Toolbar>
          <DataTable
            rows={prices.data?.data} loading={prices.isLoading} error={prices.error} onRetry={prices.refetch} rowKey={(r) => r.productId}
            empty={<EmptyState icon={Tags} title={term ? 'No matching medicines' : 'No agreed prices yet'} description={canManage && !term ? 'Add medicines above, or import the price list the insurer sent as a CSV file.' : undefined} />}
            rowClassName={(r) => (draft.get(r.productId)?.price === '' ? 'opacity-50 line-through' : undefined)}
            columns={[
              { key: 'name', header: 'Medicine', cell: (r) => <div><p className="font-medium">{r.name}</p><p className="text-[12px] text-muted">{r.sku} · per {r.unit}</p></div> },
              { key: 'normal', header: 'Normal price', align: 'right', cell: (r) => <span className="text-muted num">{amount(Number(r.sellingPrice))}</span>, hideBelow: 'sm' },
              {
                key: 'scheme', header: 'Scheme price', align: 'right',
                cell: (r) => {
                  const d = draft.get(r.productId);
                  return canManage ? (
                    <Input aria-label={`Scheme price for ${r.name}`} inputMode="decimal" value={d ? d.price : String(Number(r.unitPrice))}
                      onChange={(e) => {
                        const v = e.target.value.replace(/[^\d.]/g, '');
                        if (Number(v) === Number(r.unitPrice) && v !== '') discard(r.productId);
                        else set(r.productId, { price: v, name: r.name, sellingPrice: Number(r.sellingPrice), unit: r.unit, isNew: false });
                      }}
                      className="ml-auto w-28 text-right" />
                  ) : <span className="font-medium num">{amount(Number(r.unitPrice))}</span>;
                },
              },
              {
                key: 'diff', header: 'vs normal', align: 'right', hideBelow: 'md',
                cell: (r) => {
                  const pct = ((Number(r.unitPrice) - Number(r.sellingPrice)) / Number(r.sellingPrice)) * 100;
                  return <span className={pct < 0 ? 'text-warning num' : 'text-muted num'}>{pct > 0 ? '+' : ''}{pct.toFixed(0)}%</span>;
                },
              },
              { key: 'updated', header: 'Last changed', cell: (r) => <span className="text-[12px] text-muted">{dateTime(r.updatedAt)}{r.updatedByName ? ` · ${r.updatedByName}` : ''}</span>, hideBelow: 'xl' },
              ...(canManage ? [{
                key: 'remove', header: '', align: 'right' as const,
                cell: (r: PriceRow) => (
                  <IconButton label={`Remove ${r.name} from the list`} size="sm" onClick={() => set(r.productId, { price: '', name: r.name, sellingPrice: Number(r.sellingPrice), unit: r.unit, isNew: false })}>
                    <Trash2 className="size-3.5" />
                  </IconButton>
                ),
              }] : []),
            ]}
          />
          {prices.data && <Pagination page={prices.data.page} pageSize={prices.data.pageSize} total={prices.data.total} onChange={setPage} />}
        </Card>
      </div>
      <SchemeFormModal open={editing} onClose={() => setEditing(false)} scheme={s} />
    </Page>
  );
}
