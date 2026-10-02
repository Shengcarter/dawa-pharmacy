/**
 * Currency configuration and money arithmetic.
 *
 * Amounts are stored as NUMERIC(14,2) and calculated in integer minor units
 * ("cents", always 1/100) so rounding is deterministic. Display precision is a
 * property of the configured currency (TZS shows no decimals).
 */
export interface CurrencyConfig {
  code: string;
  name: string;
  /** Digits shown to users. Storage precision is always 2. */
  displayDecimals: number;
  locale: string;
}

export const CURRENCIES: Record<string, CurrencyConfig> = {
  TZS: { code: 'TZS', name: 'Tanzanian Shilling', displayDecimals: 0, locale: 'en-TZ' },
  KES: { code: 'KES', name: 'Kenyan Shilling', displayDecimals: 0, locale: 'en-KE' },
  UGX: { code: 'UGX', name: 'Ugandan Shilling', displayDecimals: 0, locale: 'en-UG' },
  RWF: { code: 'RWF', name: 'Rwandan Franc', displayDecimals: 0, locale: 'en-RW' },
  USD: { code: 'USD', name: 'US Dollar', displayDecimals: 2, locale: 'en-US' },
};
export const DEFAULT_CURRENCY = 'TZS';

export function currencyConfig(code: string): CurrencyConfig {
  return CURRENCIES[code] ?? { code, name: code, displayDecimals: 2, locale: 'en-US' };
}

const formatters = new Map<string, Intl.NumberFormat>();
function numberFormat(decimals: number, locale: string) {
  const key = `${locale}:${decimals}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    formatters.set(key, f);
  }
  return f;
}

/** "TZS 25,000" — always code-prefixed so receipts and reports are unambiguous. */
export function formatMoney(amount: number | string | null | undefined, currency = DEFAULT_CURRENCY): string {
  const cfg = currencyConfig(currency);
  const value = Number(amount ?? 0);
  const f = numberFormat(cfg.displayDecimals, cfg.locale);
  const text = f.format(Math.abs(value));
  return `${value < 0 ? '−' : ''}${cfg.code} ${text}`;
}

/** Number without currency code, for dense tables. */
export function formatAmount(amount: number | string | null | undefined, currency = DEFAULT_CURRENCY): string {
  const cfg = currencyConfig(currency);
  return numberFormat(cfg.displayDecimals, cfg.locale).format(Number(amount ?? 0));
}

export const toCents = (amount: number | string | null | undefined): number =>
  Math.round(Number(amount ?? 0) * 100);
export const fromCents = (cents: number): number => Math.round(cents) / 100;

/**
 * Splits `totalCents` across `weights` proportionally using the largest
 * remainder method, so the parts always add up exactly.
 */
export function allocateCents(totalCents: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0 || totalCents === 0) return weights.map(() => 0);
  const raw = weights.map((w) => (totalCents * w) / sum);
  const floors = raw.map((r) => Math.floor(r));
  let remainder = totalCents - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remainder <= 0) break;
    floors[i] += 1;
    remainder -= 1;
  }
  return floors;
}
