/** Domain enumerations with display labels. Database CHECK constraints use the same values. */
const labels = <T extends string>(map: Record<T, string>) => map;
export const keysOf = <T extends string>(map: Record<T, string>) => Object.keys(map) as [T, ...T[]];

export const PRODUCT_TYPES = labels({
  tablet: 'Tablet',
  capsule: 'Capsule',
  syrup: 'Syrup / Suspension',
  injection: 'Injection',
  cream: 'Cream',
  ointment: 'Ointment',
  drops: 'Drops',
  powder: 'Powder / Sachet',
  inhaler: 'Inhaler',
  medical_device: 'Medical device',
  supplement: 'Supplement',
  personal_care: 'Personal care',
  other: 'Other',
});
export type ProductType = keyof typeof PRODUCT_TYPES;
/** Product types treated as medicines (the "Medicines" view). */
export const MEDICINE_TYPES: ProductType[] = [
  'tablet', 'capsule', 'syrup', 'injection', 'cream', 'ointment', 'drops', 'powder', 'inhaler',
];

export const PRODUCT_STATUSES = labels({ active: 'Active', inactive: 'Inactive', discontinued: 'Discontinued' });
export type ProductStatus = keyof typeof PRODUCT_STATUSES;

export const STOCK_STATUSES = labels({
  in_stock: 'In stock',
  low_stock: 'Low stock',
  critical: 'Critical',
  out_of_stock: 'Out of stock',
  expired: 'Expired',
});
export type StockStatus = keyof typeof STOCK_STATUSES;

export const EXPIRY_BUCKETS = labels({
  expired: 'Expired',
  d30: 'Within 30 days',
  d60: 'Within 60 days',
  d90: 'Within 90 days',
  safe: 'Safe',
});
export type ExpiryBucket = keyof typeof EXPIRY_BUCKETS;

export const BATCH_STATUSES = labels({ active: 'Active', quarantined: 'Quarantined', disposed: 'Disposed' });
export type BatchStatus = keyof typeof BATCH_STATUSES;

export const MOVEMENT_TYPES = labels({
  opening: 'Opening stock',
  purchase: 'Purchase',
  sale: 'Sale',
  sale_return: 'Customer return',
  adjustment_in: 'Adjustment (in)',
  adjustment_out: 'Adjustment (out)',
  damaged: 'Damaged',
  expired: 'Expired disposal',
  correction: 'Count correction',
  transfer_in: 'Transfer in',
  transfer_out: 'Transfer out',
});
export type MovementType = keyof typeof MOVEMENT_TYPES;

/** Adjustment types a user can record by hand. */
export const ADJUSTMENT_TYPES = labels({
  adjustment_in: 'Stock found / added',
  adjustment_out: 'Stock lost / missing',
  damaged: 'Damaged goods',
  expired: 'Expired — dispose',
  correction: 'Count correction (set quantity)',
});
export type AdjustmentType = keyof typeof ADJUSTMENT_TYPES;

export const PAYMENT_METHODS = labels({
  cash: 'Cash',
  card: 'Card',
  mobile_money: 'Mobile Money',
  bank_transfer: 'Bank Transfer',
  store_credit: 'Store credit',
});
export type PaymentMethod = keyof typeof PAYMENT_METHODS;
/** What the POS shows as the sale's method; `credit` = left on the customer's account. */
export const SALE_PAYMENT_TYPES = labels({
  cash: 'Cash',
  card: 'Card',
  mobile_money: 'Mobile Money',
  bank_transfer: 'Bank Transfer',
  store_credit: 'Store credit',
  credit: 'Credit',
  split: 'Split',
});
export type SalePaymentType = keyof typeof SALE_PAYMENT_TYPES;

export const SALE_STATUSES = labels({
  completed: 'Completed',
  partially_returned: 'Partially returned',
  returned: 'Returned',
});
export type SaleStatus = keyof typeof SALE_STATUSES;

export const PAYMENT_STATUSES = labels({ paid: 'Paid', partial: 'Partly paid', unpaid: 'Unpaid' });
export type PaymentStatus = keyof typeof PAYMENT_STATUSES;

export const RETURN_REASONS = labels({
  wrong_item: 'Wrong item dispensed',
  adverse_reaction: 'Adverse reaction',
  not_needed: 'No longer needed',
  damaged_packaging: 'Damaged packaging',
  near_expiry: 'Short expiry',
  prescription_changed: 'Prescription changed',
  other: 'Other',
});
export type ReturnReason = keyof typeof RETURN_REASONS;

export const RETURN_CONDITIONS = labels({
  resellable: 'Resellable — return to stock',
  damaged: 'Damaged — do not restock',
  opened: 'Opened — do not restock',
});
export type ReturnCondition = keyof typeof RETURN_CONDITIONS;

export const REFUND_METHODS = labels({
  cash: 'Cash refund',
  mobile_money: 'Mobile Money refund',
  card: 'Card refund',
  bank_transfer: 'Bank transfer',
  store_credit: 'Store credit',
});
export type RefundMethod = keyof typeof REFUND_METHODS;

export const PO_STATUSES = labels({
  draft: 'Draft',
  pending: 'Pending approval',
  ordered: 'Ordered',
  partially_received: 'Partially received',
  received: 'Received',
  cancelled: 'Cancelled',
});
export type PurchaseOrderStatus = keyof typeof PO_STATUSES;

export const PRESCRIPTION_STATUSES = labels({
  pending: 'Pending',
  partially_dispensed: 'Partially dispensed',
  dispensed: 'Dispensed',
  cancelled: 'Cancelled',
});
export type PrescriptionStatus = keyof typeof PRESCRIPTION_STATUSES;

export const CUSTOMER_TYPES = labels({
  walk_in: 'Walk-in',
  regular: 'Regular',
  insurance: 'Insurance',
  corporate: 'Corporate',
  wholesale: 'Wholesale',
});
export type CustomerType = keyof typeof CUSTOMER_TYPES;

export const GENDERS = labels({ female: 'Female', male: 'Male', other: 'Other', unspecified: 'Prefer not to say' });
export type Gender = keyof typeof GENDERS;

export const ACTIVE_STATUSES = labels({ active: 'Active', inactive: 'Inactive' });
export type ActiveStatus = keyof typeof ACTIVE_STATUSES;

export const USER_STATUSES = labels({ active: 'Active', suspended: 'Suspended' });
export type UserStatus = keyof typeof USER_STATUSES;

export const EXPENSE_PAYMENT_METHODS = labels({
  cash: 'Cash',
  mobile_money: 'Mobile Money',
  bank_transfer: 'Bank Transfer',
  card: 'Card',
  cheque: 'Cheque',
});
export type ExpensePaymentMethod = keyof typeof EXPENSE_PAYMENT_METHODS;

export const SUPPLIER_PAYMENT_METHODS = labels({
  bank_transfer: 'Bank Transfer',
  mobile_money: 'Mobile Money',
  cash: 'Cash',
  cheque: 'Cheque',
});
export type SupplierPaymentMethod = keyof typeof SUPPLIER_PAYMENT_METHODS;

export const NOTIFICATION_SEVERITIES = labels({ info: 'Info', success: 'Success', warning: 'Warning', critical: 'Critical' });
export type NotificationSeverity = keyof typeof NOTIFICATION_SEVERITIES;

export const NOTIFICATION_TYPES = labels({
  low_stock: 'Low stock',
  out_of_stock: 'Out of stock',
  expiring: 'Expiring soon',
  expired: 'Expired stock',
  po_pending: 'Purchase order waiting',
  supplier_overdue: 'Supplier payment overdue',
  sale_failed: 'Failed transaction',
  system: 'System',
});
export type NotificationType = keyof typeof NOTIFICATION_TYPES;

export const DOSAGE_FORMS = [
  'Tablet', 'Film-coated tablet', 'Chewable tablet', 'Effervescent tablet', 'Capsule', 'Syrup',
  'Suspension', 'Injection', 'Infusion', 'Cream', 'Ointment', 'Gel', 'Eye drops', 'Ear drops',
  'Nasal drops', 'Powder', 'Sachet', 'Inhaler', 'Solution', 'Lotion', 'Pessary', 'Suppository', 'Device',
] as const;

export const UNITS = ['tablet', 'capsule', 'bottle', 'vial', 'ampoule', 'tube', 'sachet', 'piece', 'pack', 'box', 'strip'] as const;
