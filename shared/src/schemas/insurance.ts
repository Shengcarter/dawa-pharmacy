import { z } from 'zod';
import { CLAIM_PAYMENT_METHODS, CLAIM_SHORTFALL_OUTCOMES, CLAIM_STATUSES, INSURANCE_COVERAGE, keysOf } from '../enums';
import { id, isoDate, optionalEmail, optionalPhone, optionalText, percent, positiveMoney, requiredText } from './common';

export const insuranceSchemeSchema = z.object({
  code: z.string().trim().toUpperCase().min(2, 'Code is required').max(20).regex(/^[A-Z0-9-]+$/, 'Letters, numbers and - only'),
  name: requiredText('Scheme name', 120),
  contactName: optionalText(120),
  phone: optionalPhone,
  email: optionalEmail,
  address: optionalText(300),
  copayPercent: percent('Co-pay').default(0),
  coverage: z.enum(keysOf(INSURANCE_COVERAGE)).default('listed_only'),
  requiresPrescription: z.boolean().default(true),
  claimTermsDays: z.coerce.number().int().min(0).max(365).default(30),
  status: z.enum(['active', 'inactive']).default('active'),
  notes: optionalText(1000),
});
export type InsuranceSchemeInput = z.input<typeof insuranceSchemeSchema>;

/** Adds or changes agreed prices; a price of null removes the product from the list. */
export const schemePricesSchema = z.object({
  prices: z
    .array(z.object({ productId: id('Product'), unitPrice: positiveMoney('Price').nullable() }))
    .min(1, 'Nothing to save')
    .max(5000),
});

export const claimListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  schemeId: z.coerce.number().int().positive().optional(),
  status: z.enum([...keysOf(CLAIM_STATUSES), 'open', 'overdue'] as [string, ...string[]]).optional(),
  from: isoDate('From').optional(),
  to: isoDate('To').optional(),
  search: z.string().trim().max(100).optional(),
});

export const submitClaimsSchema = z.object({
  claimIds: z.array(z.coerce.number().int().positive()).min(1, 'Select claims to submit').max(500),
  submissionRef: optionalText(80),
});

export const claimPaymentSchema = z.object({
  amount: positiveMoney('Amount'),
  paidOn: isoDate('Payment date'),
  method: z.enum(keysOf(CLAIM_PAYMENT_METHODS)),
  reference: optionalText(80),
});

export const closeClaimSchema = z.object({
  outcome: z.enum(keysOf(CLAIM_SHORTFALL_OUTCOMES)),
  reason: requiredText('Reason', 300),
});
