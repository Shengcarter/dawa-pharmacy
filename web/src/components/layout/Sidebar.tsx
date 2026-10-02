import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronDown, LogOut, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useAuth } from '@/lib/auth';
import { useFormat } from '@/lib/settings';
import { NAV, type NavItem } from './nav';

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('size-7 shrink-0', className)} aria-hidden>
      <rect width="32" height="32" rx="7" fill="var(--brand-600)" />
      <path d="M13 8h6v5h5v6h-5v5h-6v-5H8v-6h5z" fill="#fff" />
    </svg>
  );
}

function visible(item: { permission?: string[] }, can: (...p: string[]) => boolean) {
  return !item.permission || can(...item.permission);
}

export function Sidebar({ collapsed, onToggle, onNavigate }: { collapsed: boolean; onToggle?: () => void; onNavigate?: () => void }) {
  const { can, logout } = useAuth();
  const { settings } = useFormat();
  const location = useLocation();
  const items = NAV.filter((i) => visible(i, can)).map((i) => ({ ...i, children: i.children?.filter((c) => visible(c, can)) }));

  return (
    <aside className={cn('flex h-full flex-col border-r border-line bg-surface transition-[width] duration-150', collapsed ? 'w-[60px]' : 'w-[244px]')}>
      <div className={cn('flex h-[52px] shrink-0 items-center gap-2.5 border-b border-line', collapsed ? 'justify-center px-0' : 'px-4')}>
        <BrandMark />
        {!collapsed && (
          <div className="min-w-0 leading-tight">
            <p className="text-[14px] font-semibold tracking-[-0.01em]">Dawa</p>
            <p className="truncate text-[11.5px] text-muted">{settings?.general.pharmacyName ?? 'Pharmacy'}</p>
          </div>
        )}
      </div>
      <nav className="scrollbar-thin flex-1 overflow-y-auto px-2 py-3" aria-label="Main">
        <ul className="space-y-0.5">
          {items.map((item) => (
            <NavEntry key={item.label} item={item} collapsed={collapsed} pathname={location.pathname} onNavigate={onNavigate} />
          ))}
        </ul>
      </nav>
      <div className="shrink-0 space-y-0.5 border-t border-line p-2">
        <button
          onClick={() => logout()}
          className={cn('flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-[13px] text-muted hover:bg-hover hover:text-fg', collapsed && 'justify-center px-0')}
          title="Log out"
        >
          <LogOut className="size-4 shrink-0" />
          {!collapsed && 'Log out'}
        </button>
        {onToggle && (
          <button
            onClick={onToggle}
            className={cn('flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-[13px] text-muted hover:bg-hover hover:text-fg', collapsed && 'justify-center px-0')}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4 shrink-0" />}
            {!collapsed && 'Collapse'}
          </button>
        )}
      </div>
    </aside>
  );
}

function isActive(to: string, pathname: string) {
  if (to === '/') return pathname === '/';
  if (to === '/sales') return pathname === '/sales' || /^\/sales\/\d+/.test(pathname);
  return pathname === to || pathname.startsWith(`${to}/`);
}

function NavEntry({ item, collapsed, pathname, onNavigate }: { item: NavItem; collapsed: boolean; pathname: string; onNavigate?: () => void }) {
  const childActive = item.children?.some((c) => isActive(c.to, pathname)) ?? false;
  const [open, setOpen] = useState(childActive);
  useEffect(() => {
    if (childActive) setOpen(true);
  }, [childActive]);
  const Icon = item.icon;
  const rowClass = (active: boolean) =>
    cn(
      'group relative flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium transition-colors',
      active ? 'bg-brand-50 text-brand-700' : 'text-muted hover:bg-hover hover:text-fg',
      collapsed && 'justify-center px-0',
    );

  if (!item.children) {
    const active = isActive(item.to!, pathname);
    return (
      <li>
        <NavLink to={item.to!} onClick={onNavigate} className={rowClass(active)} title={collapsed ? item.label : undefined}>
          {active && <span className="absolute left-0 top-1.5 h-5 w-[3px] rounded-r bg-brand-600" />}
          <Icon className="size-4 shrink-0" />
          {!collapsed && item.label}
        </NavLink>
      </li>
    );
  }
  if (!item.children.length) return null;
  if (collapsed) {
    return (
      <li>
        <NavLink to={item.children[0].to} onClick={onNavigate} className={rowClass(childActive)} title={item.label}>
          {childActive && <span className="absolute left-0 top-1.5 h-5 w-[3px] rounded-r bg-brand-600" />}
          <Icon className="size-4 shrink-0" />
        </NavLink>
      </li>
    );
  }
  return (
    <li>
      <button type="button" onClick={() => setOpen((o) => !o)} className={cn(rowClass(false), childActive && 'text-fg')} aria-expanded={open}>
        <Icon className={cn('size-4 shrink-0', childActive && 'text-brand-600')} />
        <span className="flex-1 text-left">{item.label}</span>
        <ChevronDown className={cn('size-3.5 text-faint transition-transform', open ? 'rotate-0' : '-rotate-90')} />
      </button>
      {open && (
        <ul className="mb-1 ml-[18px] mt-0.5 space-y-0.5 border-l border-line pl-2.5">
          {item.children.map((c) => {
            const active = isActive(c.to, pathname);
            return (
              <li key={c.to}>
                <NavLink
                  to={c.to}
                  onClick={onNavigate}
                  className={cn(
                    'flex h-7 items-center rounded-md px-2 text-[12.5px] transition-colors',
                    active ? 'bg-brand-50 font-medium text-brand-700' : 'text-muted hover:bg-hover hover:text-fg',
                  )}
                >
                  {c.label}
                </NavLink>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}
