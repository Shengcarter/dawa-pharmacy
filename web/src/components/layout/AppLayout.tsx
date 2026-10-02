import { Suspense, useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { applyTheme, useMediaQuery } from '@/lib/hooks';
import { cn } from '@/lib/cn';
import { useIdleLogout } from '@/lib/idle';
import { useFormat } from '@/lib/settings';
import { PageLoader } from '../ui';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export function AppLayout() {
  const { user, status, setUser, logout } = useAuth();
  const { settings } = useFormat();
  useIdleLogout(settings?.meta.idleTimeoutMinutes, status === 'signed-in', () => { void logout(); });
  const location = useLocation();
  const desktop = useMediaQuery('(min-width: 1024px)');
  const [mobileOpen, setMobileOpen] = useState(false);
  const collapsed = user?.preferences.sidebarCollapsed ?? false;

  useEffect(() => setMobileOpen(false), [location.pathname]);
  useEffect(() => {
    if (user) applyTheme(user.preferences.theme);
  }, [user]);

  if (status === 'loading') return <div className="flex h-screen items-center justify-center"><PageLoader /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (user.mustChangePassword && location.pathname !== '/profile') return <Navigate to="/profile?tab=password&required=1" replace />;
  if (user.mfaSetupRequired && location.pathname !== '/profile') return <Navigate to="/profile?tab=security" replace />;

  const toggle = () => {
    const preferences = { ...user.preferences, sidebarCollapsed: !collapsed };
    setUser({ ...user, preferences });
    api.put('/auth/preferences', preferences).catch(() => undefined);
  };

  return (
    <div className="flex h-screen overflow-hidden">
      {desktop ? (
        <Sidebar collapsed={collapsed} onToggle={toggle} />
      ) : (
        <div className={cn('fixed inset-0 z-40 lg:hidden', !mobileOpen && 'pointer-events-none')}>
          <div className={cn('absolute inset-0 bg-[rgb(10_16_13/0.4)] transition-opacity', mobileOpen ? 'opacity-100' : 'opacity-0')} onClick={() => setMobileOpen(false)} />
          <div className={cn('absolute inset-y-0 left-0 transition-transform duration-200', mobileOpen ? 'translate-x-0' : '-translate-x-full')}>
            <Sidebar collapsed={false} onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenu={() => setMobileOpen(true)} />
        <main className="scrollbar-thin flex-1 overflow-y-auto">
          <Suspense fallback={<PageLoader />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}

/** Standard page container. Full-bleed pages (POS) render without it. */
export function Page({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return <div className={cn('mx-auto w-full px-4 py-5 sm:px-6 lg:py-6', wide ? 'max-w-[1600px]' : 'max-w-[1400px]')}>{children}</div>;
}
