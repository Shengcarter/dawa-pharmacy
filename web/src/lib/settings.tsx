import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DEFAULT_CURRENCY, DEFAULT_TIMEZONE, formatAmount, formatMoney, todayIn } from '@dawa/shared';
import { api } from './api';
import type { AppSettings } from './types';

interface Formatters {
  settings: AppSettings | undefined;
  currency: string;
  timezone: string;
  /** "TZS 25,000" */
  money: (v: number | string | null | undefined) => string;
  /** "25,000" — for dense tables with the currency in the header. */
  amount: (v: number | string | null | undefined) => string;
  /** "14 Mar 2027" from a date-only value. */
  date: (v: string | null | undefined) => string;
  /** "14 Mar 2027, 15:42" from a timestamp, in the pharmacy's time zone. */
  dateTime: (v: string | Date | null | undefined) => string;
  time: (v: string | Date | null | undefined) => string;
  /** Business date (YYYY-MM-DD) in the pharmacy's time zone. */
  today: () => string;
}

const SettingsContext = createContext<Formatters | null>(null);

const dateOnly = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export function SettingsProvider({ children, publicOnly }: { children: ReactNode; publicOnly?: boolean }) {
  const { data } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<AppSettings>('/settings'),
    staleTime: 5 * 60_000,
    enabled: !publicOnly,
  });
  const value = useMemo<Formatters>(() => {
    const currency = data?.general.currency ?? DEFAULT_CURRENCY;
    const timezone = data?.general.timezone ?? DEFAULT_TIMEZONE;
    const dt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: timezone });
    const tm = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: timezone });
    return {
      settings: data,
      currency,
      timezone,
      money: (v) => formatMoney(v ?? 0, currency),
      amount: (v) => formatAmount(v ?? 0, currency),
      date: (v) => (v ? dateOnly.format(new Date(`${v.slice(0, 10)}T00:00:00Z`)) : '—'),
      dateTime: (v) => (v ? dt.format(new Date(v)) : '—'),
      time: (v) => (v ? tm.format(new Date(v)) : '—'),
      today: () => todayIn(timezone),
    };
  }, [data]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useFormat() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useFormat outside SettingsProvider');
  return ctx;
}
