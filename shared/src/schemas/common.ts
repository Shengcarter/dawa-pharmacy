import { z } from 'zod';
import { isValidIsoDate } from '../dates';

/** Trimmed optional text; empty strings become null. */
export const optionalText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max, `Must be ${max} characters or fewer`)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const requiredText = (label: string, max = 200) =>
  z.string({ error: `${label} is required` }).trim().min(1, `${label} is required`).max(max, `${label} is too long`);

export const money = (label = 'Amount') =>
  z.coerce
    .number({ error: `${label} must be a number` })
    .finite(`${label} must be a number`)
    .min(0, `${label} cannot be negative`)
    .max(99_999_999_999, `${label} is too large`)
    .transform((v) => Math.round(v * 100) / 100);

export const positiveMoney = (label = 'Amount') => money(label).refine((v) => v > 0, `${label} must be greater than zero`);

export const quantity = (label = 'Quantity') =>
  z.coerce
    .number({ error: `${label} must be a number` })
    .int(`${label} must be a whole number`)
    .min(1, `${label} must be at least 1`)
    .max(1_000_000, `${label} is too large`);

export const nonNegativeInt = (label: string) =>
  z.coerce.number({ error: `${label} must be a number` }).int(`${label} must be a whole number`).min(0, `${label} cannot be negative`).max(10_000_000);

export const percent = (label = 'Rate') =>
  z.coerce.number({ error: `${label} must be a number` }).min(0, `${label} cannot be negative`).max(100, `${label} cannot exceed 100%`);

export const isoDate = (label = 'Date') =>
  z.string({ error: `${label} is required` }).refine(isValidIsoDate, `${label} must be a valid date`);

export const optionalIsoDate = (label = 'Date') =>
  z
    .string()
    .optional()
    .nullable()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || isValidIsoDate(v), `${label} must be a valid date`);

export const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9][0-9\s-]{6,18}$/, 'Enter a valid phone number, e.g. +255 712 345 678');

export const optionalPhone = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^\+?[0-9][0-9\s-]{6,18}$/.test(v), 'Enter a valid phone number, e.g. +255 712 345 678');

export const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .optional()
  .nullable()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || z.email().safeParse(v).success, 'Enter a valid email address');

export const id = (label = 'Record') => z.coerce.number({ error: `${label} is required` }).int().positive(`${label} is required`);
export const optionalId = z.coerce
  .number()
  .int()
  .positive()
  .optional()
  .nullable()
  .or(z.literal('').transform(() => null))
  .transform((v) => v ?? null);

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  search: z.string().trim().max(100).optional(),
  sort: z.string().trim().max(40).optional(),
  order: z.enum(['asc', 'desc']).optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuery>;

export const dateRangeQuery = z.object({
  from: optionalIsoDate('From date'),
  to: optionalIsoDate('To date'),
});

export interface Paginated<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}
