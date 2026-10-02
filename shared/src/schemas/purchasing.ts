import { z } from 'zod';
import { keysOf, SUPPLIER_PAYMENT_METHODS } from '../enums';
import { id, isoDate, money, optionalIsoDate, optionalText, percent, positiveMoney, quantity, requiredText } from './common';

export const purchaseOrderItemSchema = z.object({
  productId: id('Product'),
  quantity: quantity(),
  unitCost: money('Unit cost'),
  discount: money('Discount').default(0),
  taxRate: percent('Tax rate').default(0),
});

export const purchaseOrderSchema = z
  .object({
    supplierId: id('Supplier'),
    orderDate: isoDate('Order date'),
    expectedDate: optionalIsoDate('Expected delivery'),
    notes: optionalText(1000),
    items: z.array(purchaseOrderItemSchema).min(1, 'Add at least one product'),
  })
  .superRefine((d, ctx) => {
    if (d.expectedDate && d.expectedDate < d.orderDate)
      ctx.addIssue({ code: 'custom', path: ['expectedDate'], message: 'Expected delivery cannot be before the order date' });
    const seen = new Set<number>();
    d.items.forEach((item, i) => {
      if (seen.has(item.productId)) ctx.addIssue({ code: 'custom', path: ['items', i, 'productId'], message: 'Product is already on this order' });
      seen.add(item.productId);
      if (item.discount > item.quantity * item.unitCost)
        ctx.addIssue({ code: 'custom', path: ['items', i, 'discount'], message: 'Discount exceeds line value' });
    });
  });
export type PurchaseOrderInput = z.input<typeof purchaseOrderSchema>;

export const poTransitionSchema = z.object({
  action: z.enum(['submit', 'approve', 'cancel', 'reopen']),
  reason: optionalText(300),
});

export const receiveItemSchema = z
  .object({
    purchaseOrderItemId: z.coerce.number().int().positive().optional().nullable().transform((v) => v ?? null),
    productId: id('Product'),
    batchNumber: requiredText('Batch number', 60),
    manufactureDate: optionalIsoDate('Manufacturing date'),
    expiryDate: optionalIsoDate('Expiry date'),
    quantity: quantity('Quantity received'),
    unitCost: money('Purchase price'),
    sellingPrice: money('Selling price').optional().nullable().or(z.literal('').transform(() => null)).transform((v) => v ?? null),
  })
  .superRefine((d, ctx) => {
    if (d.manufactureDate && d.expiryDate && d.manufactureDate >= d.expiryDate)
      ctx.addIssue({ code: 'custom', path: ['expiryDate'], message: 'Expiry must be after the manufacturing date' });
  });

export const goodsReceiptSchema = z.object({
  purchaseOrderId: z.coerce.number().int().positive().optional().nullable().transform((v) => v ?? null),
  supplierId: id('Supplier'),
  supplierInvoiceNo: optionalText(60),
  receivedDate: isoDate('Received date'),
  notes: optionalText(1000),
  updateSellingPrices: z.boolean().default(false),
  items: z.array(receiveItemSchema).min(1, 'Add at least one line'),
});
export type GoodsReceiptInput = z.input<typeof goodsReceiptSchema>;

export const supplierPaymentSchema = z.object({
  supplierId: id('Supplier'),
  goodsReceiptId: z.coerce.number().int().positive().optional().nullable().transform((v) => v ?? null),
  amount: positiveMoney('Amount'),
  method: z.enum(keysOf(SUPPLIER_PAYMENT_METHODS)),
  reference: optionalText(80),
  paidDate: isoDate('Payment date'),
  notes: optionalText(500),
});
