import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Receipt as ReceiptIcon } from 'lucide-react';
import { SALE_PAYMENT_TYPES } from '@dawa/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useListState } from '@/lib/hooks';
import { useFormat } from '@/lib/settings';
import { Page } from '@/components/layout/AppLayout';
import { ButtonLink, Card, DataTable, EmptyState, PageHeader, Pagination, SearchInput, Select, Toolbar } from '@/components/ui';
import { DateRangeFilter, ExportButton } from '@/components/Filters';
import { PaymentStatusBadge, SaleStatusBadge } from '@/components/StatusBadges';
import { useDebounced } from '@/lib/hooks';
import { useEffect, useState } from 'react';

interface SaleRow {
  id: number; invoiceNo: string; createdAt: string; total: number; discountTotal: number; balanceDue: number; paymentType: string;
  paymentStatus: string; status: string; customerName: string | null; cashierName: string; units: number;
}

export function useStaffOptions(enabled = true) {
  return useQuery({ queryKey: ['user-options'], queryFn: () => api.get<{ id: number; fullName: string }[]>('/users/options'), enabled, staleTime: 300_000 });
}

export function SalesPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const { amount, dateTime, currency, money, today } = useFormat();
  const t = today();
  const [s, set] = useListState({ from: t, to: t, search: '', paymentStatus: '', paymentType: '', cashierId: '', customerId: '' });
  const [term, setTerm] = useState(s.search);
  const debounced = useDebounced(term, 300);
  useEffect(() => set({ search: debounced }), [debounced]); // eslint-disable-line react-hooks/exhaustive-deps
  const staff = useStaffOptions(can('sales.view_all'));
  const query = { from: s.from, to: s.to, search: s.search, customerId: s.customerId, paymentStatus: s.paymentStatus, paymentType: s.paymentType, cashierId: s.cashierId, page: s.page, pageSize: s.pageSize };
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['sales', query],
    queryFn: () => api.get<{ data: SaleRow[]; total: number; page: number; pageSize: number; sumTotal: number }>('/sales', query),
    placeholderData: (p) => p,
  });

  return (
    <Page>
      <PageHeader
        title="Invoices"
        description={can('sales.view_all') ? 'Every completed sale, with payment and return status.' : 'Sales you have completed.'}
        actions={
          <>
            <ExportButton path="/sales" query={query} />
            {can('pos.sell') && <ButtonLink to="/pos" variant="primary">New sale</ButtonLink>}
          </>
        }
      />
      <Card flush>
        <Toolbar>
          <SearchInput value={term} onChange={setTerm} placeholder="Invoice, customer or phone" className="w-full sm:w-64" />
          <DateRangeFilter value={{ from: s.from, to: s.to }} onChange={(r) => set(r)} today={t} />
          <Select value={s.paymentStatus} onChange={(e) => set({ paymentStatus: e.target.value })} className="w-36" aria-label="Payment status">
            <option value="">Any payment</option>
            <option value="paid">Paid</option>
            <option value="partial">Partly paid</option>
            <option value="unpaid">Unpaid</option>
          </Select>
          <Select value={s.paymentType} onChange={(e) => set({ paymentType: e.target.value })} className="w-36" aria-label="Method">
            <option value="">Any method</option>
            {Object.entries(SALE_PAYMENT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          {can('sales.view_all') && (
            <Select value={s.cashierId} onChange={(e) => set({ cashierId: e.target.value })} className="w-40" aria-label="Staff">
              <option value="">All staff</option>
              {staff.data?.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
            </Select>
          )}
          {data && <span className="ml-auto text-[12.5px] text-muted">Total <b className="text-fg num">{money(data.sumTotal)}</b></span>}
        </Toolbar>
        <DataTable
          rows={data?.data}
          loading={isLoading}
          error={error}
          onRetry={refetch}
          rowKey={(r) => r.id}
          onRowClick={(r) => navigate(`/sales/${r.id}`)}
          empty={<EmptyState icon={ReceiptIcon} title="No invoices in this period" description="Try a different date range or clear the filters." />}
          columns={[
            { key: 'inv', header: 'Invoice', cell: (r) => <span className="font-medium">{r.invoiceNo}</span> },
            { key: 'date', header: 'Date', cell: (r) => <span className="text-muted num">{dateTime(r.createdAt)}</span>, hideBelow: 'md' },
            { key: 'cust', header: 'Customer', cell: (r) => r.customerName ?? <span className="text-muted">Walk-in</span> },
            { key: 'staff', header: 'Staff', cell: (r) => r.cashierName, hideBelow: 'lg' },
            { key: 'units', header: 'Units', align: 'right', cell: (r) => <span className="num">{r.units}</span>, hideBelow: 'xl' },
            { key: 'disc', header: 'Discount', align: 'right', cell: (r) => (r.discountTotal > 0 ? <span className="num">{amount(r.discountTotal)}</span> : <span className="text-faint">—</span>), hideBelow: 'xl' },
            { key: 'total', header: `Total (${currency})`, align: 'right', cell: (r) => <span className="font-medium num">{amount(r.total)}</span> },
            { key: 'method', header: 'Method', cell: (r) => SALE_PAYMENT_TYPES[r.paymentType as keyof typeof SALE_PAYMENT_TYPES], hideBelow: 'lg' },
            { key: 'pay', header: 'Payment', cell: (r) => <PaymentStatusBadge status={r.paymentStatus} /> },
            { key: 'status', header: 'Status', cell: (r) => <SaleStatusBadge status={r.status} />, hideBelow: 'md' },
          ]}
        />
        {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={(page) => set({ page }, false)} onPageSizeChange={(pageSize) => set({ pageSize })} />}
      </Card>
    </Page>
  );
}
