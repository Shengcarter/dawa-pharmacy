import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, LockOpen, Pencil } from 'lucide-react';
import { passwordRules } from '@dawa/shared';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFormat } from '@/lib/settings';
import { Page } from '@/components/layout/AppLayout';
import { Alert, Badge, Button, Card, DataTable, DetailList, EmptyState, ErrorState, Field, Figure, Input, Modal, PageHeader, PageLoader, SummaryStrip, useToast } from '@/components/ui';
import { UserFormModal } from './UserForm';

interface UserDetail { id: number; branchId: number; branchName: string; fullName: string; email: string; phone: string | null; jobTitle: string | null; status: string; lastLoginAt: string | null; createdAt: string; mustChangePassword: boolean; locked: boolean; mfaEnabled: boolean; accessExpiresOn: string | null; roles: { id: number; code: string; name: string }[]; loginActivity: LoginEvent[]; thisMonth: { transactions: number; revenue: number } }
export interface LoginEvent { event: string; ip: string | null; userAgent: string | null; detail: string | null; createdAt: string; fullName?: string | null; email?: string }

const EVENT_LABELS: Record<string, string> = { login: 'Signed in', login_failed: 'Failed sign-in', logout: 'Signed out', locked: 'Locked after failed attempts', password_reset: 'Password reset', password_changed: 'Password changed', token_reuse: 'Suspicious session reuse — signed out everywhere' };
export function LoginActivityTable({ rows, showUser }: { rows: LoginEvent[]; showUser?: boolean }) {
  const { dateTime } = useFormat();
  return (
    <DataTable rows={rows} rowKey={(r) => `${r.createdAt}${r.event}`} empty={<EmptyState compact title="No sign-in activity" />} columns={[
      { key: 'when', header: 'When', cell: (r) => <span className="num">{dateTime(r.createdAt)}</span> },
      ...(showUser ? [{ key: 'user', header: 'User', cell: (r: LoginEvent) => <span>{r.fullName ?? r.email}</span> }] : []),
      { key: 'event', header: 'Event', cell: (r) => <span className={['login_failed', 'locked', 'token_reuse'].includes(r.event) ? 'text-danger' : ''}>{EVENT_LABELS[r.event] ?? r.event}</span> },
      { key: 'ip', header: 'IP', cell: (r) => <span className="font-mono text-[12px] text-muted">{r.ip ?? '—'}</span>, hideBelow: 'md' },
      { key: 'device', header: 'Device', cell: (r) => <span className="line-clamp-1 max-w-xs text-[12px] text-muted" title={r.userAgent ?? ''}>{r.userAgent ?? '—'}</span>, hideBelow: 'lg' },
    ]} />
  );
}

export function UserDetailPage() {
  const { id } = useParams();
  const { can, user: me } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const { money, dateTime, date } = useFormat();
  const [editing, setEditing] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [password, setPassword] = useState('');
  const { data: u, isLoading, error, refetch } = useQuery({ queryKey: ['user', id], queryFn: () => api.get<UserDetail>(`/users/${id}`) });
  const reset = useMutation({
    mutationFn: () => api.post(`/users/${id}/reset-password`, { password }),
    onSuccess: () => { toast.success('Password reset', 'Give the temporary password to the user in person.'); setResetting(false); setPassword(''); qc.invalidateQueries({ queryKey: ['user', id] }); },
  });
  const resetMfa = useMutation({
    mutationFn: () => api.post<{ message: string }>(`/users/${id}/reset-mfa`),
    onSuccess: (r) => { toast.success(r.message); qc.invalidateQueries({ queryKey: ['user', id] }); },
    onError: (e) => toast.error('Not reset', (e as Error).message),
  });
  const unlock = useMutation({ mutationFn: () => api.post(`/users/${id}/unlock`), onSuccess: () => { toast.success('Account unlocked'); qc.invalidateQueries({ queryKey: ['user', id] }); } });
  if (isLoading) return <PageLoader />;
  if (error || !u) return <Page><ErrorState error={error} onRetry={refetch} /></Page>;
  const pwCheck = passwordRules.safeParse(password);
  return (
    <Page>
      <PageHeader breadcrumbs={[{ label: 'Employees & users', to: '/users' }, { label: u.fullName }]} title={u.fullName}
        meta={u.status === 'suspended' ? <Badge tone="danger" dot>Suspended</Badge> : u.locked ? <Badge tone="warning" dot>Locked</Badge> : <Badge tone="success" dot>Active</Badge>}
        description={[u.jobTitle, u.email].filter(Boolean).join(' · ')}
        actions={can('users.manage') && (
          <>
            {u.locked && <Button icon={<LockOpen className="size-3.5" />} loading={unlock.isPending} onClick={() => unlock.mutate()}>Unlock</Button>}
            {u.id !== me?.id && <Button icon={<KeyRound className="size-3.5" />} onClick={() => setResetting(true)}>Reset password</Button>}
            {u.id !== me?.id && u.mfaEnabled && (
              <Button loading={resetMfa.isPending} onClick={() => { if (window.confirm(`Reset two-factor authentication for ${u.fullName}? They will be signed out and must set it up again.`)) resetMfa.mutate(); }}>Reset 2FA</Button>
            )}
            <Button variant="primary" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(true)}>Edit</Button>
          </>
        )} />
      <SummaryStrip className="mb-4">
        <Figure label="Sales this month" value={u.thisMonth.transactions.toLocaleString()} />
        <Figure label="Revenue this month" value={money(u.thisMonth.revenue)} />
        <Figure label="Last sign-in" value={u.lastLoginAt ? dateTime(u.lastLoginAt) : 'Never'} />
        <Figure label="Roles" value={u.roles.map((r) => r.name).join(', ')} />
      </SummaryStrip>
      <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
        <Card title="Sign-in activity" flush><LoginActivityTable rows={u.loginActivity} /></Card>
        <Card title="Account">
          <DetailList columns={1} items={[
            { label: 'Email', value: u.email },
            { label: 'Branch', value: u.branchName },
            { label: 'Phone', value: u.phone },
            { label: 'Created', value: dateTime(u.createdAt) },
            { label: 'Password', value: u.mustChangePassword ? 'Temporary — must be changed at next sign-in' : 'Set by the user' },
            { label: 'Two-factor', value: u.mfaEnabled ? 'On' : 'Off' },
            { label: 'Access ends', value: u.accessExpiresOn ? date(u.accessExpiresOn) : null, hidden: !u.accessExpiresOn },
          ]} />
        </Card>
      </div>
      <UserFormModal open={editing} onClose={() => setEditing(false)} user={u} />
      <Modal open={resetting} onClose={() => setResetting(false)} size="sm" title={`Reset password for ${u.fullName}`}
        footer={<><Button onClick={() => setResetting(false)}>Cancel</Button><Button variant="primary" disabled={!pwCheck.success} loading={reset.isPending} onClick={() => reset.mutate()}>Reset password</Button></>}>
        {reset.error && <Alert tone="danger" className="mb-3">{reset.error instanceof ApiError ? reset.error.message : 'Failed'}</Alert>}
        <p className="mb-3 text-[13px] text-muted">All their sessions end immediately. They must choose a new password when they next sign in.</p>
        <Field label="Temporary password" error={password && !pwCheck.success ? pwCheck.error.issues[0].message : undefined}>{(fid) => <Input id={fid} autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
      </Modal>
    </Page>
  );
}
