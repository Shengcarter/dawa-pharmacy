import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Dropdown, IconButton } from '../ui';
import { relativeTime } from '@/lib/time';

export interface NotificationItem {
  id: number;
  type: string;
  severity: 'info' | 'success' | 'warning' | 'critical';
  title: string;
  message: string;
  link: string | null;
  createdAt: string;
  isRead: boolean;
}

export const severityDot: Record<string, string> = {
  critical: 'bg-danger', warning: 'bg-warning', info: 'bg-info', success: 'bg-brand-600',
};

export function useNotifications(limit = 8) {
  return useQuery({
    queryKey: ['notifications', limit],
    queryFn: () => api.get<{ items: NotificationItem[]; unread: number }>('/notifications', { limit }),
    refetchInterval: 60_000,
  });
}

export function NotificationsMenu() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data } = useNotifications();
  const markRead = useMutation({
    mutationFn: (ids: number[] | 'all') => api.post('/notifications/read', { ids }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const unread = data?.unread ?? 0;
  return (
    <Dropdown
      className="w-[min(380px,calc(100vw-1.5rem))] p-0"
      trigger={() => (
        <IconButton label={unread ? `${unread} unread notifications` : 'Notifications'} className="relative">
          <Bell className="size-4" />
          {unread > 0 && (
            <span className="absolute right-1 top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-danger px-1 text-[9.5px] font-semibold text-white num">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </IconButton>
      )}
    >
      {(close) => (
        <div>
          <div className="flex items-center justify-between border-b border-line px-3.5 py-2.5">
            <p className="text-[13px] font-semibold">Notifications</p>
            {unread > 0 && (
              <button className="text-[12px] font-medium text-brand-700 hover:underline" onClick={() => markRead.mutate('all')}>
                Mark all read
              </button>
            )}
          </div>
          <ul className="scrollbar-thin max-h-96 overflow-y-auto">
            {data?.items.length ? (
              data.items.map((n) => (
                <li key={n.id}>
                  <button
                    className={cn('flex w-full gap-2.5 border-b border-line px-3.5 py-2.5 text-left last:border-0 hover:bg-hover', !n.isRead && 'bg-brand-50/40')}
                    onClick={() => {
                      if (!n.isRead) markRead.mutate([n.id]);
                      close();
                      if (n.link) navigate(n.link);
                    }}
                  >
                    <span className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', severityDot[n.severity])} />
                    <span className="min-w-0 flex-1">
                      <span className={cn('block text-[12.5px]', !n.isRead && 'font-medium')}>{n.title}</span>
                      <span className="mt-0.5 block text-[12px] text-muted">{n.message}</span>
                      <span className="mt-1 block text-[11px] text-faint">{relativeTime(n.createdAt)}</span>
                    </span>
                  </button>
                </li>
              ))
            ) : (
              <li className="px-3.5 py-8 text-center text-[12.5px] text-muted">You're all caught up.</li>
            )}
          </ul>
          <button
            className="w-full border-t border-line px-3.5 py-2 text-[12.5px] font-medium text-brand-700 hover:bg-hover"
            onClick={() => {
              close();
              navigate('/notifications');
            }}
          >
            View all notifications
          </button>
        </div>
      )}
    </Dropdown>
  );
}
