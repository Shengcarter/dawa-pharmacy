import { z } from 'zod';
import { keysOf, PRODUCT_STATUSES, PRODUCT_TYPES, ACTIVE_STATUSES } from '../enums';
import { isValidEan13 } from '../barcode';
import {
  money, nonNegativeInt, optionalId, optionalIsoDate, optionalText, percent, requiredText, isoDate, quantity,
} from './common';

export const categorySchema = z.object({
  name: requiredText('Name', 100),
  description: optionalText(300),
});

export const manufacturerSchema = z.object({
  name: requiredText('Name', 150),
  country: optionalText(80),
});

const openingStockSchema = z.object({
  batchNumber: requiredText('Batch number', 60),
  manufactureDate: optionalIsoDate('Manufacturing date'),
  expiryDate: optionalIsoDate('Expiry date'),
  quantity: quantity('Opening quantity'),
  unitCost: money('Unit cost'),
});

const productBase = z.object({
  sku: z
    .string()
    .trim()
    .toUpperCase()
    .max(40)
    .regex(/^[A-Z0-9][A-Z0-9-_.]*$/, 'Use letters, numbers and - _ . only')
    .optional()
    .nullable()
    .or(z.literal('').transform(() => null))
    .transform((v) => v ?? null),
  barcode: z
    .string()
    .trim()
    .max(32)
    .regex(/^[0-9A-Za-z-]*$/, 'Barcode may contain digits, letters and hyphens only')
    .optional()
    .nullable()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || v.length !== 13 || !/^\d+$/.test(v) || isValidEan13(v), 'EAN-13 check digit is wrong'),
  name: requiredText('Product name', 150),
  genericName: optionalText(150),
  brandName: optionalText(150),
  productType: z.enum(keysOf(PRODUCT_TYPES), { error: 'Choose a product type' }),
  categoryId: optionalId,
  manufacturerId: optionalId,
  defaultSupplierId: optionalId,
  dosageForm: optionalText(60),
  strength: optionalText(60),
  unit: requiredText('Unit', 30),
  packSize: z.coerce.number().int().min(1, 'Pack size must be at least 1').max(10000).default(1),
  purchasePrice: money('Purchase price'),
  sellingPrice: money('Selling price'),
  wholesalePrice: money('Wholesale price').optional().nullable().or(z.literal('').transform(() => null)).transform((v) => v ?? null),
  minSellingPrice: money('Minimum selling price').optional().nullable().or(z.literal('').transform(() => null)).transform((v) => v ?? null),
  reorderLevel: nonNegativeInt('Reorder level'),
  maxStockLevel: nonNegativeInt('Maximum stock level').optional().nullable().or(z.literal('').transform(() => null)).transform((v) => v ?? null),
  requiresPrescription: z.boolean().default(false),
  isBatchTracked: z.boolean().default(true),
  taxRate: percent('Tax rate').default(0),
  status: z.enum(keysOf(PRODUCT_STATUSES)).default('active'),
  description: optionalText(2000),
  storageInstructions: optionalText(500),
});

function priceChecks<T extends z.infer<typeof productBase>>(d: T, ctx: z.RefinementCtx) {
  if (d.sellingPrice <= 0) ctx.addIssue({ code: 'custom', path: ['sellingPrice'], message: 'Selling price must be greater than zero' });
  if (d.minSellingPrice !== null && d.minSellingPrice > d.sellingPrice)
    ctx.addIssue({ code: 'custom', path: ['minSellingPrice'], message: 'Minimum price cannot exceed the selling price' });
  if (d.maxStockLevel !== null && d.maxStockLevel > 0 && d.maxStockLevel < d.reorderLevel)
    ctx.addIssue({ code: 'custom', path: ['maxStockLevel'], message: 'Maximum stock must be at least the reorder level' });
}

export const productSchema = productBase
  .extend({ openingStock: openingStockSchema.optional().nullable() })
  .superRefine((d, ctx) => {
    priceChecks(d, ctx);
    if (d.openingStock && d.isBatchTracked && !d.openingStock.expiryDate)
      ctx.addIssue({ code: 'custom', path: ['openingStock', 'expiryDate'], message: 'Expiry date is required for batch-tracked products' });
  });
export const productUpdateSchema = productBase.superRefine(priceChecks);
export type ProductInput = z.input<typeof productSchema>;
export type ProductData = z.output<typeof productSchema>;

export const productListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  search: z.string().trim().max(100).optional(),
  sort: z.enum(['name', 'sku', 'stock', 'sellingPrice', 'updatedAt', 'category']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  productType: z.string().optional(),
  medicinesOnly: z.coerce.boolean().optional(),
  status: z.enum(keysOf(PRODUCT_STATUSES)).optional(),
  stockStatus: z.enum(['in_stock', 'low_stock', 'critical', 'out_of_stock']).optional(),
  requiresPrescription: z.enum(['true', 'false']).optional(),
  supplierId: z.coerce.number().int().positive().optional(),
});

export const bulkProductStatusSchema = z.object({
  ids: z.array(z.coerce.number().int().positive()).min(1).max(500),
  status: z.enum(keysOf(PRODUCT_STATUSES)),
});

export const batchUpdateSchema = z.object({
  expiryDate: optionalIsoDate('Expiry date'),
  manufactureDate: optionalIsoDate('Manufacturing date'),
  sellingPrice: money('Selling price').optional().nullable().or(z.literal('').transform(() => null)).transform((v) => v ?? null),
  status: z.enum(['active', 'quarantined']),
  reason: requiredText('Reason', 300),
});

export const supplierSchema = z.object({
  name: requiredText('Supplier name', 150),
  contactPerson: optionalText(120),
  phone: z.string().trim().regex(/^\+?[0-9][0-9\s-]{6,18}$/, 'Enter a valid phone number'),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .optional()
    .nullable()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || z.email().safeParse(v).success, 'Enter a valid email address'),
  address: optionalText(300),
  tin: optionalText(30),
  vrn: optionalText(30),
  paymentTermsDays: z.coerce.number().int().min(0).max(365).default(30),
  creditLimit: money('Credit limit').default(0),
  status: z.enum(keysOf(ACTIVE_STATUSES)).default('active'),
  notes: optionalText(1000),
});
export type SupplierInput = z.input<typeof supplierSchema>;

export const stockAdjustmentSchema = z.object({
  batchId: z.coerce.number().int().positive('Choose a batch'),
  type: z.enum(['adjustment_in', 'adjustment_out', 'damaged', 'expired', 'correction']),
  quantity: z.coerce.number().int('Whole numbers only').min(0, 'Quantity cannot be negative').max(1_000_000),
  reason: requiredText('Reason', 300),
}).superRefine((d, ctx) => {
  if (d.type !== 'correction' && d.quantity < 1)
    ctx.addIssue({ code: 'custom', path: ['quantity'], message: 'Quantity must be at least 1' });
});

export const expiryDateSchema = isoDate('Expiry date');
