import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ReceiptText } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, Input, useToast } from '@/components/ui';

/**
 * Records the receipt number printed by a separate TRA EFD machine against a
 * sale. Cashiers record it once; supervisors can correct it.
 */
export function EfdReceiptField({ saleId, value, compact }: { saleId: number; value: string | null; compact?: boolean }) {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [draft, setDraft] = useState(value ?? '');
  const [editing, setEditing] = useState(!value);
  useEffect(() => { setDraft(value ?? ''); setEditing(!value); }, [value, saleId]);
  const save = useMutation({
    mutationFn: () => api.put<{ efdReceiptNo: string | null }>(`/sales/${saleId}/efd`, { efdReceiptNo: draft.trim() }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['receipt', saleId] });
      qc.invalidateQueries({ queryKey: ['sale', String(saleId)] });
      qc.invalidateQueries({ queryKey: ['sale'] });
      qc.invalidateQueries({ queryKey: ['sales'] });
      toast.success(r.efdReceiptNo ? `EFD receipt ${r.efdReceiptNo} recorded` : 'EFD receipt number cleared');
      setEditing(false);
    },
    onError: (e) => toast.error('Not saved', (e as Error).message),
  });
  const canCorrect = can('sales.view_all');
  if (!editing) {
    return (
      <div className="flex items-center gap-2 text-[13px]">
        <ReceiptText className="size-4 text-brand-700" />
        <span>EFD receipt <b className="font-mono">{value}</b></span>
        {canCorrect && <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Correct</Button>}
      </div>
    );
  }
  return (
    <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (draft.trim() || value) save.mutate(); }}>
      {!compact && <ReceiptText className="size-4 text-warning" />}
      <Input aria-label="EFD receipt number" placeholder="EFD receipt number" value={draft} onChange={(e) => setDraft(e.target.value)} className="w-52" autoFocus={!compact} />
      <Button type="submit" size="sm" variant="primary" loading={save.isPending} disabled={!draft.trim() && !value}>Save</Button>
      {value && <Button size="sm" variant="ghost" onClick={() => { setDraft(value); setEditing(false); }}>Cancel</Button>}
    </form>
  );
}
