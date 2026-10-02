import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList } from 'lucide-react';
import { api } from '@/lib/api';
import { useDebounced } from '@/lib/hooks';
import { useFormat } from '@/lib/settings';
import type { CustomerOption, PosProduct } from '@/lib/types';
import { Button, EmptyState, Modal, SearchInput, Spinner } from '@/components/ui';
import { RxStatusBadge } from '@/components/StatusBadges';

export interface LoadedPrescription {
  id: number;
  rxNumber: string;
  prescriberName: string;
  customer: CustomerOption;
  items: { id: number; quantity: number; quantityRemaining: number; dosageInstructions: string; product: PosProduct }[];
}

interface RxListItem { id: number; rxNumber: string; prescriptionDate: string; status: string; customerName: string; customerPhone: string | null; prescriberName: string; itemCount: number }
interface RxDetail {
  id: number; rxNumber: string; prescriberName: string; customerId: number; customerName: string; customerPhone: string | null; customerCode: string;
  status: string; isExpired: boolean;
  items: { id: number; productId: number; sku: string; quantity: number; quantityRemaining: number; dosageInstructions: string }[];
}

/** Loads a prescription with live stock for each item, ready for the cart. */
async function load(id: number): Promise<LoadedPrescription> {
  const rx = await api.get<RxDetail>(`/prescriptions/${id}`);
  if (rx.status === 'cancelled') throw new Error(`${rx.rxNumber} was cancelled.`);
  if (rx.status === 'dispensed') throw new Error(`${rx.rxNumber} has been fully dispensed.`);
  if (rx.isExpired) throw new Error(`${rx.rxNumber} has expired.`);
  const [customers, ...products] = await Promise.all([
    api.get<CustomerOption[]>('/customers/lookup', { q: rx.customerCode }),
    ...rx.items.map((i) => api.get<{ results: PosProduct[] }>('/products/pos-search', { q: i.sku })),
  ]);
  const customer = customers.find((c) => c.id === rx.customerId);
  if (!customer) throw new Error('The patient record is inactive.');
  return {
    id: rx.id,
    rxNumber: rx.rxNumber,
    prescriberName: rx.prescriberName,
    customer,
    items: rx.items.map((i, idx) => ({
      id: i.id,
      quantity: i.quantity,
      quantityRemaining: i.quantityRemaining,
      dosageInstructions: i.dosageInstructions,
      product: products[idx].results.find((p) => p.id === i.productId)!,
    })).filter((i) => i.product),
  };
}

export function PrescriptionPicker({ open, onClose, onPick, today }: { open: boolean; onClose: () => void; onPick: (rx: LoadedPrescription) => void; today: string }) {
  const { date } = useFormat();
  const [term, setTerm] = useState('');
  const [loading, setLoading] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const q = useDebounced(term, 200);
  const list = useQuery({
    queryKey: ['rx-open', q],
    queryFn: async () => {
      const [pending, partial] = await Promise.all([
        api.get<{ data: RxListItem[] }>('/prescriptions', { status: 'pending', search: q, pageSize: 20 }),
        api.get<{ data: RxListItem[] }>('/prescriptions', { status: 'partially_dispensed', search: q, pageSize: 20 }),
      ]);
      return [...pending.data, ...partial.data].sort((a, b) => b.prescriptionDate.localeCompare(a.prescriptionDate));
    },
    enabled: open,
  });
  return (
    <Modal open={open} onClose={onClose} title="Dispense a prescription" description="Prescriptions waiting to be dispensed or with refills remaining." size="lg">
      <SearchInput value={term} onChange={setTerm} placeholder="Search Rx number, patient name or phone" autoFocus />
      {error && <p className="mt-2 text-[12.5px] text-danger">{error}</p>}
      <div className="mt-3 overflow-hidden rounded-md border border-line">
        {list.isLoading ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : !list.data?.length ? (
          <EmptyState compact icon={ClipboardList} title="No open prescriptions" description="Record a new prescription from the Prescriptions page." />
        ) : (
          <ul className="divide-y divide-line">
            {list.data.map((rx) => (
              <li key={rx.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium">{rx.customerName} <span className="font-normal text-muted">· {rx.rxNumber}</span></p>
                  <p className="text-[12px] text-muted">{date(rx.prescriptionDate)} · {rx.prescriberName} · {rx.itemCount} item(s)</p>
                </div>
                <RxStatusBadge status={rx.status} />
                <Button
                  size="sm"
                  variant="subtle"
                  loading={loading === rx.id}
                  onClick={async () => {
                    setLoading(rx.id);
                    setError(null);
                    try {
                      onPick(await load(rx.id));
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setLoading(null);
                    }
                  }}
                >
                  Load
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="mt-2 text-[11.5px] text-faint">Business date {date(today)}</p>
    </Modal>
  );
}
PrescriptionPicker.load = load;
