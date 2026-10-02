import { useEffect } from 'react';
import { formatAmount, formatMoney, PAYMENT_METHODS, SALE_PAYMENT_TYPES } from '@dawa/shared';
import { cn } from '@/lib/cn';

export interface ReceiptPharmacy {
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  tin: string | null;
  vrn: string | null;
  logoPath: string | null;
  currency: string;
  timezone: string;
  footer: string | null;
  paper: '80mm' | '58mm' | 'a4';
}

export interface ReceiptSale {
  invoiceNo: string;
  createdAt: string;
  cashierName: string;
  customerName: string | null;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
  paymentType: string;
  taxInclusive: boolean;
  cashTendered: number | null;
  changeGiven: number | null;
  rxNumber?: string | null;
  /** The insurer's share; the patient paid the rest. */
  insuranceAmount?: number;
  insuranceSchemeName?: string | null;
  efdReceiptNo?: string | null;
  items: { productName: string; strength?: string | null; quantity: number; unitsPerSaleUnit?: number; unitPrice: number; discountAmount: number; lineTotal: number; batchNumber?: string; expiryDate?: string | null }[];
  payments: { method: string; amount: number }[];
}

/** Merges FEFO batch splits back into one line per product and price for the customer. */
function mergeLines(items: ReceiptSale['items']) {
  const map = new Map<string, ReceiptSale['items'][number]>();
  for (const i of items) {
    const key = `${i.productName}|${i.unitPrice}|${i.unitsPerSaleUnit ?? 1}`;
    const prev = map.get(key);
    if (prev) map.set(key, { ...prev, quantity: prev.quantity + i.quantity, discountAmount: prev.discountAmount + i.discountAmount, lineTotal: prev.lineTotal + i.lineTotal });
    else map.set(key, { ...i });
  }
  return [...map.values()];
}

/**
 * Printable receipt. Thermal (80/58 mm) is a single narrow column; A4 is an
 * invoice layout. The paper size is applied to @page while it is mounted.
 */
export function Receipt({ sale, pharmacy, paper = pharmacy.paper, className }: { sale: ReceiptSale; pharmacy: ReceiptPharmacy; paper?: ReceiptPharmacy['paper']; className?: string }) {
  const cur = pharmacy.currency;
  const m = (v: number) => formatAmount(v, cur);
  const when = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: pharmacy.timezone }).format(new Date(sale.createdAt));
  const lines = mergeLines(sale.items);
  const thermal = paper !== 'a4';

  useEffect(() => {
    const style = document.createElement('style');
    style.dataset.receiptPage = 'true';
    style.textContent = thermal ? `@page { size: ${paper === '58mm' ? '58mm' : '80mm'} auto; margin: 3mm; }` : '@page { size: A4; margin: 14mm; }';
    document.head.appendChild(style);
    return () => style.remove();
  }, [paper, thermal]);

  const totals = (
    <div className={cn('space-y-0.5', thermal ? 'mt-2 border-t border-dashed border-black/40 pt-2' : 'ml-auto mt-4 w-72')}>
      <Row label="Subtotal" value={m(sale.subtotal)} />
      {sale.discountTotal > 0 && <Row label="Discount" value={`−${m(sale.discountTotal)}`} />}
      {sale.taxTotal > 0 && <Row label={sale.taxInclusive ? 'VAT (included)' : 'VAT'} value={m(sale.taxTotal)} />}
      <Row label={`TOTAL ${cur}`} value={m(sale.total)} strong />
      {Number(sale.insuranceAmount) > 0 && (
        <>
          <Row label={`Insurance (${sale.insuranceSchemeName ?? 'scheme'})`} value={m(Number(sale.insuranceAmount))} />
          <Row label="Patient share" value={m(sale.total - Number(sale.insuranceAmount))} strong />
        </>
      )}
      {sale.payments.map((p, i) => (
        <Row key={i} label={PAYMENT_METHODS[p.method as keyof typeof PAYMENT_METHODS] ?? p.method} value={m(p.amount)} />
      ))}
      {sale.cashTendered != null && <Row label="Cash tendered" value={m(sale.cashTendered)} />}
      {sale.changeGiven != null && sale.changeGiven > 0 && <Row label="Change" value={m(sale.changeGiven)} />}
      {sale.balanceDue > 0 && <Row label="Balance on account" value={m(sale.balanceDue)} strong />}
    </div>
  );

  if (thermal) {
    return (
      <div className={cn('mx-auto bg-white font-mono text-[11px] leading-snug text-black', paper === '58mm' ? 'receipt-58mm' : 'receipt-80mm', className)}>
        <div className="text-center">
          {pharmacy.logoPath && <img src={`/uploads/${pharmacy.logoPath}`} alt="" className="mx-auto mb-1 h-10 object-contain grayscale" />}
          <p className="text-[13px] font-bold uppercase">{pharmacy.name}</p>
          {pharmacy.address && <p>{pharmacy.address}</p>}
          {pharmacy.phone && <p>Tel: {pharmacy.phone}</p>}
          {pharmacy.tin && <p>TIN: {pharmacy.tin}{pharmacy.vrn ? ` · VRN: ${pharmacy.vrn}` : ''}</p>}
        </div>
        <div className="mt-2 border-t border-dashed border-black/40 pt-2">
          <Row label="Invoice" value={sale.invoiceNo} />
          <Row label="Date" value={when} />
          <Row label="Served by" value={sale.cashierName} />
          <Row label="Customer" value={sale.customerName ?? 'Walk-in'} />
          {sale.rxNumber && <Row label="Prescription" value={sale.rxNumber} />}
          {sale.efdReceiptNo && <Row label="EFD receipt" value={sale.efdReceiptNo} />}
        </div>
        <div className="mt-2 border-t border-dashed border-black/40 pt-2">
          {lines.map((l, i) => (
            <div key={i} className="mb-1">
              <p className="break-words">{l.productName}</p>
              <Row label={`  ${soldQty(l)} × ${m(l.unitPrice)}${l.discountAmount > 0 ? ` (−${m(l.discountAmount)})` : ''}`} value={m(l.lineTotal)} />
            </div>
          ))}
        </div>
        {totals}
        <div className="mt-3 border-t border-dashed border-black/40 pt-2 text-center">
          <p>Payment: {SALE_PAYMENT_TYPES[sale.paymentType as keyof typeof SALE_PAYMENT_TYPES] ?? sale.paymentType}</p>
          <p className="mt-1">{pharmacy.footer || 'Thank you for your visit. Get well soon!'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('bg-white text-[12px] text-black', className)}>
      <div className="flex items-start justify-between border-b border-black/20 pb-4">
        <div>
          {pharmacy.logoPath && <img src={`/uploads/${pharmacy.logoPath}`} alt="" className="mb-2 h-12 object-contain" />}
          <p className="text-[16px] font-bold">{pharmacy.name}</p>
          {pharmacy.address && <p>{pharmacy.address}</p>}
          <p>{[pharmacy.phone, pharmacy.email].filter(Boolean).join(' · ')}</p>
          {pharmacy.tin && <p>TIN {pharmacy.tin}{pharmacy.vrn ? ` · VRN ${pharmacy.vrn}` : ''}</p>}
        </div>
        <div className="text-right">
          <p className="text-[18px] font-semibold tracking-wide">TAX INVOICE</p>
          <p className="mt-1">No. <b>{sale.invoiceNo}</b></p>
          <p>{when}</p>
          {sale.efdReceiptNo && <p>EFD receipt {sale.efdReceiptNo}</p>}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4 py-3">
        <div><p className="text-black/60">Billed to</p><p className="font-medium">{sale.customerName ?? 'Walk-in customer'}</p></div>
        <div><p className="text-black/60">Served by</p><p className="font-medium">{sale.cashierName}</p></div>
        {sale.rxNumber && <div><p className="text-black/60">Prescription</p><p className="font-medium">{sale.rxNumber}</p></div>}
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-y border-black/30 text-left">
            <th className="py-1.5">Item</th>
            <th className="py-1.5 text-right">Qty</th>
            <th className="py-1.5 text-right">Unit price</th>
            <th className="py-1.5 text-right">Discount</th>
            <th className="py-1.5 text-right">Amount ({cur})</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} className="border-b border-black/10">
              <td className="py-1.5">{l.productName}</td>
              <td className="py-1.5 text-right">{soldQty(l)}</td>
              <td className="py-1.5 text-right">{m(l.unitPrice)}</td>
              <td className="py-1.5 text-right">{l.discountAmount > 0 ? m(l.discountAmount) : '—'}</td>
              <td className="py-1.5 text-right">{m(l.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {totals}
      <p className="mt-8 border-t border-black/20 pt-3 text-center text-black/70">{pharmacy.footer || 'Thank you for your visit.'}</p>
      <p className="mt-1 text-center text-[10px] text-black/50">Amounts in {formatMoney(0, cur).split(' ')[0]}</p>
    </div>
  );
}

/** "2 packs of 10" for pack sales, otherwise the unit count. */
function soldQty(l: { quantity: number; unitsPerSaleUnit?: number }) {
  const per = l.unitsPerSaleUnit ?? 1;
  return per > 1 ? `${l.quantity / per} pack${l.quantity / per === 1 ? '' : 's'} of ${per}` : String(l.quantity);
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn('flex justify-between gap-3', strong && 'font-bold')}>
      <span className="whitespace-pre-wrap">{label}</span>
      <span className="shrink-0 tabular-nums">{value}</span>
    </div>
  );
}
