import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Copy, MessageCircle, Printer } from 'lucide-react';
import { api } from '@/lib/api';
import { useFormat } from '@/lib/settings';
import { EfdReceiptField } from './EfdReceiptField';
import { Button, ErrorState, Modal, PageLoader, Select } from '@/components/ui';
import { Receipt, type ReceiptPharmacy, type ReceiptSale } from './Receipt';

interface ReceiptPayload { sale: ReceiptSale & { receiptToken: string; customerPhone: string | null }; pharmacy: ReceiptPharmacy }

export function useReceipt(saleId: number | null) {
  return useQuery({
    queryKey: ['receipt', saleId],
    queryFn: () => api.get<ReceiptPayload>(`/sales/${saleId}/receipt`),
    enabled: saleId !== null,
  });
}

export function ReceiptModal({ saleId, onClose, title = 'Receipt', footerExtra }: { saleId: number | null; onClose: () => void; title?: string; footerExtra?: React.ReactNode }) {
  const { data, error, refetch } = useReceipt(saleId);
  const { settings } = useFormat();
  const efd = settings?.sales.fiscalMode === 'external_efd';
  const [paper, setPaper] = useState<ReceiptPharmacy['paper'] | null>(null);
  const [copied, setCopied] = useState(false);
  const link = data ? `${window.location.origin}/r/${data.sale.receiptToken}` : '';
  const phone = data?.sale.customerPhone?.replace(/[^\d]/g, '');
  const whatsapp = data
    ? `https://wa.me/${phone ?? ''}?text=${encodeURIComponent(`${data.pharmacy.name} receipt ${data.sale.invoiceNo}: ${link}`)}`
    : '';
  return (
    <Modal
      open={saleId !== null}
      onClose={onClose}
      title={title}
      size="md"
      footer={
        data && (
          <>
            <div className="mr-auto flex items-center gap-2">
              <Select value={paper ?? data.pharmacy.paper} onChange={(e) => setPaper(e.target.value as ReceiptPharmacy['paper'])} className="w-32" aria-label="Paper size">
                <option value="80mm">80 mm roll</option>
                <option value="58mm">58 mm roll</option>
                <option value="a4">A4 invoice</option>
              </Select>
            </div>
            <Button
              icon={copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              onClick={async () => {
                await navigator.clipboard.writeText(link).catch(() => undefined);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? 'Copied' : 'Copy link'}
            </Button>
            <a href={whatsapp} target="_blank" rel="noopener noreferrer">
              <Button icon={<MessageCircle className="size-3.5" />}>WhatsApp</Button>
            </a>
            {footerExtra}
            <Button variant="primary" icon={<Printer className="size-3.5" />} onClick={() => window.print()} data-primary>
              Print
            </Button>
          </>
        )
      }
    >
      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} compact />
      ) : !data ? (
        <PageLoader />
      ) : (
        <>
        {efd && saleId !== null && (
          <div className="mb-3 rounded-md border border-line px-3 py-2.5">
            <p className="mb-1.5 text-[12.5px] text-muted">Issue the fiscal receipt on the EFD machine, then record its number here.</p>
            <EfdReceiptField saleId={saleId} value={data.sale.efdReceiptNo ?? null} compact />
          </div>
        )}
        <div className="flex justify-center rounded-md bg-subtle p-4">
          <div className="print-area rounded-sm bg-white p-3 shadow-sm">
            <Receipt sale={data.sale} pharmacy={data.pharmacy} paper={paper ?? data.pharmacy.paper} className={(paper ?? data.pharmacy.paper) === 'a4' ? 'w-[640px] max-w-full' : undefined} />
          </div>
        </div>
        </>
      )}
    </Modal>
  );
}
