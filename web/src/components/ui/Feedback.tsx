import type { ReactNode } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, Loader2, RefreshCw, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from './Button';

export type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'caution' | 'danger' | 'info';

const badgeTones: Record<Tone, string> = {
  neutral: 'bg-subtle text-muted ring-line',
  brand: 'bg-brand-50 text-brand-700 ring-brand-200',
  success: 'bg-brand-50 text-brand-700 ring-brand-200',
  warning: 'bg-warning-bg text-warning ring-warning-line',
  caution: 'bg-caution-bg text-caution ring-caution-line',
  danger: 'bg-danger-bg text-danger ring-danger-line',
  info: 'bg-info-bg text-info ring-info-line',
};
const dotTones: Record<Tone, string> = {
  neutral: 'bg-faint', brand: 'bg-brand-600', success: 'bg-brand-600', warning: 'bg-warning', caution: 'bg-caution', danger: 'bg-danger', info: 'bg-info',
};

export function Badge({ tone = 'neutral', children, dot, className }: { tone?: Tone; children: ReactNode; dot?: boolean; className?: string }) {
  return (
    <span className={cn('inline-flex h-5 items-center gap-1.5 whitespace-nowrap rounded px-1.5 text-[11.5px] font-medium ring-1 ring-inset', badgeTones[tone], className)}>
      {dot && <span className={cn('size-1.5 rounded-full', dotTones[tone])} />}
      {children}
    </span>
  );
}

const alertTones: Record<Exclude<Tone, 'neutral' | 'brand'>, { box: string; icon: LucideIcon }> = {
  success: { box: 'border-brand-200 bg-brand-50 text-brand-800', icon: CheckCircle2 },
  warning: { box: 'border-warning-line bg-warning-bg text-warning', icon: AlertTriangle },
  caution: { box: 'border-caution-line bg-caution-bg text-caution', icon: AlertTriangle },
  danger: { box: 'border-danger-line bg-danger-bg text-danger', icon: AlertCircle },
  info: { box: 'border-info-line bg-info-bg text-info', icon: Info },
};

export function Alert({ tone = 'info', title, children, action, className }: { tone?: keyof typeof alertTones; title?: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  const { box, icon: Icon } = alertTones[tone];
  return (
    <div className={cn('flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-[13px]', box, className)} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cn(title ? 'mt-0.5' : '', 'opacity-90')}>{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-4 animate-spin text-muted', className)} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton h-3.5', className)} />;
}

export function PageLoader() {
  return (
    <div className="flex h-64 items-center justify-center">
      <Spinner className="size-5" />
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description, action, compact }: { icon?: LucideIcon; title: string; description?: ReactNode; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center', compact ? 'px-4 py-8' : 'px-6 py-14')}>
      {Icon && (
        <div className="mb-3 flex size-10 items-center justify-center rounded-lg border border-line bg-subtle text-muted">
          <Icon className="size-4.5" />
        </div>
      )}
      <p className="text-[13.5px] font-medium">{title}</p>
      {description && <p className="mt-1 max-w-sm text-[12.5px] text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, compact }: { error: unknown; onRetry?: () => void; compact?: boolean }) {
  const message = error instanceof Error ? error.message : 'Something went wrong.';
  return (
    <div className={cn('flex flex-col items-center justify-center text-center', compact ? 'py-8' : 'py-14')}>
      <div className="mb-3 flex size-10 items-center justify-center rounded-lg border border-danger-line bg-danger-bg text-danger">
        <AlertCircle className="size-4.5" />
      </div>
      <p className="text-[13.5px] font-medium">Could not load this</p>
      <p className="mt-1 max-w-sm text-[12.5px] text-muted">{message}</p>
      {onRetry && (
        <Button size="sm" className="mt-4" icon={<RefreshCw className="size-3.5" />} onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
