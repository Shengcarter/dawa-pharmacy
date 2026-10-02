import type { ExpiryBucket } from './enums';

export const DEFAULT_TIMEZONE = 'Africa/Dar_es_Salaam';

/** Calendar date (YYYY-MM-DD) "now" in the pharmacy's time zone. */
export function todayIn(timeZone: string, at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/**
 * A batch is expired once its expiry date has passed: stock expiring "2027-03-31"
 * is still sellable on 31 March and expired from 1 April.
 */
export function expiryBucket(expiryDate: string | null, today: string): ExpiryBucket {
  if (!expiryDate) return 'safe';
  const days = daysBetween(today, expiryDate);
  if (days < 0) return 'expired';
  if (days <= 30) return 'd30';
  if (days <= 60) return 'd60';
  if (days <= 90) return 'd90';
  return 'safe';
}

export const isValidIsoDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
};
