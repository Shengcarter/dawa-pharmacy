import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatAmount } from '@dawa/shared';

/*
 * Chart conventions: one series per chart in the brand green, 2px line with a
 * 10% wash, hairline solid grid, crosshair tooltip. Text uses text tokens.
 */
const axis = { fontSize: 11.5, fill: 'var(--muted)' };

function compact(v: number) {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${Math.round(v / 1_000)}k`;
  return String(v);
}

function TooltipBox({ title, rows }: { title: string; rows: { label: string; value: string }[] }) {
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2 text-[12px] shadow-pop">
      <p className="mb-1 font-medium">{title}</p>
      {rows.map((r) => (
        <p key={r.label} className="flex justify-between gap-6 text-muted">
          <span>{r.label}</span>
          <span className="font-medium text-fg num">{r.value}</span>
        </p>
      ))}
    </div>
  );
}

export interface SeriesPoint {
  bucket: string;
  total: number;
  transactions: number;
}

export function SalesAreaChart({ points, bucket, currency, height = 260 }: { points: SeriesPoint[]; bucket: 'hour' | 'day' | 'week' | 'month'; currency: string; height?: number }) {
  const label = (iso: string) => {
    if (bucket === 'hour') return `${iso.slice(11, 13)}:00`;
    const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
    if (bucket === 'month') return d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' });
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  };
  const data = points.map((p) => ({ ...p, label: label(p.bucket) }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--line)" strokeWidth={1} />
        <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={{ stroke: 'var(--line)' }} minTickGap={24} />
        <YAxis tick={axis} tickLine={false} axisLine={false} width={44} tickFormatter={compact} />
        <Tooltip
          cursor={{ stroke: 'var(--line-strong)', strokeWidth: 1 }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload as SeriesPoint & { label: string };
            return <TooltipBox title={p.label} rows={[{ label: 'Sales', value: `${currency} ${formatAmount(p.total, currency)}` }, { label: 'Transactions', value: String(p.transactions) }]} />;
          }}
        />
        <Area
          type="monotone"
          dataKey="total"
          stroke="var(--brand-600)"
          strokeWidth={2}
          fill="var(--brand-600)"
          fillOpacity={0.1}
          activeDot={{ r: 4.5, stroke: 'var(--surface)', strokeWidth: 2, fill: 'var(--brand-600)' }}
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Columns that can go negative (e.g. monthly net profit); losses use the danger hue plus the sign. */
export function SignedColumns({ data, currency, height = 220, valueLabel }: { data: { label: string; value: number }[]; currency: string; height?: number; valueLabel: string }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="30%">
        <CartesianGrid vertical={false} stroke="var(--line)" />
        <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={{ stroke: 'var(--line)' }} />
        <YAxis tick={axis} tickLine={false} axisLine={false} width={44} tickFormatter={compact} domain={[(min: number) => Math.min(0, min), (max: number) => Math.max(0, max)]} />
        <ReferenceLine y={0} stroke="var(--line-strong)" />
        <Tooltip
          cursor={{ fill: 'var(--hover)' }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload as { label: string; value: number };
            return <TooltipBox title={p.label} rows={[{ label: valueLabel, value: `${p.value < 0 ? '−' : ''}${currency} ${formatAmount(Math.abs(p.value), currency)}` }]} />;
          }}
        />
        <Bar dataKey="value" maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false}>
          {data.map((d) => <Cell key={d.label} fill={d.value < 0 ? 'var(--danger)' : 'var(--brand-600)'} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Horizontal share bars (e.g. expenses by category) rendered in HTML for crisp labels. */
export function ShareBars({ rows, format }: { rows: { label: string; value: number }[]; format: (v: number) => string }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="mb-1 flex justify-between gap-3 text-[12.5px]">
            <span className="truncate">{r.label}</span>
            <span className="font-medium num">{format(r.value)}</span>
          </div>
          <div className="h-1.5 rounded-full bg-subtle">
            <div className="h-1.5 rounded-full bg-brand-600" style={{ width: `${Math.max((r.value / max) * 100, 1)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
