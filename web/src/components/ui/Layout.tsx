import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';

export function PageHeader({ title, description, actions, breadcrumbs, meta }: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumbs?: { label: string; to?: string }[];
  meta?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {breadcrumbs && (
          <nav className="mb-1.5 flex items-center gap-1 text-[12px] text-muted" aria-label="Breadcrumb">
            {breadcrumbs.map((b, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="size-3 text-faint" />}
                {b.to ? <Link to={b.to} className="hover:text-fg">{b.label}</Link> : <span>{b.label}</span>}
              </span>
            ))}
          </nav>
        )}
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-[19px] font-semibold tracking-[-0.01em]">{title}</h1>
          {meta}
        </div>
        {description && <p className="mt-1 text-[13px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, description, actions, children, className, bodyClassName, flush }: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** No body padding (for tables). */
  flush?: boolean;
}) {
  return (
    <section className={cn('rounded-lg border border-line bg-surface', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            {title && <h2 className="text-[13.5px] font-semibold">{title}</h2>}
            {description && <p className="mt-0.5 text-[12px] text-muted">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn(!flush && 'p-4', bodyClassName)}>{children}</div>
    </section>
  );
}

export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5', className)}>{children}</div>;
}

export function Tabs<T extends string>({ tabs, value, onChange, className }: {
  tabs: { value: T; label: ReactNode; count?: number | null }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div role="tablist" className={cn('scrollbar-thin flex gap-1 overflow-x-auto border-b border-line', className)}>
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={t.value === value}
          onClick={() => onChange(t.value)}
          className={cn(
            '-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 pb-2 pt-1 text-[13px] font-medium transition-colors',
            t.value === value ? 'border-brand-600 text-fg' : 'border-transparent text-muted hover:text-fg',
          )}
        >
          {t.label}
          {t.count != null && (
            <span className={cn('rounded px-1 text-[11px] num', t.value === value ? 'bg-brand-50 text-brand-700' : 'bg-subtle text-muted')}>{t.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

/** Definition list for record details. */
export function DetailList({ items, columns = 2 }: { items: { label: string; value: ReactNode; hidden?: boolean }[]; columns?: 1 | 2 | 3 }) {
  return (
    <dl className={cn('grid gap-x-6 gap-y-3', columns === 2 && 'sm:grid-cols-2', columns === 3 && 'sm:grid-cols-3')}>
      {items.filter((i) => !i.hidden).map((i) => (
        <div key={i.label} className="min-w-0">
          <dt className="text-[12px] text-muted">{i.label}</dt>
          <dd className="mt-0.5 break-words text-[13px]">{i.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Compact figure used in summary strips. */
export function Figure({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'danger' | 'warning' | 'brand' }) {
  return (
    <div className="min-w-0">
      <p className="text-[12px] text-muted">{label}</p>
      <p className={cn('mt-0.5 truncate text-[17px] font-semibold num tracking-[-0.01em]', tone === 'danger' && 'text-danger', tone === 'warning' && 'text-warning', tone === 'brand' && 'text-brand-700')}>
        {value}
      </p>
      {sub && <p className="mt-0.5 text-[12px] text-muted">{sub}</p>}
    </div>
  );
}

export function SummaryStrip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4', className)}>
      {Array.isArray(children)
        ? children.filter(Boolean).map((c, i) => <div key={i} className="bg-surface px-4 py-3">{c}</div>)
        : <div className="bg-surface px-4 py-3">{children}</div>}
    </div>
  );
}
