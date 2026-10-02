import { useState } from 'react';
import { Download } from 'lucide-react';
import { addDays } from '@dawa/shared';
import { downloadFile } from '@/lib/api';
import { Button, Input, Select, useToast } from './ui';

export type DateRange = { from: string; to: string };

/** Common periods relative to the pharmacy's business date. */
export function rangePresets(today: string): { label: string; range: DateRange }[] {
  const monthStart = `${today.slice(0, 8)}01`;
  const lastMonthEnd = addDays(monthStart, -1);
  const lastMonthStart = `${lastMonthEnd.slice(0, 8)}01`;
  return [
    { label: 'Today', range: { from: today, to: today } },
    { label: 'Yesterday', range: { from: addDays(today, -1), to: addDays(today, -1) } },
    { label: 'Last 7 days', range: { from: addDays(today, -6), to: today } },
    { label: 'This month', range: { from: monthStart, to: today } },
    { label: 'Last month', range: { from: lastMonthStart, to: lastMonthEnd } },
    { label: 'Last 90 days', range: { from: addDays(today, -89), to: today } },
    { label: 'This year', range: { from: `${today.slice(0, 4)}-01-01`, to: today } },
  ];
}

export function DateRangeFilter({ value, onChange, today }: { value: DateRange; onChange: (r: DateRange) => void; today: string }) {
  const presets = rangePresets(today);
  const current = presets.findIndex((p) => p.range.from === value.from && p.range.to === value.to);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={current >= 0 ? String(current) : 'custom'} onChange={(e) => e.target.value !== 'custom' && onChange(presets[Number(e.target.value)].range)} className="w-36">
        {presets.map((p, i) => <option key={p.label} value={i}>{p.label}</option>)}
        <option value="custom">Custom range</option>
      </Select>
      <Input type="date" aria-label="From" value={value.from} max={value.to} onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })} className="w-36" />
      <span className="text-muted">–</span>
      <Input type="date" aria-label="To" value={value.to} min={value.from} max={today} onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })} className="w-36" />
    </div>
  );
}

export function ExportButton({ path, query, label = 'Export CSV' }: { path: string; query?: Record<string, string | number | boolean | null | undefined>; label?: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="md"
      icon={<Download className="size-3.5" />}
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await downloadFile(path, { ...query, format: 'csv' }, 'export.csv');
        } catch (e) {
          toast.error('Export failed', (e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {label}
    </Button>
  );
}
