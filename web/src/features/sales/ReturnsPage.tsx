import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Undo2 } from 'lucide-react';
import { REFUND_METHODS, RETURN_REASONS } from '@dawa/shared';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFormat } from '@/lib/settings';
import { useListState } from '@/lib/hooks';
import { Page } from '@/components/layout/AppLayout';
import { Alert, Badge, Button, Card, DataTable, EmptyState, Field, Input, Modal, PageHeader, Pagination, SearchInput, Toolbar } from '@/components/ui';
import { DateRangeFilter } from '@/components/Filters';
import { addDays } from '@dawa/shared';

interface ReturnRow { id: number; returnNo: string; createdAt: string; reason: string; refundMethod: string; totalAmount: number; refundAmount: number; balanceReduction: number; saleId: number; invoiceNo: string; customerName: string | null; processedByName: string; units: number; anyRestocked: boolean }

export function ReturnsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const { amount, dateTime, currency, today } = useFormat();
  const t = today();
  const [s, set] = useListState({ from: addDays(t, -29), to: t, search: '' });
  const [finding, setFinding] = useState(false);
  const query = { from: s.from, to: s.to, search: s.search, page: s.page, pageSize: s.pageSize };
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['returns', query],
    queryFn: () => api.get<{ data: ReturnRow[]; total: number; page: number; pageSize: number }>('/sales/returns', query),
    placeholderData: (p) => p,
  });
  return (
    <Page>
      <PageHeader title="Returns" description="Customer returns, refunds and what went back to stock."
        actions={can('sales.return') && <Button variant="primary" icon={<Undo2 className="size-3.5" />} onClick={() => setFinding(true)}>New return</Button>} />
      <Card flush>
        <Toolbar>
          <SearchInput value={s.search} onChange={(v) => set({ search: v })} placeholder="Return no., invoice or customer" className="w-full sm:w-64" />
          <DateRangeFilter value={{ from: s.from, to: s.to }} onChange={(r) => set(r)} today={t} />
        </Toolbar>
        <DataTable
          rows={data?.data} loading={isLoading} error={error} onRetry={refetch} rowKey={(r) => r.id}
          onRowClick={(r) => navigate(`/sales/${r.saleId}`)}
          empty={<EmptyState icon={Undo2} title="No returns in this period" />}
          columns={[
            { key: 'no', header: 'Return', cell: (r) => <span className="font-medium">{r.returnNo}</span> },
            { key: 'inv', header: 'Invoice', cell: (r) => r.invoiceNo },
            { key: 'date', header: 'Date', cell: (r) => <span className="text-muted num">{dateTime(r.createdAt)}</span>, hideBelow: 'md' },
            { key: 'cust', header: 'Customer', cell: (r) => r.customerName ?? <span className="text-muted">Walk-in</span>, hideBelow: 'lg' },
            { key: 'reason', header: 'Reason', cell: (r) => RETURN_REASONS[r.reason as keyof typeof RETURN_REASONS], hideBelow: 'md' },
            { key: 'stock', header: 'Stock', cell: (r) => (r.anyRestocked ? <Badge tone="success">Restocked</Badge> : <Badge>Not restocked</Badge>), hideBelow: 'lg' },
            { key: 'refund', header: `Value (${currency})`, align: 'right', cell: (r) => <span className="font-medium num">{amount(r.totalAmount)}</span> },
            { key: 'method', header: 'Refund', cell: (r) => (r.refundAmount > 0 ? REFUND_METHODS[r.refundMethod as keyof typeof REFUND_METHODS] : 'Balance reduced'), hideBelow: 'md' },
            { key: 'by', header: 'Processed by', cell: (r) => r.processedByName, hideBelow: 'xl' },
          ]}
        />
        {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={(page) => set({ page }, false)} />}
      </Card>
      <FindInvoiceModal open={finding} onClose={() => setFinding(false)} />
    </Page>
  );
}

function FindInvoiceModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [invoice, setInvoice] = useState('');
  const find = useMutation({
    mutationFn: () => api.get<{ id: number }>(`/sales/by-invoice/${encodeURIComponent(invoice.trim())}`),
    onSuccess: (s) => { onClose(); navigate(`/sales/${s.id}?return=1`); },
  });
  return (
    <Modal open={open} onClose={onClose} title="Find the original invoice" size="sm"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!invoice.trim()} loading={find.isPending} onClick={() => find.mutate()}>Continue</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); if (invoice.trim()) find.mutate(); }} className="space-y-3">
        {find.error && <Alert tone="danger">{find.error instanceof ApiError ? find.error.message : 'Not found'}</Alert>}
        <Field label="Invoice number" hint="Printed at the top of the receipt, e.g. INV-2026-000123.">
          {(id) => <Input id={id} autoFocus value={invoice} onChange={(e) => setInvoice(e.target.value)} placeholder="INV-2026-" />}
        </Field>
      </form>
    </Modal>
  );
}
