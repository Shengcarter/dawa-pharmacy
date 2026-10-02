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

// ---------------------------------------------------------------------------
// Price rules
// ---------------------------------------------------------------------------

export interface PriceBreak {
  /** Applies once the cart holds at least this many base units of the product. */
  minQuantity: number;
  unitPrice: number;
}

export interface PricedProduct {
  sellingPrice: number;
  packSize: number;
  packSellingPrice: number | null;
  wholesalePrice: number | null;
  priceBreaks: PriceBreak[];
}

export type PriceSource = 'standard' | 'pack' | 'wholesale' | 'quantity';

export interface ResolvedPrice {
  /** Price per sold unit (one base unit, or one whole pack). */
  price: number;
  source: PriceSource;
  /** The quantity price that applied, when source is 'quantity'. */
  priceBreak?: PriceBreak;
}

const cents = (v: number) => Math.round(v * 100);

/**
 * The list price for a cart line: the lowest of the prices the customer
 * qualifies for. Wholesale customers get the wholesale price; quantity prices
 * apply to the product's total base units in the cart (loose and packs
 * together). A pack line keeps the pack price unless a per-unit rule is
 * cheaper for the whole pack.
 */
export function resolvePrice(
  p: PricedProduct,
  o: { sellBy: 'unit' | 'pack'; productBaseQuantity: number; wholesaleCustomer: boolean },
): ResolvedPrice {
  // Best per-base-unit rule price, if any.
  let rule: { cents: number; source: PriceSource; priceBreak?: PriceBreak } | null = null;
  if (o.wholesaleCustomer && p.wholesalePrice !== null && p.wholesalePrice > 0) {
    rule = { cents: cents(p.wholesalePrice), source: 'wholesale' };
  }
  const brk = p.priceBreaks
    .filter((b) => o.productBaseQuantity >= b.minQuantity)
    .sort((a, b) => a.unitPrice - b.unitPrice)[0];
  if (brk && (!rule || cents(brk.unitPrice) < rule.cents)) rule = { cents: cents(brk.unitPrice), source: 'quantity', priceBreak: brk };

  if (o.sellBy === 'pack' && p.packSellingPrice !== null) {
    if (rule && rule.cents * p.packSize < cents(p.packSellingPrice)) {
      return { price: (rule.cents * p.packSize) / 100, source: rule.source, priceBreak: rule.priceBreak };
    }
    return { price: p.packSellingPrice, source: 'pack' };
  }
  if (rule && rule.cents < cents(p.sellingPrice)) return { price: rule.cents / 100, source: rule.source, priceBreak: rule.priceBreak };
  return { price: p.sellingPrice, source: 'standard' };
}

/** The next quantity price the cart has not reached yet, to prompt the cashier. */
export function nextPriceBreak(p: PricedProduct, productBaseQuantity: number, currentPerUnitPrice: number): PriceBreak | null {
  return (
    p.priceBreaks
      .filter((b) => b.minQuantity > productBaseQuantity && cents(b.unitPrice) < cents(currentPerUnitPrice))
      .sort((a, b) => a.minQuantity - b.minQuantity)[0] ?? null
  );
}
