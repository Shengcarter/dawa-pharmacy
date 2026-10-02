import { z } from 'zod';
import { CUSTOMER_TYPES, GENDERS, keysOf, PAYMENT_METHODS, REFUND_METHODS, RETURN_CONDITIONS, RETURN_REASONS } from '../enums';
import {
  id, money, optionalEmail, optionalId, optionalIsoDate, optionalPhone, optionalText, positiveMoney, quantity, requiredText,
} from './common';

export const saleLineSchema = z.object({
  productId: id('Product'),
  /** Number of selling units, or of whole packs when sellBy is 'pack'. */
  quantity: quantity(),
  sellBy: z.enum(['unit', 'pack']).default('unit'),
  /** Optional manual batch choice; otherwise FEFO allocation. */
  batchId: optionalId,
  /** Line price override (permission-checked); defaults to the product price. */
  unitPrice: money('Unit price').optional().nullable().transform((v) => v ?? null),
  discount: money('Discount').default(0),
});

export const salePaymentSchema = z.object({
  method: z.enum(keysOf(PAYMENT_METHODS)),
  amount: positiveMoney('Payment amount'),
  reference: optionalText(80),
});

export const saleSchema = z.object({
  customerId: optionalId,
  prescriptionId: optionalId,
  items: z.array(saleLineSchema).min(1, 'The cart is empty').max(200),
  cartDiscount: money('Cart discount').default(0),
  payments: z.array(salePaymentSchema).max(5).default([]),
  /** Cash handed over (for change calculation on cash payments). */
  cashTendered: money('Cash tendered').optional().nullable().transform((v) => v ?? null),
  /** When true the unpaid remainder is left on the customer's account. */
  onCredit: z.boolean().default(false),
  /** Bill the customer's insurance scheme: scheme prices, the patient pays the co-pay, the rest is claimed. */
  useInsurance: z.boolean().default(false),
  notes: optionalText(500),
  /** Client-generated id that makes retries safe (no double sales). */
  idempotencyKey: z.string().trim().min(8).max(64).optional().nullable().transform((v) => v ?? null),
});
export type SaleInput = z.input<typeof saleSchema>;

export const recordSalePaymentSchema = z.object({
  method: z.enum(['cash', 'card', 'mobile_money', 'bank_transfer']),
  amount: positiveMoney('Amount'),
  reference: optionalText(80),
  notes: optionalText(300),
});

export const saleReturnSchema = z.object({
  saleId: id('Sale'),
  reason: z.enum(keysOf(RETURN_REASONS)),
  refundMethod: z.enum(keysOf(REFUND_METHODS)),
  notes: optionalText(500),
  items: z
    .array(
      z.object({
        saleItemId: id('Sale line'),
        quantity: quantity('Return quantity'),
        condition: z.enum(keysOf(RETURN_CONDITIONS)),
      }),
    )
    .min(1, 'Select at least one item to return'),
});
export type SaleReturnInput = z.input<typeof saleReturnSchema>;

export const customerSchema = z.object({
  fullName: requiredText('Full name', 150),
  phone: optionalPhone,
  email: optionalEmail,
  address: optionalText(300),
  dateOfBirth: optionalIsoDate('Date of birth'),
  gender: z.enum(keysOf(GENDERS)).optional().nullable().transform((v) => v ?? null),
  customerType: z.enum(keysOf(CUSTOMER_TYPES)).default('regular'),
  insuranceSchemeId: optionalId,
  insuranceMemberNo: optionalText(60),
  creditLimit: money('Credit limit').default(0),
  notes: optionalText(1000),
  status: z.enum(['active', 'inactive']).default('active'),
});
export type CustomerInput = z.input<typeof customerSchema>;

export const prescriptionItemSchema = z.object({
  productId: id('Medicine'),
  dosageInstructions: requiredText('Dosage instructions', 300),
  quantity: quantity('Quantity'),
  durationDays: z.coerce.number().int().min(0).max(3650).optional().nullable().transform((v) => v ?? null),
  refillsAllowed: z.coerce.number().int().min(0).max(12).default(0),
});

export const prescriptionSchema = z.object({
  customerId: id('Patient'),
  prescriberName: requiredText('Prescriber name', 150),
  prescriberFacility: optionalText(150),
  prescriberRegNo: optionalText(60),
  prescriptionDate: z.string().refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v), 'Prescription date is required'),
  validUntil: optionalIsoDate('Valid until'),
  diagnosisNote: optionalText(300),
  notes: optionalText(1000),
  items: z.array(prescriptionItemSchema).min(1, 'Add at least one medicine'),
});
export type PrescriptionInput = z.input<typeof prescriptionSchema>;

export const expenseSchema = z.object({
  categoryId: id('Category'),
  description: requiredText('Description', 300),
  amount: positiveMoney('Amount'),
  paymentMethod: z.enum(['cash', 'mobile_money', 'bank_transfer', 'card', 'cheque']),
  expenseDate: z.string().refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v), 'Date is required'),
  paidTo: optionalText(150),
  employeeId: optionalId,
  reference: optionalText(80),
  notes: optionalText(1000),
});
export type ExpenseInput = z.input<typeof expenseSchema>;

export const efdReceiptSchema = z.object({
  efdReceiptNo: z.string().trim().max(60).regex(/^[A-Za-z0-9\-\/ ]*$/, 'Letters, numbers, - and / only').transform((v) => v || null),
});
