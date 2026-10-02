import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, Package, Pencil, Plus, Printer, Tag } from 'lucide-react';
import { MEDICINE_TYPES, PRODUCT_STATUSES, PRODUCT_TYPES } from '@dawa/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDebounced, useListState } from '@/lib/hooks';
import { useFormat } from '@/lib/settings';
import type { Option, Paginated, ProductRow } from '@/lib/types';
import { Page } from '@/components/layout/AppLayout';
import {
  Badge, Button, ButtonLink, Card, DataTable, Dropdown, EmptyState, IconButton, MenuItem, PageHeader, Pagination, SearchInput, Select, Toolbar, useToast,
} from '@/components/ui';
import { ExpiryBadge, RxTag, StockBadge } from '@/components/StatusBadges';
import { ExportButton } from '@/components/Filters';

export function useCategories() {
  return useQuery({ queryKey: ['categories'], queryFn: () => api.get<(Option & { productCount: number; description: string | null })[]>('/categories'), staleTime: 300_000 });
}

export const MedicinesPage = () => <ProductsPage medicinesOnly />;

export function ProductsPage({ medicinesOnly = false }: { medicinesOnly?: boolean }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const { amount, currency, date, today } = useFormat();
  const [s, set] = useListState({ search: '', categoryId: '', productType: '', stockStatus: '', status: '', requiresPrescription: '', sort: 'name', order: 'asc' });
  const [term, setTerm] = useState(s.search);
  const debounced = useDebounced(term, 250);
  useEffect(() => set({ search: debounced }), [debounced]); // eslint-disable-line react-hooks/exhaustive-deps
  const [selected, setSelected] = useState<Set<number | string>>(new Set());
  const categories = useCategories();
  const query = {
    page: s.page, pageSize: s.pageSize, search: s.search, categoryId: s.categoryId, productType: s.productType, stockStatus: s.stockStatus,
    status: s.status, requiresPrescription: s.requiresPrescription, sort: s.sort, order: s.order, medicinesOnly: medicinesOnly || undefined,
  };
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['products', query],
    queryFn: () => api.get<Paginated<ProductRow>>('/products', query),
    placeholderData: (p) => p,
  });
  const bulk = useMutation({
    mutationFn: (status: string) => api.post<{ updated: number }>('/products/bulk-status', { ids: [...selected], status }),
    onSuccess: (r) => {
      toast.success(`${r.updated} product(s) updated`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (e) => toast.error('Update failed', (e as Error).message),
  });
  const t = today();
  const canManage = can('products.manage');

  return (
    <Page wide>
      <PageHeader
        title={medicinesOnly ? 'Medicines' : 'All products'}
        description={medicinesOnly ? 'Tablets, capsules, syrups, injections and other dosage forms.' : 'Medicines, devices, supplements and personal care.'}
        actions={
          <>
            <ExportButton path="/products" query={query} />
            {canManage && <ButtonLink to="/inventory/products/new" variant="primary" icon={<Plus className="size-3.5" />}>Add product</ButtonLink>}
          </>
        }
      />
      <Card flush>
        <Toolbar>
          <SearchInput value={term} onChange={setTerm} placeholder="Name, generic, SKU or barcode" className="w-full sm:w-72" />
          <Select value={s.categoryId} onChange={(e) => set({ categoryId: e.target.value })} className="w-44" aria-label="Category">
            <option value="">All categories</option>
            {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Select value={s.productType} onChange={(e) => set({ productType: e.target.value })} className="w-40" aria-label="Type">
            <option value="">All types</option>
            {Object.entries(PRODUCT_TYPES).filter(([k]) => !medicinesOnly || MEDICINE_TYPES.includes(k as never)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Select value={s.stockStatus} onChange={(e) => set({ stockStatus: e.target.value })} className="w-36" aria-label="Stock">
            <option value="">Any stock</option>
            <option value="in_stock">In stock</option>
            <option value="low_stock">Low stock</option>
            <option value="critical">Critical</option>
            <option value="out_of_stock">Out of stock</option>
          </Select>
          <Select value={s.requiresPrescription} onChange={(e) => set({ requiresPrescription: e.target.value })} className="w-40" aria-label="Prescription">
            <option value="">Rx and OTC</option>
            <option value="true">Prescription only</option>
            <option value="false">Over the counter</option>
          </Select>
          <Select value={s.status} onChange={(e) => set({ status: e.target.value })} className="w-32" aria-label="Status">
            <option value="">Any status</option>
            {Object.entries(PRODUCT_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Toolbar>
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-line bg-brand-50/60 px-3 py-2 text-[12.5px]">
            <span className="font-medium">{selected.size} selected</span>
            <Button size="sm" icon={<Printer className="size-3.5" />} onClick={() => navigate(`/inventory/labels?ids=${[...selected].join(',')}`)}>Print labels</Button>
            {canManage && (
              <>
                <Button size="sm" onClick={() => bulk.mutate('active')} loading={bulk.isPending}>Mark active</Button>
                <Button size="sm" onClick={() => bulk.mutate('inactive')}>Mark inactive</Button>
                <Button size="sm" onClick={() => bulk.mutate('discontinued')}>Discontinue</Button>
              </>
            )}
            <button className="ml-auto text-muted hover:text-fg" onClick={() => setSelected(new Set())}>Clear selection</button>
          </div>
        )}
        <DataTable
          rows={data?.data}
          loading={isLoading}
          error={error}
          onRetry={refetch}
          rowKey={(r) => r.id}
          selectable
          selected={selected}
          onSelectedChange={setSelected}
          sort={s.sort}
          order={s.order as 'asc' | 'desc'}
          onSort={(sort, order) => set({ sort, order })}
          onRowClick={(r) => navigate(`/inventory/products/${r.id}`)}
          rowClassName={(r) => (r.status !== 'active' ? 'opacity-60' : undefined)}
          empty={
            <EmptyState
              icon={Package}
              title={s.search || s.categoryId || s.stockStatus ? 'No products match these filters' : 'No products yet'}
              description={s.search ? 'Try another name, or search by generic name or barcode.' : 'Add products to start tracking stock.'}
              action={canManage && !s.search && <ButtonLink to="/inventory/products/new" variant="primary">Add product</ButtonLink>}
            />
          }
          columns={[
            {
              key: 'name', header: 'Product', sortKey: 'name',
              cell: (r) => (
                <div className="min-w-0 max-w-[190px] sm:max-w-[340px]">
                  <p className="flex items-center gap-1.5 truncate font-medium">
                    <span className="truncate">{r.name}</span>
                    {r.requiresPrescription && <RxTag />}
                  </p>
                  <p className="truncate text-[12px] text-muted">{[r.genericName, r.dosageForm].filter(Boolean).join(' · ') || PRODUCT_TYPES[r.productType as keyof typeof PRODUCT_TYPES]}</p>
                </div>
              ),
            },
            { key: 'sku', header: 'SKU', sortKey: 'sku', cell: (r) => <span className="font-mono text-[12px] text-muted">{r.sku}</span>, hideBelow: 'md' },
            { key: 'cat', header: 'Category', sortKey: 'category', cell: (r) => r.categoryName ?? <span className="text-faint">—</span>, hideBelow: 'lg' },
            {
              key: 'stock', header: 'Stock', align: 'right', sortKey: 'stock',
              cell: (r) => (
                <span className="num">
                  <span className="font-medium">{r.sellable.toLocaleString()}</span>
                  <span className="text-muted"> {r.unit}</span>
                </span>
              ),
            },
            { key: 'reorder', header: 'Reorder', align: 'right', cell: (r) => <span className="text-muted num">{r.reorderLevel}</span>, hideBelow: 'xl' },
            { key: 'price', header: `Price (${currency})`, align: 'right', sortKey: 'sellingPrice', cell: (r) => <span className="num">{amount(r.sellingPrice)}</span>, hideBelow: 'sm' },
            { key: 'expiry', header: 'Next expiry', cell: (r) => <ExpiryBadge date={r.nearestExpiry} today={t} format={date} />, hideBelow: 'lg' },
            { key: 'status', header: 'Status', cell: (r) => (r.status === 'active' ? <StockBadge status={r.stockStatus} /> : <Badge>{PRODUCT_STATUSES[r.status as keyof typeof PRODUCT_STATUSES]}</Badge>) },
            {
              key: 'actions', header: '', align: 'right', headerClassName: 'w-10',
              cell: (r) => (
                <div onClick={(e) => e.stopPropagation()}>
                  <Dropdown trigger={() => <IconButton label="Actions" size="sm"><MoreHorizontal className="size-4" /></IconButton>}>
                    {(close) => (
                      <>
                        <Link to={`/inventory/products/${r.id}`} onClick={close}><MenuItem icon={<Package />}>View details</MenuItem></Link>
                        {canManage && <Link to={`/inventory/products/${r.id}/edit`} onClick={close}><MenuItem icon={<Pencil />}>Edit</MenuItem></Link>}
                        <Link to={`/inventory/labels?ids=${r.id}`} onClick={close}><MenuItem icon={<Tag />}>Print shelf label</MenuItem></Link>
                      </>
                    )}
                  </Dropdown>
                </div>
              ),
            },
          ]}
        />
        {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={(page) => set({ page }, false)} onPageSizeChange={(pageSize) => set({ pageSize })} />}
      </Card>
    </Page>
  );
}
