import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { api } from '@/lib/api';
import { useFormat } from '@/lib/settings';
import { Page } from '@/components/layout/AppLayout';
import { Button, Card, EmptyState, Field, Input, PageHeader, Select } from '@/components/ui';
import { Barcode } from '@/components/Barcode';

interface LabelProduct { id: number; name: string; strength: string | null; sku: string; barcode: string | null; sellingPrice: number; unit: string }

/** Shelf / product labels with barcode and price, printed on A4 label sheets or a label printer. */
export function LabelsPage() {
  const [params] = useSearchParams();
  const { money, settings } = useFormat();
  const ids = (params.get('ids') ?? '').split(',').map(Number).filter(Boolean).slice(0, 60);
  const [copies, setCopies] = useState(1);
  const [layout, setLayout] = useState<'sheet' | 'single'>('sheet');
  const products = useQueries({ queries: ids.map((id) => ({ queryKey: ['product', String(id)], queryFn: () => api.get<LabelProduct>(`/products/${id}`) })) });
  const loaded = products.map((p) => p.data).filter(Boolean) as LabelProduct[];
  const labels = loaded.flatMap((p) => Array.from({ length: copies }, () => p));
  return (
    <Page>
      <PageHeader title="Print labels" description="Products without a manufacturer barcode print with their SKU (Code 128)."
        actions={<Button variant="primary" icon={<Printer className="size-3.5" />} disabled={!labels.length} onClick={() => window.print()}>Print</Button>} />
      {!ids.length ? (
        <Card><EmptyState title="No products selected" description="Select products on the product list and choose Print labels." /></Card>
      ) : (
        <>
          <Card className="mb-4">
            <div className="flex flex-wrap gap-4">
              <Field label="Copies of each">{(id) => <Input id={id} type="number" min={1} max={50} value={copies} onChange={(e) => setCopies(Math.max(1, Math.min(50, Number(e.target.value) || 1)))} className="w-24" />}</Field>
              <Field label="Layout">{(id) => <Select id={id} value={layout} onChange={(e) => setLayout(e.target.value as 'sheet' | 'single')} className="w-56"><option value="sheet">A4 sheet (3 columns)</option><option value="single">Label printer (one per label)</option></Select>}</Field>
            </div>
          </Card>
          <div className="overflow-x-auto rounded-lg border border-line bg-white p-4">
            <div className={layout === 'sheet' ? 'print-area grid grid-cols-3 gap-2 text-black' : 'print-area flex flex-col items-start gap-2 text-black'}>
              {labels.map((p, i) => (
                <div key={i} className="flex w-[62mm] flex-col items-center break-inside-avoid rounded border border-dashed border-black/30 px-2 py-1.5">
                  <p className="w-full truncate text-center text-[10px] text-black/60">{settings?.general.pharmacyName}</p>
                  <p className="w-full truncate text-center text-[11.5px] font-semibold">{p.name}</p>
                  <Barcode value={p.barcode ?? p.sku} height={34} moduleWidth={p.barcode ? 1.6 : 1.1} />
                  <p className="text-[13px] font-bold">{money(p.sellingPrice)} <span className="text-[10px] font-normal">/ {p.unit}</span></p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </Page>
  );
}
