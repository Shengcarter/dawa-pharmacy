import type { AuthUser, Paginated, Settings } from '@dawa/shared';

export type { AuthUser, Paginated };

export interface AppSettings {
  general: Settings['general'];
  inventory: Settings['inventory'];
  sales: Settings['sales'];
  notifications?: Settings['notifications'];
  system?: Settings['system'];
  meta: { currencies: { code: string; name: string }[]; emailEnabled: boolean };
}

export interface ProductRow {
  id: number;
  sku: string;
  barcode: string | null;
  name: string;
  genericName: string | null;
  brandName: string | null;
  productType: string;
  strength: string | null;
  dosageForm: string | null;
  unit: string;
  packSize: number;
  purchasePrice: number;
  sellingPrice: number;
  reorderLevel: number;
  requiresPrescription: boolean;
  isBatchTracked: boolean;
  status: string;
  taxRate: number;
  imagePath: string | null;
  updatedAt: string;
  categoryId: number | null;
  categoryName: string | null;
  manufacturerName: string | null;
  onHand: number;
  sellable: number;
  stockValue: number;
  nearestExpiry: string | null;
  batchCount: number;
  stockStatus: string;
}

export interface BatchRow {
  id: number;
  batchNumber: string;
  manufactureDate: string | null;
  expiryDate: string | null;
  quantityReceived: number;
  quantityOnHand: number;
  unitCost?: number;
  sellingPrice: number;
  status: string;
  receivedAt: string;
  stockValue: number;
  daysToExpiry: number | null;
  productId: number;
  sku: string;
  productName: string;
  strength: string | null;
  unit: string;
  reorderLevel: number;
  categoryName: string | null;
  supplierName: string | null;
  productSellable: number;
  stockStatus: string;
}

export interface PosProduct {
  id: number;
  sku: string;
  barcode: string | null;
  name: string;
  genericName: string | null;
  strength: string | null;
  dosageForm: string | null;
  unit: string;
  sellingPrice: number;
  minSellingPrice: number | null;
  packSize: number;
  packSellingPrice: number | null;
  wholesalePrice: number | null;
  priceBreaks: { minQuantity: number; unitPrice: number }[];
  taxRate: number;
  requiresPrescription: boolean;
  imagePath: string | null;
  batches: { id: number; batchNumber: string; expiryDate: string | null; quantity: number }[];
  sellable: number;
}

export interface CustomerOption {
  id: number;
  code: string;
  fullName: string;
  phone: string | null;
  customerType: string;
  /** The patient's active insurance scheme (from the till lookup). */
  insurance?: { id: number; code: string; name: string; copayPercent: number; coverage: 'listed_only' | 'all_products'; requiresPrescription: boolean; hasMemberNo: boolean } | null;
  creditLimit: number;
  storeCreditBalance: number;
  outstanding: number;
}

export interface Option {
  id: number;
  name: string;
}
