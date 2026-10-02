import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellOff, RefreshCw } from 'lucide-react';
import { NOTIFICATION_TYPES } from '@dawa/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFormat } from '@/lib/settings';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/time';
import { Page } from '@/components/layout/AppLayout';
import { Button, Card, EmptyState, ErrorState, PageHeader, PageLoader, Select, Toolbar } from '@/components/ui';
import { severityDot, type NotificationItem } from '@/components/layout/NotificationsMenu';

export function NotificationsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useAuth();
  const { dateTime } = useFormat();
  const [type, setType] = useState('');
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['notifications', 'page', type],
    queryFn: () => api.get<{ items: NotificationItem[]; unread: number }>('/notifications', { limit: 200, type }),
  });
  const markRead = useMutation({ mutationFn: (ids: number[] | 'all') => api.post('/notifications/read', { ids }), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  const refresh = useMutation({ mutationFn: () => api.post('/notifications/refresh'), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  return (
    <Page>
      <PageHeader title="Notifications" description="Alerts are raised automatically and clear themselves when the condition is resolved (for example, when stock is received)."
        actions={
          <>
            {can('inventory.view') && <Button icon={<RefreshCw className="size-3.5" />} loading={refresh.isPending} onClick={() => refresh.mutate()}>Check now</Button>}
            {Boolean(data?.unread) && <Button variant="primary" onClick={() => markRead.mutate('all')}>Mark all as read</Button>}
          </>
        } />
      <Card flush>
        <Toolbar>
          <Select value={type} onChange={(e) => setType(e.target.value)} className="w-52" aria-label="Type">
            <option value="">All notifications</option>
            {Object.entries(NOTIFICATION_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          {data && <span className="ml-auto text-[12.5px] text-muted">{data.unread} unread</span>}
        </Toolbar>
        {isLoading ? <PageLoader /> : error ? <ErrorState error={error} onRetry={refetch} /> : !data?.items.length ? (
          <EmptyState icon={BellOff} title="No active alerts" description="Stock, expiry, purchasing and payment alerts appear here." />
        ) : (
          <ul className="divide-y divide-line">
            {data.items.map((n) => (
              <li key={n.id}>
                <button className={cn('flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-hover', !n.isRead && 'bg-brand-50/40')}
                  onClick={() => { if (!n.isRead) markRead.mutate([n.id]); if (n.link) navigate(n.link); }}>
                  <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', severityDot[n.severity])} />
                  <span className="min-w-0 flex-1">
                    <span className={cn('block text-[13px]', !n.isRead && 'font-medium')}>{n.title}</span>
                    <span className="mt-0.5 block text-[12.5px] text-muted">{n.message}</span>
                  </span>
                  <span className="shrink-0 text-right text-[11.5px] text-faint">
                    <span className="block">{NOTIFICATION_TYPES[n.type as keyof typeof NOTIFICATION_TYPES]}</span>
                    <span className="block" title={dateTime(n.createdAt)}>{relativeTime(n.createdAt)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Page>
  );
}
