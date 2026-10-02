import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PackageCheck, PackagePlus, Printer } from 'lucide-react';
import { addDays } from '@dawa/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useListState } from '@/lib/hooks';
import { useFormat } from '@/lib/settings';
import { Page } from '@/components/layout/AppLayout';
import { Badge, Button, ButtonLink, Card, DataTable, DetailList, EmptyState, ErrorState, PageHeader, PageLoader, Pagination, SearchInput, Select, Toolbar } from '@/components/ui';
import { DateRangeFilter } from '@/components/Filters';
import { useSupplierOptions } from '../inventory/ProductFormPage';

interface GrnRow { id: number; grnNumber: string; receivedDate: string; dueDate: string; totalCost: number; supplierInvoiceNo: string | null; supplierId: number; supplierName: string; purchaseOrderId: number | null; poNumber: string | null; receivedByName: string; lineCount: number; paid: number }

export function ReceiptsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const { amount, date, currency, today } = useFormat();
  const t = today();
  const suppliers = useSupplierOptions();
  const [s, set] = useListState({ search: '', supplierId: '', from: addDays(t, -89), to: t });
  const query = { search: s.search, supplierId: s.supplierId, from: s.from, to: s.to, page: s.page, pageSize: s.pageSize };
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['receipts', query],
    queryFn: () => api.get<{ data: GrnRow[]; total: number; page: number; pageSize: number }>('/purchasing/receipts', query),
    placeholderData: (p) => p,
  });
  return (
    <Page>
      <PageHeader title="Receive stock" description="Goods received notes. Receiving against an order keeps the order status up to date."
        actions={can('purchasing.receive') && (
          <>
            <ButtonLink to="/purchasing/orders?status=ordered">Receive against an order</ButtonLink>
            <ButtonLink to="/purchasing/receipts/new" variant="primary" icon={<PackagePlus className="size-3.5" />}>Direct delivery</ButtonLink>
          </>
        )} />
      <Card flush>
        <Toolbar>
          <SearchInput value={s.search} onChange={(v) => set({ search: v })} placeholder="GRN, PO, invoice or supplier" className="w-full sm:w-64" />
          <Select value={s.supplierId} onChange={(e) => set({ supplierId: e.target.value })} className="w-52" aria-label="Supplier"><option value="">All suppliers</option>{suppliers.data?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>
          <DateRangeFilter value={{ from: s.from, to: s.to }} onChange={(r) => set(r)} today={t} />
        </Toolbar>
        <DataTable
          rows={data?.data} loading={isLoading} error={error} onRetry={refetch} rowKey={(r) => r.id}
          onRowClick={(r) => navigate(`/purchasing/receipts/${r.id}`)}
          empty={<EmptyState icon={PackageCheck} title="No deliveries in this period" />}
          columns={[
            { key: 'grn', header: 'Receipt', cell: (r) => <span className="font-medium">{r.grnNumber}</span> },
            { key: 'date', header: 'Received', cell: (r) => date(r.receivedDate) },
            { key: 'sup', header: 'Supplier', cell: (r) => r.supplierName },
            { key: 'po', header: 'Order', cell: (r) => r.poNumber ?? <span className="text-muted">Direct</span>, hideBelow: 'md' },
            { key: 'inv', header: 'Supplier invoice', cell: (r) => r.supplierInvoiceNo ?? '—', hideBelow: 'lg' },
            { key: 'lines', header: 'Lines', align: 'right', cell: (r) => <span className="num">{r.lineCount}</span>, hideBelow: 'lg' },
            { key: 'total', header: `Value (${currency})`, align: 'right', cell: (r) => <span className="font-medium num">{amount(r.totalCost)}</span> },
            { key: 'paid', header: 'Payment', cell: (r) => (r.paid >= r.totalCost - 0.009 ? <Badge tone="success">Paid</Badge> : r.paid > 0 ? <Badge tone="warning">Part paid</Badge> : <Badge tone={r.dueDate < t ? 'danger' : 'neutral'}>{r.dueDate < t ? 'Overdue' : 'Unpaid'}</Badge>), hideBelow: 'md' },
            { key: 'by', header: 'Received by', cell: (r) => r.receivedByName, hideBelow: 'xl' },
          ]}
        />
        {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={(page) => set({ page }, false)} />}
      </Card>
    </Page>
  );
}

interface GrnDetail { id: number; grnNumber: string; receivedDate: string; dueDate: string; totalCost: number; supplierInvoiceNo: string | null; notes: string | null; supplierId: number; supplierName: string; purchaseOrderId: number | null; poNumber: string | null; receivedByName: string; createdAt: string;
  items: { id: number; productId: number; productName: string; sku: string; unit: string; batchNumber: string; manufactureDate: string | null; expiryDate: string | null; quantity: number; unitCost: number; sellingPrice: number | null; lineTotal: number }[] }

export function GoodsReceiptDetailPage() {
  const { id } = useParams();
  const { money, amount, date, dateTime, currency } = useFormat();
  const { data: g, isLoading, error, refetch } = useQuery({ queryKey: ['receipt-grn', id], queryFn: () => api.get<GrnDetail>(`/purchasing/receipts/${id}`) });
  if (isLoading) return <PageLoader />;
  if (error || !g) return <Page><ErrorState error={error} onRetry={refetch} /></Page>;
  return (
    <Page>
      <PageHeader breadcrumbs={[{ label: 'Receive stock', to: '/purchasing/receipts' }, { label: g.grnNumber }]} title={g.grnNumber}
        description={<>From <Link to={`/purchasing/suppliers/${g.supplierId}`} className="text-brand-700 hover:underline">{g.supplierName}</Link> · received {date(g.receivedDate)} by {g.receivedByName}</>}
        actions={<Button icon={<Printer className="size-3.5" />} onClick={() => window.print()}>Print GRN</Button>} />
      <div className="print-area grid gap-4 lg:grid-cols-[1fr_300px]">
        <Card title="Batches received" flush>
          <DataTable rows={g.items} rowKey={(r) => r.id} columns={[
            { key: 'p', header: 'Product', cell: (r) => <Link to={`/inventory/products/${r.productId}`} className="hover:text-brand-700">{r.productName}<span className="block text-[11.5px] text-muted">{r.sku}</span></Link> },
            { key: 'b', header: 'Batch', cell: (r) => <span className="font-mono text-[12px]">{r.batchNumber}</span> },
            { key: 'm', header: 'Mfg', cell: (r) => (r.manufactureDate ? date(r.manufactureDate) : '—'), hideBelow: 'lg' },
            { key: 'e', header: 'Expiry', cell: (r) => (r.expiryDate ? date(r.expiryDate) : '—') },
            { key: 'q', header: 'Qty', align: 'right', cell: (r) => <span className="num">{r.quantity} {r.unit}</span> },
            { key: 'c', header: `Cost (${currency})`, align: 'right', cell: (r) => <span className="num">{amount(r.unitCost)}</span> },
            { key: 't', header: 'Total', align: 'right', cell: (r) => <span className="font-medium num">{amount(r.lineTotal)}</span> },
          ]} />
          <div className="flex justify-end border-t border-line px-4 py-3 text-[14px] font-semibold">Total&nbsp;<span className="num">{money(g.totalCost)}</span></div>
        </Card>
        <Card title="Details">
          <DetailList columns={1} items={[
            { label: 'Purchase order', value: g.purchaseOrderId ? <Link to={`/purchasing/orders/${g.purchaseOrderId}`} className="text-brand-700 hover:underline">{g.poNumber}</Link> : 'Direct delivery' },
            { label: 'Supplier invoice', value: g.supplierInvoiceNo },
            { label: 'Payment due', value: date(g.dueDate) },
            { label: 'Recorded', value: dateTime(g.createdAt) },
            { label: 'Notes', value: g.notes, hidden: !g.notes },
          ]} />
        </Card>
      </div>
    </Page>
  );
}
