import { fromCents, toCents } from '@dawa/shared';

export { toCents, fromCents };
/** NUMERIC column (string) → number. */
export const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
export const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
/** Cents → NUMERIC parameter string, exact to two decimals. */
export const centsParam = (cents: number): string => (Math.round(cents) / 100).toFixed(2);
