import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, FileClock } from 'lucide-react';
import { addDays } from '@dawa/shared';
import { api } from '@/lib/api';
import { useListState } from '@/lib/hooks';
import { useFormat } from '@/lib/settings';
import { Page } from '@/components/layout/AppLayout';
import { Badge, Card, EmptyState, ErrorState, PageHeader, PageLoader, Pagination, SearchInput, Select, Tabs, Toolbar } from '@/components/ui';
import { DateRangeFilter, ExportButton } from '@/components/Filters';
import { useStaffOptions } from '../sales/SalesPage';
import { LoginActivityTable, type LoginEvent } from '../users/UserDetailPage';

interface AuditRow { id: number; createdAt: string; userId: number | null; userName: string; action: string; module: string; entityType: string | null; entityId: string | null; summary: string; oldValues: Record<string, unknown> | null; newValues: Record<string, unknown> | null; ip: string | null; userAgent: string | null }

export function AuditLogPage() {
  const { dateTime, today } = useFormat();
  const t = today();
  const [tab, setTab] = useState<'changes' | 'logins'>('changes');
  const [s, set] = useListState({ search: '', module: '', userId: '', from: addDays(t, -6), to: t, pageSize: '50' });
  const [open, setOpen] = useState<Set<number>>(new Set());
  const staff = useStaffOptions();
  const modules = useQuery({ queryKey: ['audit-modules'], queryFn: () => api.get<string[]>('/audit-logs/modules') });
  const query = { search: s.search, module: s.module, userId: s.userId, from: s.from, to: s.to, page: s.page, pageSize: s.pageSize };
  const logs = useQuery({ queryKey: ['audit', query], queryFn: () => api.get<{ data: AuditRow[]; total: number; page: number; pageSize: number }>('/audit-logs', query), placeholderData: (p) => p, enabled: tab === 'changes' });
  const logins = useQuery({ queryKey: ['login-activity', s.page], queryFn: () => api.get<{ data: (LoginEvent & { fullName: string | null; email: string })[]; total: number; page: number; pageSize: number }>('/audit-logs/login-activity', { page: s.page }), enabled: tab === 'logins' });
  const toggle = (id: number) => { const n = new Set(open); if (n.has(id)) n.delete(id); else n.add(id); setOpen(n); };
  return (
    <Page>
      <PageHeader title="Audit log" description="Who changed what, and when. Entries cannot be edited or deleted from the application." actions={tab === 'changes' && <ExportButton path="/audit-logs" query={query} />} />
      <Tabs className="mb-3" value={tab} onChange={setTab} tabs={[{ value: 'changes', label: 'Changes' }, { value: 'logins', label: 'Sign-in activity' }]} />
      {tab === 'changes' ? (
        <Card flush>
          <Toolbar>
            <SearchInput value={s.search} onChange={(v) => set({ search: v })} placeholder="Search descriptions" className="w-full sm:w-64" />
            <Select value={s.module} onChange={(e) => set({ module: e.target.value })} className="w-40" aria-label="Module"><option value="">All modules</option>{modules.data?.map((m) => <option key={m} value={m}>{m[0].toUpperCase() + m.slice(1)}</option>)}</Select>
            <Select value={s.userId} onChange={(e) => set({ userId: e.target.value })} className="w-40" aria-label="User"><option value="">All users</option>{staff.data?.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}</Select>
            <DateRangeFilter value={{ from: s.from, to: s.to }} onChange={(r) => set(r)} today={t} />
          </Toolbar>
          {logs.isLoading ? <PageLoader /> : logs.error ? <ErrorState error={logs.error} onRetry={logs.refetch} /> : !logs.data?.data.length ? (
            <EmptyState icon={FileClock} title="No activity in this period" />
          ) : (
            <ul className="divide-y divide-line">
              {logs.data.data.map((r) => {
                const hasDiff = Boolean(r.oldValues || r.newValues);
                return (
                  <li key={r.id} className="px-4 py-2.5">
                    <div className="flex items-start gap-3">
                      <button className="mt-0.5 text-faint disabled:invisible" disabled={!hasDiff} onClick={() => toggle(r.id)} aria-label="Show details">
                        {open.has(r.id) ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px]">{r.summary}</p>
                        <p className="mt-0.5 text-[11.5px] text-muted">{dateTime(r.createdAt)} · {r.userName}{r.ip ? ` · ${r.ip}` : ''}</p>
                      </div>
                      <Badge>{r.module}</Badge>
                    </div>
                    {open.has(r.id) && hasDiff && (
                      <div className="ml-6 mt-2 grid gap-2 rounded-md border border-line bg-subtle p-3 font-mono text-[11.5px] sm:grid-cols-2">
                        <div><p className="mb-1 font-sans text-[11px] uppercase tracking-wide text-faint">Before</p><pre className="whitespace-pre-wrap break-words">{JSON.stringify(r.oldValues, null, 2)}</pre></div>
                        <div><p className="mb-1 font-sans text-[11px] uppercase tracking-wide text-faint">After</p><pre className="whitespace-pre-wrap break-words">{JSON.stringify(r.newValues, null, 2)}</pre></div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {logs.data && <Pagination page={logs.data.page} pageSize={logs.data.pageSize} total={logs.data.total} onChange={(page) => set({ page }, false)} />}
        </Card>
      ) : (
        <Card flush>
          {logins.isLoading ? <PageLoader /> : <LoginActivityTable showUser rows={logins.data?.data ?? []} />}
          {logins.data && <Pagination page={logins.data.page} pageSize={logins.data.pageSize} total={logins.data.total} onChange={(page) => set({ page }, false)} />}
        </Card>
      )}
    </Page>
  );
}
