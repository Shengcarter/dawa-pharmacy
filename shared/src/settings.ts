import { z } from 'zod';
import { DEFAULT_CURRENCY } from './currency';
import { DEFAULT_TIMEZONE } from './dates';
import { optionalEmail, optionalText, requiredText } from './schemas/common';

export const generalSettingsSchema = z.object({
  pharmacyName: requiredText('Pharmacy name', 120),
  legalName: optionalText(150),
  address: optionalText(300),
  phone: optionalText(40),
  email: optionalEmail,
  tin: optionalText(30),
  vrn: optionalText(30),
  licenseNo: optionalText(60),
  logoPath: optionalText(300),
  currency: z.string().trim().length(3).toUpperCase().default(DEFAULT_CURRENCY),
  timezone: z.string().default(DEFAULT_TIMEZONE),
});

export const inventorySettingsSchema = z.object({
  defaultReorderLevel: z.coerce.number().int().min(0).max(100000).default(20),
  /** Below this share of the reorder level an item is "critical". */
  criticalStockPercent: z.coerce.number().int().min(1).max(100).default(30),
  expiryWarningDays: z.coerce.number().int().min(7).max(365).default(90),
  /** Read-only: stock is valued at each batch's actual cost (specific identification). */
  valuationMethod: z.literal('batch_cost').default('batch_cost'),
});

export const salesSettingsSchema = z.object({
  taxInclusive: z.boolean().default(true),
  defaultTaxRate: z.coerce.number().min(0).max(100).default(0),
  maxDiscountPercent: z.coerce.number().min(0).max(100).default(10),
  requirePrescriptionForRx: z.boolean().default(true),
  allowCreditSales: z.boolean().default(true),
  receiptPaper: z.enum(['80mm', '58mm', 'a4']).default('80mm'),
  receiptFooter: optionalText(300),
  showTinOnReceipt: z.boolean().default(true),
});

export const notificationSettingsSchema = z.object({
  lowStock: z.boolean().default(true),
  expiry: z.boolean().default(true),
  purchaseOrderPendingDays: z.coerce.number().int().min(1).max(60).default(3),
  supplierOverdue: z.boolean().default(true),
});

export const systemSettingsSchema = z.object({
  sessionHours: z.coerce.number().int().min(1).max(24 * 30).default(12),
  auditRetentionDays: z.coerce.number().int().min(365).max(3650).default(2555),
  backupRetentionCount: z.coerce.number().int().min(1).max(365).default(14),
  autoBackupDaily: z.boolean().default(false),
});

export const settingsSchemas = {
  general: generalSettingsSchema,
  inventory: inventorySettingsSchema,
  sales: salesSettingsSchema,
  notifications: notificationSettingsSchema,
  system: systemSettingsSchema,
} as const;
export type SettingsSection = keyof typeof settingsSchemas;
export type Settings = { [K in SettingsSection]: z.output<(typeof settingsSchemas)[K]> };

export const SETTINGS_DEFAULTS: Settings = {
  general: generalSettingsSchema.parse({ pharmacyName: 'My Pharmacy' }),
  inventory: inventorySettingsSchema.parse({}),
  sales: salesSettingsSchema.parse({}),
  notifications: notificationSettingsSchema.parse({}),
  system: systemSettingsSchema.parse({}),
};
