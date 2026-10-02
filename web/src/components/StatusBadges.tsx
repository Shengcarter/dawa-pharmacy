import {
  EXPIRY_BUCKETS, PAYMENT_STATUSES, PO_STATUSES, PRESCRIPTION_STATUSES, SALE_STATUSES, STOCK_STATUSES, expiryBucket,
  type ExpiryBucket, type StockStatus,
} from '@dawa/shared';
import { Badge, type Tone } from './ui';

const stockTone: Record<StockStatus, Tone> = {
  in_stock: 'success', low_stock: 'warning', critical: 'danger', out_of_stock: 'neutral', expired: 'danger',
};
export function StockBadge({ status }: { status: string }) {
  const s = status as StockStatus;
  return <Badge tone={stockTone[s] ?? 'neutral'} dot>{STOCK_STATUSES[s] ?? status}</Badge>;
}

const expiryTone: Record<ExpiryBucket, Tone> = { expired: 'danger', d30: 'warning', d60: 'caution', d90: 'caution', safe: 'neutral' };
/** Expiry date with its risk band: red expired, orange ≤30 days, yellow ≤90 days. */
export function ExpiryBadge({ date, today, showSafe = false, format }: { date: string | null; today: string; showSafe?: boolean; format: (d: string) => string }) {
  if (!date) return <span className="text-faint">—</span>;
  const bucket = expiryBucket(date, today);
  if (bucket === 'safe' && !showSafe) return <span className="num">{format(date)}</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="num">{format(date)}</span>
      {bucket !== 'safe' && <Badge tone={expiryTone[bucket]}>{bucket === 'expired' ? 'Expired' : EXPIRY_BUCKETS[bucket].replace('Within ', '≤ ')}</Badge>}
    </span>
  );
}

const poTone: Record<string, Tone> = { draft: 'neutral', pending: 'caution', ordered: 'info', partially_received: 'warning', received: 'success', cancelled: 'neutral' };
export const PoBadge = ({ status }: { status: string }) => (
  <Badge tone={poTone[status] ?? 'neutral'} dot>{PO_STATUSES[status as keyof typeof PO_STATUSES] ?? status}</Badge>
);

const saleTone: Record<string, Tone> = { completed: 'success', partially_returned: 'warning', returned: 'neutral' };
export const SaleStatusBadge = ({ status }: { status: string }) => (
  <Badge tone={saleTone[status] ?? 'neutral'}>{SALE_STATUSES[status as keyof typeof SALE_STATUSES] ?? status}</Badge>
);

const payTone: Record<string, Tone> = { paid: 'success', partial: 'warning', unpaid: 'danger' };
export const PaymentStatusBadge = ({ status }: { status: string }) => (
  <Badge tone={payTone[status] ?? 'neutral'}>{PAYMENT_STATUSES[status as keyof typeof PAYMENT_STATUSES] ?? status}</Badge>
);

const rxTone: Record<string, Tone> = { pending: 'caution', partially_dispensed: 'info', dispensed: 'success', cancelled: 'neutral' };
export const RxStatusBadge = ({ status }: { status: string }) => (
  <Badge tone={rxTone[status] ?? 'neutral'} dot>{PRESCRIPTION_STATUSES[status as keyof typeof PRESCRIPTION_STATUSES] ?? status}</Badge>
);

export const RxTag = () => (
  <span title="Prescription-only medicine" className="inline-flex h-4 items-center rounded-sm bg-info-bg px-1 text-[10.5px] font-semibold text-info ring-1 ring-inset ring-info-line">
    Rx
  </span>
);

export const ActiveBadge = ({ status }: { status: string }) =>
  status === 'active' ? <Badge tone="success" dot>Active</Badge> : <Badge tone="neutral" dot>{status[0].toUpperCase() + status.slice(1)}</Badge>;
