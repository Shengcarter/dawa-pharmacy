import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, Paperclip, Plus, Wallet } from 'lucide-react';
import { EXPENSE_PAYMENT_METHODS, expenseSchema } from '@dawa/shared';
import { api, openProtectedFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { applyServerErrors, useZodForm } from '@/lib/forms';
import { useListState } from '@/lib/hooks';
import { useFormat } from '@/lib/settings';
import { Page } from '@/components/layout/AppLayout';
import {
  Alert, Badge, Button, Card, Checkbox, ConfirmDialog, DataTable, Dropdown, EmptyState, Field, IconButton, Input, MenuItem, Modal, PageHeader, Pagination,
  SearchInput, Select, Textarea, Toolbar, useToast,
} from '@/components/ui';
import { DateRangeFilter } from '@/components/Filters';
import { useStaffOptions } from '../sales/SalesPage';

interface ExpenseRow { id: number; expenseNo: string; description: string; amount: number; paymentMethod: string; expenseDate: string; paidTo: string | null; reference: string | null; notes: string | null; hasReceipt: boolean; voidedAt: string | null; voidReason: string | null; categoryId: number; categoryName: string; employeeId: number | null; employeeName: string | null; createdByName: string }

export function useExpenseCategories() {
  return useQuery({ queryKey: ['expense-categories'], queryFn: () => api.get<{ id: number; name: string }[]>('/expenses/categories'), staleTime: 300_000 });
}

export function ExpensesPage() {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const { amount, date, money, currency, today } = useFormat();
  const t = today();
  const categories = useExpenseCategories();
  const [s, set] = useListState({ search: '', categoryId: '', from: `${t.slice(0, 8)}01`, to: t, includeVoided: '' });
  const [editing, setEditing] = useState<ExpenseRow | 'new' | null>(null);
  const [voiding, setVoiding] = useState<ExpenseRow | null>(null);
  const uploadFor = useRef<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const query = { search: s.search, categoryId: s.categoryId, from: s.from, to: s.to, includeVoided: s.includeVoided, page: s.page, pageSize: s.pageSize };
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['expenses', query],
    queryFn: () => api.get<{ data: ExpenseRow[]; total: number; page: number; pageSize: number; sumAmount: number }>('/expenses', query),
    placeholderData: (p) => p,
  });
  const voidMut = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => api.post(`/expenses/${id}/void`, { reason }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['expenses'] }); toast.success('Expense voided'); setVoiding(null); },
  });
  const upload = useMutation({
    mutationFn: ({ id, file }: { id: number; file: File }) => api.upload(`/expenses/${id}/receipt`, file),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['expenses'] }); toast.success('Receipt attached'); },
    onError: (e) => toast.error('Upload failed', (e as Error).message),
  });
  const canManage = can('expenses.manage');
  return (
    <Page>
      <PageHeader title="Expenses" description="Operating costs: rent, utilities, salaries, transport and more. They reduce net profit in the P&L."
        actions={canManage && <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEditing('new')}>Record expense</Button>} />
      <Card flush>
        <Toolbar>
          <SearchInput value={s.search} onChange={(v) => set({ search: v })} placeholder="Description, payee or number" className="w-full sm:w-60" />
          <Select value={s.categoryId} onChange={(e) => set({ categoryId: e.target.value })} className="w-40" aria-label="Category"><option value="">All categories</option>{categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
          <DateRangeFilter value={{ from: s.from, to: s.to }} onChange={(r) => set(r)} today={t} />
          <Checkbox label="Show voided" checked={s.includeVoided === 'true'} onChange={(e) => set({ includeVoided: e.target.checked ? 'true' : '' })} />
          {data && <span className="ml-auto text-[12.5px] text-muted">Total <b className="text-fg num">{money(data.sumAmount)}</b></span>}
        </Toolbar>
        <DataTable
          rows={data?.data} loading={isLoading} error={error} onRetry={refetch} rowKey={(r) => r.id}
          rowClassName={(r) => (r.voidedAt ? 'opacity-55' : undefined)}
          empty={<EmptyState icon={Wallet} title="No expenses in this period" />}
          columns={[
            { key: 'date', header: 'Date', cell: (r) => <span className="num">{date(r.expenseDate)}</span> },
            { key: 'cat', header: 'Category', cell: (r) => r.categoryName },
            { key: 'desc', header: 'Description', cell: (r) => <div className="max-w-sm"><p className={r.voidedAt ? 'truncate line-through' : 'truncate'}>{r.description}</p><p className="truncate text-[12px] text-muted">{[r.expenseNo, r.paidTo].filter(Boolean).join(' · ')}</p></div> },
            { key: 'method', header: 'Paid by', cell: (r) => EXPENSE_PAYMENT_METHODS[r.paymentMethod as keyof typeof EXPENSE_PAYMENT_METHODS], hideBelow: 'lg' },
            { key: 'emp', header: 'Employee', cell: (r) => r.employeeName ?? '—', hideBelow: 'xl' },
            { key: 'rcpt', header: '', cell: (r) => r.hasReceipt && <button className="text-muted hover:text-fg" title="View receipt" onClick={() => openProtectedFile(`/expenses/${r.id}/receipt`).catch((e) => toast.error('Cannot open receipt', e.message))}><Paperclip className="size-3.5" /></button>, hideBelow: 'sm' },
            { key: 'amt', header: `Amount (${currency})`, align: 'right', cell: (r) => (r.voidedAt ? <Badge>Voided</Badge> : <span className="font-medium num">{amount(r.amount)}</span>) },
            {
              key: 'a', header: '', align: 'right',
              cell: (r) => canManage && !r.voidedAt && (
                <Dropdown trigger={() => <IconButton label="Actions" size="sm"><MoreHorizontal className="size-4" /></IconButton>}>
                  {(close) => (
                    <>
                      <MenuItem onClick={() => { close(); setEditing(r); }}>Edit</MenuItem>
                      <MenuItem onClick={() => { close(); uploadFor.current = r.id; fileInput.current?.click(); }}>{r.hasReceipt ? 'Replace receipt' : 'Attach receipt'}</MenuItem>
                      <MenuItem danger onClick={() => { close(); setVoiding(r); }}>Void</MenuItem>
                    </>
                  )}
                </Dropdown>
              ),
            },
          ]}
        />
        {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={(page) => set({ page }, false)} />}
      </Card>
      <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f && uploadFor.current) upload.mutate({ id: uploadFor.current, file: f }); e.target.value = ''; }} />
      <ExpenseFormModal expense={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog open={voiding !== null} onClose={() => setVoiding(null)} onConfirm={(reason) => voiding && voidMut.mutate({ id: voiding.id, reason })} loading={voidMut.isPending}
        tone="danger" requireReason title="Void this expense?" message={`${voiding?.description} — ${money(voiding?.amount)}. It stays in the records, marked void, and drops out of totals.`} confirmLabel="Void expense" />
    </Page>
  );
}

function ExpenseFormModal({ expense, onClose }: { expense: ExpenseRow | 'new' | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { currency, today } = useFormat();
  const categories = useExpenseCategories();
  const staff = useStaffOptions();
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const form = useZodForm(expenseSchema);
  const existing = expense && expense !== 'new' ? expense : null;
  useEffect(() => {
    if (!expense) return;
    setError(null);
    setFile(null);
    form.reset((existing
      ? { categoryId: existing.categoryId, description: existing.description, amount: existing.amount, paymentMethod: existing.paymentMethod, expenseDate: existing.expenseDate, paidTo: existing.paidTo ?? '', employeeId: existing.employeeId ?? '', reference: existing.reference ?? '', notes: existing.notes ?? '' }
      : { description: '', paymentMethod: 'cash', expenseDate: today(), paidTo: '', employeeId: '', reference: '', notes: '' }) as never);
  }, [expense, existing, form, today]);
  const save = useMutation({ mutationFn: (body: unknown) => (existing ? api.put<{ id: number }>(`/expenses/${existing.id}`, body) : api.post<{ id: number }>('/expenses', body)) });
  const submit = form.handleSubmit(async (data) => {
    try {
      const r = await save.mutateAsync(data);
      if (file) await api.upload(`/expenses/${r.id}/receipt`, file);
      qc.invalidateQueries({ queryKey: ['expenses'] });
      toast.success(existing ? 'Expense updated' : 'Expense recorded');
      onClose();
    } catch (e) {
      setError(applyServerErrors(form, e));
    }
  });
  const { errors } = form.formState;
  const r = form.register;
  return (
    <Modal open={expense !== null} onClose={onClose} title={existing ? `Edit ${existing.expenseNo}` : 'Record expense'} size="md"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={submit}>Save expense</Button></>}>
      <form onSubmit={submit} className="grid gap-3.5 sm:grid-cols-2">
        {error && <Alert tone="danger" className="sm:col-span-2">{error}</Alert>}
        <Field label="Category" required error={errors.categoryId?.message}>{(id) => <Select id={id} placeholder="Choose" {...r('categoryId')}>{categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
        <Field label="Date" required error={errors.expenseDate?.message}>{(id) => <Input id={id} type="date" max={today()} {...r('expenseDate')} />}</Field>
        <Field label="Description" required error={errors.description?.message} className="sm:col-span-2">{(id) => <Input id={id} placeholder="e.g. LUKU electricity tokens" {...r('description')} />}</Field>
        <Field label="Amount" required error={errors.amount?.message}>{(id) => <Input id={id} inputMode="decimal" prefix={currency} {...r('amount')} />}</Field>
        <Field label="Paid by" required>{(id) => <Select id={id} {...r('paymentMethod')}>{Object.entries(EXPENSE_PAYMENT_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
        <Field label="Paid to">{(id) => <Input id={id} placeholder="e.g. TANESCO" {...r('paidTo')} />}</Field>
        <Field label="Reference">{(id) => <Input id={id} {...r('reference')} />}</Field>
        <Field label="Employee" hint="Who incurred or approved it.">{(id) => <Select id={id} placeholder="—" {...r('employeeId')}>{staff.data?.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}</Select>}</Field>
        <Field label="Receipt" hint="Image or PDF, up to 8 MB.">{(id) => <Input id={id} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="py-1" />}</Field>
        <Field label="Notes" className="sm:col-span-2">{(id) => <Textarea id={id} rows={2} {...r('notes')} />}</Field>
      </form>
    </Modal>
  );
}
