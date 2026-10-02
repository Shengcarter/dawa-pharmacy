import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Barcode as BarcodeIcon, ImagePlus, MoreHorizontal, Pencil, SlidersHorizontal, Tag } from 'lucide-react';
import { BATCH_STATUSES, MOVEMENT_TYPES, PRODUCT_STATUSES, PRODUCT_TYPES } from '@dawa/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFormat } from '@/lib/settings';
import { cn } from '@/lib/cn';
import { Page } from '@/components/layout/AppLayout';
import {
  Badge, Button, ButtonLink, Card, DataTable, DetailList, Dropdown, EmptyState, ErrorState, Figure, IconButton, MenuItem, PageHeader, PageLoader,
  SummaryStrip, Tabs, useToast,
} from '@/components/ui';
import { ExpiryBadge, RxTag, StockBadge } from '@/components/StatusBadges';
import { Barcode } from '@/components/Barcode';
import { AdjustStockModal, EditBatchModal, type BatchLite } from './StockModals';

interface ProductDetail {
  id: number; sku: string; barcode: string | null; name: string; genericName: string | null; brandName: string | null; productType: string;
  categoryName: string | null; manufacturerName: string | null; supplierName: string | null; dosageForm: string | null; strength: string | null;
  unit: string; packSize: number; packSellingPrice: number | null; priceBreaks: { minQuantity: number; unitPrice: number }[]; purchasePrice?: number; sellingPrice: number; wholesalePrice: number | null; minSellingPrice: number | null;
  reorderLevel: number; maxStockLevel: number | null; requiresPrescription: boolean; isBatchTracked: boolean; taxRate: number; status: string;
  imagePath: string | null; description: string | null; storageInstructions: string | null; createdAt: string; updatedAt: string;
  createdByName: string | null; updatedByName: string | null; onHand: number; sellable: number; stockValue?: number; nearestExpiry: string | null;
  expiredQty: number; stockStatus: string;
  batches: (BatchLite & { manufactureDate: string | null; quantityReceived: number; unitCost?: number; receivedAt: string; supplierName: string | null; isExpired: boolean; daysToExpiry: number | null })[];
  suppliers: { supplierId: number; name: string; lastCost: number; lastSuppliedAt: string }[];
  last30Days: { units: number; revenue?: number; cost?: number };
}
interface Movement { id: number; movementType: string; quantity: number; quantityBefore: number; quantityAfter: number; reason: string | null; referenceType: string | null; referenceId: number | null; referenceNo: string | null; createdAt: string; userName: string; batchNumber: string }

export function referenceLink(m: { referenceType: string | null; referenceId: number | null }) {
  switch (m.referenceType) {
    case 'sale': return `/sales/${m.referenceId}`;
    case 'goods_receipt': return `/purchasing/receipts/${m.referenceId}`;
    case 'product': return `/inventory/products/${m.referenceId}`;
    case 'adjustment': return '/inventory/adjustments';
    case 'sale_return': return '/sales/returns';
    case 'transfer': return '/inventory/transfers';
    default: return null;
  }
}

export function ProductDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const { money, amount, date, dateTime, today, currency } = useFormat();
  const [tab, setTab] = useState<'batches' | 'movements' | 'details' | 'suppliers'>('batches');
  const [adjust, setAdjust] = useState<{ batchId: number | null } | null>(null);
  const [editBatch, setEditBatch] = useState<BatchLite | null>(null);
  const [showEmpty, setShowEmpty] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const { data: p, isLoading, error, refetch } = useQuery({ queryKey: ['product', id], queryFn: () => api.get<ProductDetail>(`/products/${id}`) });
  const movements = useQuery({
    queryKey: ['movements', { productId: id }],
    queryFn: () => api.get<{ data: Movement[] }>('/inventory/movements', { productId: id, pageSize: 50 }),
    enabled: tab === 'movements' && can('inventory.view'),
  });
  const genBarcode = useMutation({
    mutationFn: () => api.post<{ barcode: string }>(`/products/${id}/barcode`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['product', id] }); toast.success('Barcode assigned'); },
  });
  const upload = useMutation({
    mutationFn: (file: File) => api.upload(`/products/${id}/image`, file),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['product', id] }); toast.success('Image updated'); },
    onError: (e) => toast.error('Upload failed', (e as Error).message),
  });

  if (isLoading) return <PageLoader />;
  if (error || !p) return <Page><ErrorState error={error} onRetry={refetch} /></Page>;
  const t = today();
  const batches = p.batches.filter((b) => showEmpty || b.quantityOnHand > 0);
  const margin = p.purchasePrice !== undefined && p.sellingPrice > 0 ? ((p.sellingPrice - p.purchasePrice) / p.sellingPrice) * 100 : null;

  return (
    <Page>
      <PageHeader
        breadcrumbs={[{ label: 'Products', to: '/inventory/products' }, { label: p.sku }]}
        title={p.name}
        meta={
          <>
            {p.requiresPrescription && <RxTag />}
            {p.status === 'active' ? <StockBadge status={p.stockStatus} /> : <Badge>{PRODUCT_STATUSES[p.status as keyof typeof PRODUCT_STATUSES]}</Badge>}
          </>
        }
        description={[p.genericName, p.strength, p.dosageForm, p.categoryName].filter(Boolean).join(' · ')}
        actions={
          <>
            {can('inventory.adjust') && <Button icon={<SlidersHorizontal className="size-3.5" />} onClick={() => setAdjust({ batchId: null })}>Adjust stock</Button>}
            {can('products.manage') && <ButtonLink to={`/inventory/products/${p.id}/edit`} variant="primary" icon={<Pencil className="size-3.5" />}>Edit</ButtonLink>}
            <Dropdown trigger={() => <IconButton label="More actions"><MoreHorizontal className="size-4" /></IconButton>}>
              {(close) => (
                <>
                  <Link to={`/inventory/labels?ids=${p.id}`} onClick={close}><MenuItem icon={<Tag />}>Print shelf label</MenuItem></Link>
                  {can('products.manage') && !p.barcode && <MenuItem icon={<BarcodeIcon />} onClick={() => { close(); genBarcode.mutate(); }}>Generate barcode</MenuItem>}
                  {can('products.manage') && <MenuItem icon={<ImagePlus />} onClick={() => { close(); fileInput.current?.click(); }}>Upload image</MenuItem>}
                </>
              )}
            </Dropdown>
            <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])} />
          </>
        }
      />

      <SummaryStrip className="mb-4 lg:grid-cols-5">
        <Figure label="Sellable stock" value={`${p.sellable.toLocaleString()} ${p.unit}`} sub={p.expiredQty > 0 ? <span className="text-danger">{p.expiredQty} expired, blocked</span> : `Reorder at ${p.reorderLevel}`} tone={p.sellable <= p.reorderLevel ? 'warning' : undefined} />
        <Figure label="Selling price" value={money(p.sellingPrice)} sub={margin !== null ? `Margin ${margin.toFixed(1)}%` : p.taxRate > 0 ? `VAT ${p.taxRate}%` : 'VAT exempt'} />
        {p.stockValue !== undefined && <Figure label="Stock value" value={money(p.stockValue)} sub="At batch cost" />}
        <Figure label="Next expiry" value={p.nearestExpiry ? date(p.nearestExpiry) : '—'} sub={`${p.batches.filter((b) => b.quantityOnHand > 0).length} batch(es) in stock`} />
        <Figure label="Sold, last 30 days" value={`${p.last30Days.units.toLocaleString()} ${p.unit}`} sub={p.last30Days.revenue !== undefined ? money(p.last30Days.revenue) : undefined} />
      </SummaryStrip>

      <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
        <Card flush>
          <div className="px-4 pt-3">
            <Tabs
              value={tab}
              onChange={setTab}
              tabs={[
                { value: 'batches', label: 'Batches', count: p.batches.filter((b) => b.quantityOnHand > 0).length },
                ...(can('inventory.view') ? [{ value: 'movements' as const, label: 'Stock history' }] : []),
                { value: 'details', label: 'Details' },
                ...(p.suppliers.length ? [{ value: 'suppliers' as const, label: 'Suppliers', count: p.suppliers.length }] : []),
              ]}
            />
          </div>
          {tab === 'batches' && (
            <>
              <DataTable
                rows={batches}
                rowKey={(b) => b.id}
                rowClassName={(b) => (b.isExpired && b.quantityOnHand > 0 ? 'bg-danger-bg/50' : undefined)}
                empty={<EmptyState compact title="No stock" description="Receive stock from Purchasing to create a batch." />}
                columns={[
                  { key: 'no', header: 'Batch', cell: (b) => <span className="font-medium">{b.batchNumber}</span> },
                  { key: 'exp', header: 'Expiry', cell: (b) => <ExpiryBadge date={b.expiryDate} today={t} format={date} /> },
                  { key: 'qty', header: 'On hand', align: 'right', cell: (b) => <span className="num">{b.quantityOnHand.toLocaleString()} <span className="text-faint">/ {b.quantityReceived}</span></span> },
                  ...(p.purchasePrice !== undefined ? [{ key: 'cost', header: `Cost (${currency})`, align: 'right' as const, cell: (b: (typeof batches)[number]) => <span className="num">{amount(b.unitCost ?? 0)}</span>, hideBelow: 'md' as const }] : []),
                  { key: 'sup', header: 'Supplier', cell: (b) => b.supplierName ?? '—', hideBelow: 'lg' },
                  { key: 'rec', header: 'Received', cell: (b) => <span className="text-muted">{date(b.receivedAt)}</span>, hideBelow: 'lg' },
                  { key: 'status', header: 'Status', cell: (b) => (b.status === 'active' ? (b.isExpired ? <Badge tone="danger">Expired</Badge> : <Badge tone="success">Sellable</Badge>) : <Badge tone={b.status === 'quarantined' ? 'warning' : 'neutral'}>{BATCH_STATUSES[b.status as keyof typeof BATCH_STATUSES]}</Badge>) },
                  {
                    key: 'act', header: '', align: 'right',
                    cell: (b) => can('inventory.adjust') && b.status !== 'disposed' && (
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setEditBatch(b)}>Edit</Button>
                        <Button size="sm" variant="ghost" onClick={() => setAdjust({ batchId: b.id })}>Adjust</Button>
                      </div>
                    ),
                  },
                ]}
              />
              {p.batches.some((b) => b.quantityOnHand === 0) && (
                <div className="border-t border-line px-4 py-2">
                  <button className="text-[12.5px] text-muted hover:text-fg" onClick={() => setShowEmpty((s) => !s)}>{showEmpty ? 'Hide' : 'Show'} empty batches</button>
                </div>
              )}
            </>
          )}
          {tab === 'movements' && (
            <DataTable
              rows={movements.data?.data}
              loading={movements.isLoading}
              error={movements.error}
              rowKey={(m) => m.id}
              empty={<EmptyState compact title="No stock movements yet" />}
              columns={[
                { key: 'date', header: 'Date', cell: (m) => <span className="text-muted num">{dateTime(m.createdAt)}</span> },
                { key: 'type', header: 'Type', cell: (m) => MOVEMENT_TYPES[m.movementType as keyof typeof MOVEMENT_TYPES] },
                { key: 'batch', header: 'Batch', cell: (m) => m.batchNumber, hideBelow: 'md' },
                { key: 'qty', header: 'Change', align: 'right', cell: (m) => <span className={cn('font-medium num', m.quantity > 0 ? 'text-brand-700' : 'text-fg')}>{m.quantity > 0 ? '+' : ''}{m.quantity}</span> },
                { key: 'after', header: 'Balance', align: 'right', cell: (m) => <span className="text-muted num">{m.quantityAfter}</span> },
                { key: 'ref', header: 'Reference', cell: (m) => { const to = referenceLink(m); return to ? <Link to={to} className="text-brand-700 hover:underline">{m.referenceNo}</Link> : m.referenceNo ?? '—'; }, hideBelow: 'md' },
                { key: 'user', header: 'By', cell: (m) => m.userName, hideBelow: 'lg' },
              ]}
            />
          )}
          {tab === 'details' && (
            <div className="p-4">
              <DetailList
                columns={3}
                items={[
                  { label: 'SKU', value: <span className="font-mono">{p.sku}</span> },
                  { label: 'Barcode', value: p.barcode ? <span className="font-mono">{p.barcode}</span> : null },
                  { label: 'Product type', value: PRODUCT_TYPES[p.productType as keyof typeof PRODUCT_TYPES] },
                  { label: 'Brand', value: p.brandName },
                  { label: 'Manufacturer', value: p.manufacturerName },
                  { label: 'Default supplier', value: p.supplierName },
                  { label: 'Unit / pack', value: `${p.unit} · ${p.packSize} per pack` },
                  { label: 'Purchase price', value: p.purchasePrice !== undefined ? money(p.purchasePrice) : null, hidden: p.purchasePrice === undefined },
                  { label: 'Pack price', value: p.packSellingPrice ? `${money(p.packSellingPrice)} per ${p.packSize}` : null },
                  { label: 'Wholesale price', value: p.wholesalePrice ? money(p.wholesalePrice) : null },
                  { label: 'Quantity prices', value: p.priceBreaks?.length ? p.priceBreaks.map((b) => `${b.minQuantity}+ at ${money(b.unitPrice)}`).join(' · ') : null },
                  { label: 'Minimum price', value: p.minSellingPrice ? money(p.minSellingPrice) : null },
                  { label: 'VAT', value: p.taxRate > 0 ? `${p.taxRate}%` : 'Exempt' },
                  { label: 'Reorder / max', value: `${p.reorderLevel} / ${p.maxStockLevel ?? '—'}` },
                  { label: 'Batch tracking', value: p.isBatchTracked ? 'Batches and expiry tracked' : 'Not tracked' },
                  { label: 'Prescription', value: p.requiresPrescription ? 'Prescription only (Rx)' : 'Over the counter' },
                  { label: 'Storage', value: p.storageInstructions },
                  { label: 'Created', value: `${dateTime(p.createdAt)}${p.createdByName ? ` by ${p.createdByName}` : ''}` },
                  { label: 'Last updated', value: `${dateTime(p.updatedAt)}${p.updatedByName ? ` by ${p.updatedByName}` : ''}` },
                ]}
              />
              {p.description && <p className="mt-4 border-t border-line pt-4 text-[13px] leading-relaxed">{p.description}</p>}
            </div>
          )}
          {tab === 'suppliers' && (
            <DataTable
              rows={p.suppliers}
              rowKey={(s) => s.supplierId}
              columns={[
                { key: 'name', header: 'Supplier', cell: (s) => <Link to={`/purchasing/suppliers/${s.supplierId}`} className="hover:text-brand-700">{s.name}</Link> },
                { key: 'cost', header: `Last cost (${currency})`, align: 'right', cell: (s) => <span className="num">{amount(s.lastCost)}</span> },
                { key: 'when', header: 'Last delivery', cell: (s) => <span className="text-muted">{s.lastSuppliedAt ? date(s.lastSuppliedAt) : '—'}</span> },
              ]}
            />
          )}
        </Card>
        <div className="space-y-4">
          {p.imagePath && (
            <Card><img src={`/uploads/${p.imagePath}`} alt={p.name} className="mx-auto max-h-48 rounded object-contain" /></Card>
          )}
          <Card title="Barcode">
            {p.barcode ? (
              <div className="flex justify-center overflow-hidden rounded bg-white p-2"><Barcode value={p.barcode} /></div>
            ) : (
              <div className="text-center">
                <p className="text-[12.5px] text-muted">No barcode assigned.</p>
                {can('products.manage') && <Button size="sm" className="mt-3" loading={genBarcode.isPending} onClick={() => genBarcode.mutate()}>Generate internal barcode</Button>}
              </div>
            )}
          </Card>
        </div>
      </div>

      <AdjustStockModal
        open={adjust !== null}
        onClose={() => setAdjust(null)}
        productName={p.name}
        batches={p.batches.filter((b) => b.status !== 'disposed')}
        initialBatchId={adjust?.batchId ?? null}
      />
      <EditBatchModal open={editBatch !== null} onClose={() => setEditBatch(null)} batch={editBatch} />
    </Page>
  );
}
