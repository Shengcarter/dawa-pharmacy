import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, Plus, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuth, useUser } from '@/lib/auth';
import { useBranches } from '@/lib/branches';
import { useDebounced, useListState } from '@/lib/hooks';
import { useFormat } from '@/lib/settings';
import type { BatchRow, Paginated } from '@/lib/types';
import { Page } from '@/components/layout/AppLayout';
import { Alert, Badge, Button, Card, DataTable, EmptyState, Field, IconButton, Input, Modal, PageHeader, Pagination, SearchInput, Select, useToast } from '@/components/ui';

interface TransferRow { id: number; transferNo: string; createdAt: string; notes: string | null; totalCost: number; fromBranch: string; toBranch: string; createdByName: string; outgoing: boolean; items: { productName: string; batchNumber: string; quantity: number }[] }

export function TransfersPage() {
  const { can } = useAuth();
  const user = useUser();
  const { money, dateTime } = useFormat();
  const branches = useBranches();
  const [s, set] = useListState({});
  const [creating, setCreating] = useState(false);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['transfers', s.page],
    queryFn: () => api.get<Paginated<TransferRow>>('/inventory/transfers', { page: s.page, pageSize: s.pageSize }),
  });
  const otherBranches = (branches.data ?? []).filter((b) => b.isActive && b.id !== user.branch.id);
  return (
    <Page>
      <PageHeader
        title="Stock transfers"
        description={`Move batches between branches. Transfers out of ${user.branch.name} keep their batch number, expiry and cost at the destination.`}
        actions={can('inventory.adjust') && <Button variant="primary" icon={<Plus className="size-3.5" />} disabled={!otherBranches.length} onClick={() => setCreating(true)}>New transfer</Button>}
      />
      {branches.data && !otherBranches.length && (
        <Alert tone="info" className="mb-4">There is only one active branch. Add another branch in Settings → Branches to transfer stock.</Alert>
      )}
      <Card flush>
        <DataTable
          rows={data?.data} loading={isLoading} error={error} onRetry={refetch} rowKey={(r) => r.id}
          empty={<EmptyState icon={ArrowRightLeft} title="No transfers yet" />}
          columns={[
            { key: 'no', header: 'Transfer', cell: (r) => <span className="font-medium">{r.transferNo}</span> },
            { key: 'date', header: 'Date', cell: (r) => <span className="text-muted num">{dateTime(r.createdAt)}</span> },
            { key: 'dir', header: 'Direction', cell: (r) => (r.outgoing ? <Badge tone="warning">Out to {r.toBranch}</Badge> : <Badge tone="success">In from {r.fromBranch}</Badge>) },
            { key: 'items', header: 'Items', cell: (r) => <span className="line-clamp-1 max-w-sm text-muted" title={r.items.map((i) => `${i.quantity} × ${i.productName} (${i.batchNumber})`).join('\n')}>{r.items.map((i) => `${i.quantity} × ${i.productName}`).join(', ')}</span>, hideBelow: 'md' },
            { key: 'value', header: 'Value at cost', align: 'right', cell: (r) => <span className="num">{money(r.totalCost)}</span> },
            { key: 'by', header: 'By', cell: (r) => r.createdByName, hideBelow: 'lg' },
          ]}
        />
        {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={(page) => set({ page }, false)} />}
      </Card>
      <NewTransferModal open={creating} onClose={() => setCreating(false)} branches={otherBranches} />
    </Page>
  );
}

function NewTransferModal({ open, onClose, branches }: { open: boolean; onClose: () => void; branches: { id: number; name: string }[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { date } = useFormat();
  const [toBranchId, setTo] = useState('');
  const [notes, setNotes] = useState('');
  const [term, setTerm] = useState('');
  const [lines, setLines] = useState<{ batch: BatchRow; quantity: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const q = useDebounced(term, 250);
  const found = useQuery({
    queryKey: ['transfer-batches', q],
    queryFn: () => api.get<Paginated<BatchRow>>('/inventory/batches', { search: q, pageSize: 8, status: 'active' }),
    enabled: open && q.length >= 2,
  });
  useEffect(() => { if (open) { setTo(branches.length === 1 ? String(branches[0].id) : ''); setNotes(''); setTerm(''); setLines([]); setError(null); } }, [open, branches]);
  const save = useMutation({
    mutationFn: () => api.post<{ transferNo: string }>('/inventory/transfers', { toBranchId: toBranchId, notes: notes || null, items: lines.map((l) => ({ batchId: l.batch.id, quantity: l.quantity })) }),
    onSuccess: (r) => {
      ['transfers', 'batches', 'products', 'product', 'movements', 'dashboard'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast.success(`Transfer ${r.transferNo} completed`);
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Transfer failed'),
  });
  const valid = toBranchId && lines.length && lines.every((l) => Number(l.quantity) > 0 && Number(l.quantity) <= l.batch.quantityOnHand);
  return (
    <Modal open={open} onClose={onClose} size="lg" title="Transfer stock" description="Stock leaves this branch and arrives at the destination immediately."
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>Transfer {lines.length} line(s)</Button></>}>
      {error && <Alert tone="danger" className="mb-3">{error}</Alert>}
      <div className="grid gap-3.5 sm:grid-cols-2">
        <Field label="To branch" required>{(id) => <Select id={id} placeholder="Choose branch" value={toBranchId} onChange={(e) => setTo(e.target.value)}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>}</Field>
        <Field label="Notes">{(id) => <Input id={id} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Weekend cover for Mwenge" />}</Field>
      </div>
      <div className="mt-4">
        <SearchInput value={term} onChange={setTerm} placeholder="Find a product or batch in this branch" />
        {q.length >= 2 && (
          <ul className="mt-1.5 max-h-48 overflow-y-auto rounded-md border border-line">
            {(found.data?.data ?? []).filter((b) => !lines.some((l) => l.batch.id === b.id) && (b.daysToExpiry === null || b.daysToExpiry >= 0)).map((b) => (
              <li key={b.id}>
                <button className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-[13px] hover:bg-hover" onClick={() => { setLines([...lines, { batch: b, quantity: '' }]); setTerm(''); }}>
                  <span>{b.productName} <span className="text-muted">· {b.batchNumber} · exp {b.expiryDate ? date(b.expiryDate) : 'n/a'}</span></span>
                  <span className="text-muted num">{b.quantityOnHand} on hand</span>
                </button>
              </li>
            ))}
            {found.data && !found.data.data.length && <li className="px-3 py-2 text-[12.5px] text-muted">No sellable batches match.</li>}
          </ul>
        )}
      </div>
      {lines.length > 0 && (
        <ul className="mt-3 divide-y divide-line rounded-md border border-line">
          {lines.map((l, i) => (
            <li key={l.batch.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
              <span className="min-w-0 flex-1 truncate">{l.batch.productName} <span className="text-muted">· {l.batch.batchNumber}</span></span>
              <span className="text-[12px] text-muted num">of {l.batch.quantityOnHand}</span>
              <Input aria-label="Quantity" inputMode="numeric" value={l.quantity} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value.replace(/\D/g, '') } : x)))}
                className="w-20 text-right" invalid={Number(l.quantity) > l.batch.quantityOnHand} />
              <IconButton label="Remove" size="sm" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 className="size-3.5" /></IconButton>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
