import { allocateCents } from './currency';

/**
 * Sale-line maths shared by the POS preview and the API. The API recomputes
 * every figure itself; the client copy only exists so the cart is instant.
 * All values are integer cents.
 */
export interface LineInput {
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
  taxRate: number; // percent, e.g. 18
}

export interface LineTotals {
  grossCents: number; // quantity × unit price, before discount
  discountCents: number;
  netCents: number; // revenue excluding tax
  taxCents: number;
  totalCents: number; // what the customer pays for the line
}

export function computeLine(line: LineInput, taxInclusive: boolean): LineTotals {
  const grossCents = line.quantity * line.unitPriceCents;
  const discountCents = Math.min(Math.max(line.discountCents, 0), grossCents);
  const afterDiscount = grossCents - discountCents;
  const r = line.taxRate;
  if (r <= 0) {
    return { grossCents, discountCents, netCents: afterDiscount, taxCents: 0, totalCents: afterDiscount };
  }
  if (taxInclusive) {
    const taxCents = Math.round((afterDiscount * r) / (100 + r));
    return { grossCents, discountCents, netCents: afterDiscount - taxCents, taxCents, totalCents: afterDiscount };
  }
  const taxCents = Math.round((afterDiscount * r) / 100);
  return { grossCents, discountCents, netCents: afterDiscount, taxCents, totalCents: afterDiscount + taxCents };
}

export interface CartTotals {
  lines: LineTotals[];
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
}

/**
 * Applies an optional cart-level discount (spread across lines in proportion
 * to their value after line discounts) and totals the cart.
 */
export function computeCart(lines: LineInput[], cartDiscountCents: number, taxInclusive: boolean): CartTotals {
  const afterLineDiscount = lines.map((l) => Math.max(l.quantity * l.unitPriceCents - l.discountCents, 0));
  const extra = allocateCents(Math.max(cartDiscountCents, 0), afterLineDiscount);
  const computed = lines.map((l, i) => computeLine({ ...l, discountCents: l.discountCents + extra[i] }, taxInclusive));
  const sum = (k: keyof LineTotals) => computed.reduce((a, l) => a + l[k], 0);
  return {
    lines: computed,
    subtotalCents: sum('grossCents'),
    discountCents: sum('discountCents'),
    taxCents: sum('taxCents'),
    totalCents: sum('totalCents'),
  };
}
