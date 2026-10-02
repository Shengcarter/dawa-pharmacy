import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ChevronDown, KeyRound, LogOut, Menu, Settings, SlidersHorizontal, UserRound } from 'lucide-react';
import { useAuth, useUser } from '@/lib/auth';
import { Dropdown, IconButton, MenuItem, MenuSeparator } from '../ui';
import { GlobalSearch } from './GlobalSearch';
import { NotificationsMenu } from './NotificationsMenu';
import { NAV } from './nav';

function sectionTitle(pathname: string) {
  for (const item of NAV) {
    if (item.to && (item.to === '/' ? pathname === '/' : pathname.startsWith(item.to))) return item.label;
    for (const c of item.children ?? []) if (pathname === c.to || pathname.startsWith(`${c.to}/`)) return c.label;
  }
  if (pathname.startsWith('/sales/')) return 'Invoices';
  if (pathname.startsWith('/profile')) return 'My profile';
  return '';
}

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('');
}

export function Topbar({ onMenu }: { onMenu: () => void }) {
  const user = useUser();
  const { logout, can } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const primaryRole = user.roles[0]?.name ?? 'User';
  return (
    <header className="sticky top-0 z-30 flex h-[52px] shrink-0 items-center gap-3 border-b border-line bg-surface/95 px-3 backdrop-blur sm:px-5">
      <IconButton label="Open menu" className="lg:hidden" onClick={onMenu}>
        <Menu className="size-4.5" />
      </IconButton>
      <p className="hidden w-44 shrink-0 truncate text-[13.5px] font-semibold xl:block">{sectionTitle(pathname)}</p>
      <div className="flex flex-1 justify-center">
        <GlobalSearch />
      </div>
      <div className="flex items-center gap-1">
        <NotificationsMenu />
        {can('settings.view', 'settings.manage') && (
          <IconButton label="Settings" className="max-sm:hidden" onClick={() => navigate('/settings')}>
            <Settings className="size-4" />
          </IconButton>
        )}
        <Dropdown
          trigger={(open) => (
            <button className="ml-1 flex items-center gap-2 rounded-md py-1 pl-1 pr-1.5 hover:bg-hover" aria-expanded={open} aria-label="Account menu">
              <span className="flex size-7 items-center justify-center rounded-full bg-brand-50 text-[11.5px] font-semibold text-brand-700 ring-1 ring-brand-200">
                {initials(user.fullName)}
              </span>
              <span className="hidden text-left leading-tight md:block">
                <span className="block max-w-36 truncate text-[12.5px] font-medium">{user.fullName}</span>
                <span className="block text-[11px] text-muted">{primaryRole}</span>
              </span>
              <ChevronDown className="hidden size-3.5 text-faint md:block" />
            </button>
          )}
        >
          {(close) => (
            <>
              <div className="px-2.5 pb-2 pt-1.5">
                <p className="text-[13px] font-medium">{user.fullName}</p>
                <p className="text-[12px] text-muted">{user.email}</p>
                <p className="text-[12px] text-muted">Branch: {user.branch.name}</p>
                <p className="mt-1.5 flex flex-wrap gap-1">
                  {user.roles.map((r) => (
                    <span key={r.code} className="rounded bg-brand-50 px-1.5 py-0.5 text-[11px] font-medium text-brand-700">{r.name}</span>
                  ))}
                </p>
              </div>
              <MenuSeparator />
              <Link to="/profile" onClick={close}><MenuItem icon={<UserRound />}>My profile</MenuItem></Link>
              <Link to="/profile?tab=password" onClick={close}><MenuItem icon={<KeyRound />}>Change password</MenuItem></Link>
              <Link to="/profile?tab=preferences" onClick={close}><MenuItem icon={<SlidersHorizontal />}>Preferences</MenuItem></Link>
              <MenuSeparator />
              <MenuItem icon={<LogOut />} onClick={() => logout()}>Log out</MenuItem>
            </>
          )}
        </Dropdown>
      </div>
    </header>
  );
}
