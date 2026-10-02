import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { api } from '@/lib/api';
import { Button, EmptyState, PageLoader } from '@/components/ui';
import { Receipt, type ReceiptPharmacy, type ReceiptSale } from './Receipt';

/** Digital receipt a customer can open from a shared link. */
export function PublicReceiptPage() {
  const { token } = useParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ['public-receipt', token],
    queryFn: () => api.get<{ sale: ReceiptSale; pharmacy: ReceiptPharmacy }>(`/public/receipts/${token}`),
    retry: false,
  });
  if (isLoading) return <PageLoader />;
  if (error || !data) return <EmptyState title="Receipt not found" description="The link may be incorrect or expired." />;
  return (
    <div className="min-h-screen bg-canvas px-4 py-8">
      <div className="mx-auto max-w-md">
        <div className="print-area rounded-lg border border-line bg-white p-5">
          <Receipt sale={data.sale} pharmacy={data.pharmacy} paper="80mm" className="!w-full" />
        </div>
        <div className="no-print mt-4 flex justify-center">
          <Button icon={<Printer className="size-3.5" />} onClick={() => window.print()}>Print or save as PDF</Button>
        </div>
      </div>
    </div>
  );
}
