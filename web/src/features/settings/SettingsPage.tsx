import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Controller } from 'react-hook-form';
import { Database, Download, Plus } from 'lucide-react';
import {
  generalSettingsSchema, inventorySettingsSchema, notificationSettingsSchema, salesSettingsSchema, systemSettingsSchema, type SettingsSection,
} from '@dawa/shared';
import { api, downloadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { applyServerErrors, useZodForm } from '@/lib/forms';
import { useFormat } from '@/lib/settings';
import { cn } from '@/lib/cn';
import type { AppSettings } from '@/lib/types';
import { Page } from '@/components/layout/AppLayout';
import { Alert, Badge, Button, Card, DataTable, EmptyState, Field, Input, Modal, PageHeader, PageLoader, Select, Switch, Textarea, useToast } from '@/components/ui';
import { useRoles, type RoleOption } from '../users/UserForm';

const SECTIONS = [
  { value: 'general', label: 'General', permission: ['settings.view', 'settings.manage'] },
  { value: 'inventory', label: 'Inventory', permission: ['settings.view', 'settings.manage'] },
  { value: 'sales', label: 'Sales & receipts', permission: ['settings.view', 'settings.manage'] },
  { value: 'roles', label: 'Users & roles', permission: ['roles.manage', 'users.view'] },
  { value: 'notifications', label: 'Notifications', permission: ['settings.view', 'settings.manage'] },
  { value: 'system', label: 'System & backups', permission: ['settings.view', 'settings.manage', 'backups.manage'] },
] as const;
type Section = (typeof SECTIONS)[number]['value'];

const TIMEZONES = ['Africa/Dar_es_Salaam', 'Africa/Nairobi', 'Africa/Kampala', 'Africa/Kigali', 'Africa/Lusaka', 'Africa/Johannesburg', 'UTC'];

export function SettingsPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const sections = SECTIONS.filter((s) => can(...s.permission));
  const current = (sections.find((s) => s.value === params.get('section'))?.value ?? sections[0]?.value) as Section;
  const { data, isLoading } = useQuery({ queryKey: ['settings'], queryFn: () => api.get<AppSettings>('/settings') });
  return (
    <Page>
      <PageHeader title="Settings" description="Pharmacy details, stock rules, sales and receipt options, roles and system maintenance." />
      <div className="grid gap-6 lg:grid-cols-[200px_1fr]">
        <nav className="flex gap-1 overflow-x-auto lg:flex-col" aria-label="Settings sections">
          {sections.map((s) => (
            <button key={s.value} onClick={() => setParams({ section: s.value })}
              className={cn('shrink-0 rounded-md px-3 py-1.5 text-left text-[13px] font-medium', current === s.value ? 'bg-brand-50 text-brand-700' : 'text-muted hover:bg-hover hover:text-fg')}>
              {s.label}
            </button>
          ))}
        </nav>
        <div className="min-w-0">
          {isLoading || !data ? <PageLoader /> : (
            <>
              {current === 'general' && <GeneralSection settings={data} />}
              {current === 'inventory' && <InventorySection settings={data} />}
              {current === 'sales' && <SalesSection settings={data} />}
              {current === 'roles' && <RolesSection />}
              {current === 'notifications' && <NotificationsSection settings={data} />}
              {current === 'system' && <SystemSection settings={data} />}
            </>
          )}
        </div>
      </div>
    </Page>
  );
}

function useSaveSection(section: SettingsSection) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (body: unknown) => api.put(`/settings/${section}`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['settings'] }); qc.invalidateQueries({ queryKey: ['public-settings'] }); toast.success('Settings saved'); },
  });
}

function SectionCard({ title, description, children, onSave, saving, error, readOnly }: { title: string; description?: string; children: ReactNode; onSave?: () => void; saving?: boolean; error?: string | null; readOnly?: boolean }) {
  return (
    <Card title={title} description={description} actions={readOnly && <Badge>Read only</Badge>}>
      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}
      <fieldset disabled={readOnly} className="space-y-4">{children}</fieldset>
      {onSave && !readOnly && (
        <div className="mt-5 flex justify-end border-t border-line pt-4">
          <Button variant="primary" loading={saving} onClick={onSave}>Save changes</Button>
        </div>
      )}
    </Card>
  );
}

function GeneralSection({ settings }: { settings: AppSettings }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const readOnly = !can('settings.manage');
  const [error, setError] = useState<string | null>(null);
  const form = useZodForm(generalSettingsSchema, { defaultValues: settings.general as never });
  const save = useSaveSection('general');
  const fileInput = useRef<HTMLInputElement>(null);
  const logo = useMutation({
    mutationFn: (file: File) => api.upload('/settings/logo', file),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['settings'] }); toast.success('Logo updated'); },
    onError: (e) => toast.error('Upload failed', (e as Error).message),
  });
  const submit = form.handleSubmit(async (d) => { setError(null); try { await save.mutateAsync(d); } catch (e) { setError(applyServerErrors(form, e)); } });
  const { errors } = form.formState;
  const r = form.register;
  return (
    <SectionCard title="Pharmacy details" description="Printed on receipts, invoices and purchase orders." onSave={submit} saving={save.isPending} error={error} readOnly={readOnly}>
      <div className="flex items-center gap-4">
        <div className="flex size-16 items-center justify-center overflow-hidden rounded-lg border border-line bg-subtle">
          {settings.general.logoPath ? <img src={`/uploads/${settings.general.logoPath}`} alt="Logo" className="size-full object-contain" /> : <span className="text-[11px] text-faint">No logo</span>}
        </div>
        {!readOnly && <Button size="sm" loading={logo.isPending} onClick={() => fileInput.current?.click()}>Upload logo</Button>}
        <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => e.target.files?.[0] && logo.mutate(e.target.files[0])} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Pharmacy name" required error={errors.pharmacyName?.message}>{(id) => <Input id={id} {...r('pharmacyName')} />}</Field>
        <Field label="Registered company name">{(id) => <Input id={id} {...r('legalName')} />}</Field>
        <Field label="Address" className="sm:col-span-2">{(id) => <Input id={id} {...r('address')} />}</Field>
        <Field label="Phone">{(id) => <Input id={id} {...r('phone')} />}</Field>
        <Field label="Email" error={errors.email?.message}>{(id) => <Input id={id} type="email" {...r('email')} />}</Field>
        <Field label="TIN">{(id) => <Input id={id} {...r('tin')} />}</Field>
        <Field label="VRN">{(id) => <Input id={id} {...r('vrn')} />}</Field>
        <Field label="Pharmacy licence number">{(id) => <Input id={id} {...r('licenseNo')} />}</Field>
        <Field label="Currency" hint="Changing currency does not convert existing amounts.">{(id) => <Select id={id} {...r('currency')}>{settings.meta.currencies.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}</Select>}</Field>
        <Field label="Time zone" hint="Used for business days, reports and receipts.">{(id) => <Select id={id} {...r('timezone')}>{TIMEZONES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}</Select>}</Field>
      </div>
    </SectionCard>
  );
}

function InventorySection({ settings }: { settings: AppSettings }) {
  const { can } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const form = useZodForm(inventorySettingsSchema, { defaultValues: settings.inventory as never });
  const save = useSaveSection('inventory');
  const submit = form.handleSubmit(async (d) => { setError(null); try { await save.mutateAsync(d); } catch (e) { setError(applyServerErrors(form, e)); } });
  const { errors } = form.formState;
  return (
    <SectionCard title="Inventory rules" onSave={submit} saving={save.isPending} error={error} readOnly={!can('settings.manage')}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Default reorder level" error={errors.defaultReorderLevel?.message} hint="Pre-filled on new products.">{(id) => <Input id={id} inputMode="numeric" {...form.register('defaultReorderLevel')} />}</Field>
        <Field label="Critical stock (% of reorder level)" error={errors.criticalStockPercent?.message} hint="At or below this share, stock is critical (red).">{(id) => <Input id={id} inputMode="numeric" suffix="%" {...form.register('criticalStockPercent')} />}</Field>
        <Field label="Expiry warning period" error={errors.expiryWarningDays?.message} hint="Batches inside this window are flagged.">{(id) => <Input id={id} inputMode="numeric" suffix="days" {...form.register('expiryWarningDays')} />}</Field>
      </div>
      <Alert tone="info" title="Stock valuation: batch cost (specific identification)">
        Each batch keeps the cost it was received at. Sales are allocated First-Expired-First-Out, and cost of goods sold uses the cost of the batches actually sold.
        Expired and quarantined stock is never sold.
      </Alert>
    </SectionCard>
  );
}

function SalesSection({ settings }: { settings: AppSettings }) {
  const { can } = useAuth();
  const readOnly = !can('settings.manage');
  const [error, setError] = useState<string | null>(null);
  const form = useZodForm(salesSettingsSchema, { defaultValues: settings.sales as never });
  const save = useSaveSection('sales');
  const submit = form.handleSubmit(async (d) => { setError(null); try { await save.mutateAsync(d); } catch (e) { setError(applyServerErrors(form, e)); } });
  const { errors } = form.formState;
  const sw = (name: 'taxInclusive' | 'requirePrescriptionForRx' | 'allowCreditSales' | 'showTinOnReceipt', label: string, description: string) => (
    <Controller control={form.control} name={name} render={({ field }) => <Switch checked={Boolean(field.value)} onChange={field.onChange} label={label} description={description} disabled={readOnly} />} />
  );
  return (
    <SectionCard title="Sales, tax & receipts" onSave={submit} saving={save.isPending} error={error} readOnly={readOnly}>
      <div className="space-y-4 rounded-md border border-line p-4">
        {sw('taxInclusive', 'Prices include VAT', 'Shelf prices are what the customer pays; VAT is calculated within the price. Turn off to add VAT on top.')}
        {sw('requirePrescriptionForRx', 'Require a prescription for Rx medicines', 'Prescription-only products can only be sold against a recorded prescription, by staff with dispensing rights.')}
        {sw('allowCreditSales', 'Allow sales on account', 'Customers with a credit limit can buy now and pay later. Requires the credit-sale permission.')}
        {sw('showTinOnReceipt', 'Show TIN and VRN on receipts', 'Recommended for VAT-registered pharmacies.')}
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Maximum discount without approval" error={errors.maxDiscountPercent?.message} hint="Higher discounts need the override permission.">{(id) => <Input id={id} inputMode="decimal" suffix="%" {...form.register('maxDiscountPercent')} />}</Field>
        <Field label="Default VAT rate for new products">{(id) => <Select id={id} {...form.register('defaultTaxRate')}><option value="0">0% (exempt)</option><option value="18">18%</option></Select>}</Field>
        <Field label="Receipt paper">{(id) => <Select id={id} {...form.register('receiptPaper')}><option value="80mm">80 mm thermal</option><option value="58mm">58 mm thermal</option><option value="a4">A4 invoice</option></Select>}</Field>
        <Field label="Receipt footer" className="sm:col-span-3" hint="e.g. returns policy, opening hours, a thank-you message.">{(id) => <Textarea id={id} rows={2} {...form.register('receiptFooter')} />}</Field>
      </div>
    </SectionCard>
  );
}

function NotificationsSection({ settings }: { settings: AppSettings }) {
  const { can } = useAuth();
  const readOnly = !can('settings.manage');
  const [error, setError] = useState<string | null>(null);
  const form = useZodForm(notificationSettingsSchema, { defaultValues: settings.notifications as never });
  const save = useSaveSection('notifications');
  const submit = form.handleSubmit(async (d) => { setError(null); try { await save.mutateAsync(d); } catch (e) { setError(applyServerErrors(form, e)); } });
  const sw = (name: 'lowStock' | 'expiry' | 'supplierOverdue', label: string, description: string) => (
    <Controller control={form.control} name={name} render={({ field }) => <Switch checked={Boolean(field.value)} onChange={field.onChange} label={label} description={description} disabled={readOnly} />} />
  );
  return (
    <SectionCard title="Alerts" description="Shown in the notification bell to staff whose role covers the area." onSave={submit} saving={save.isPending} error={error} readOnly={readOnly}>
      <div className="space-y-4 rounded-md border border-line p-4">
        {sw('lowStock', 'Low and out-of-stock alerts', 'When sellable stock reaches the reorder level.')}
        {sw('expiry', 'Expiry alerts', 'Expired stock and stock inside the expiry warning period.')}
        {sw('supplierOverdue', 'Overdue supplier payments', 'When a delivery is unpaid past the supplier’s payment terms.')}
      </div>
      <Field label="Flag purchase orders awaiting approval after" className="max-w-xs">{(id) => <Input id={id} inputMode="numeric" suffix="days" {...form.register('purchaseOrderPendingDays')} />}</Field>
    </SectionCard>
  );
}

function SystemSection({ settings }: { settings: AppSettings }) {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const { dateTime } = useFormat();
  const readOnly = !can('settings.manage');
  const [error, setError] = useState<string | null>(null);
  const form = useZodForm(systemSettingsSchema, { defaultValues: settings.system as never });
  const save = useSaveSection('system');
  const submit = form.handleSubmit(async (d) => { setError(null); try { await save.mutateAsync(d); } catch (e) { setError(applyServerErrors(form, e)); } });
  const backups = useQuery({ queryKey: ['backups'], queryFn: () => api.get<{ name: string; size: number; createdAt: string }[]>('/backups'), enabled: can('backups.manage') });
  const create = useMutation({
    mutationFn: () => api.post<{ name: string }>('/backups'),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['backups'] }); toast.success('Backup created', r.name); },
    onError: (e) => toast.error('Backup failed', (e as Error).message),
  });
  return (
    <div className="space-y-4">
      <SectionCard title="Security & retention" onSave={submit} saving={save.isPending} error={error} readOnly={readOnly}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Stay signed in for" hint="After this, staff must sign in again.">{(id) => <Input id={id} inputMode="numeric" suffix="hours" {...form.register('sessionHours')} />}</Field>
          <Field label="Keep audit log for" hint="Minimum one year.">{(id) => <Input id={id} inputMode="numeric" suffix="days" {...form.register('auditRetentionDays')} />}</Field>
          <Field label="Backups to keep">{(id) => <Input id={id} inputMode="numeric" {...form.register('backupRetentionCount')} />}</Field>
        </div>
        <Controller control={form.control} name="autoBackupDaily" render={({ field }) => (
          <Switch checked={Boolean(field.value)} onChange={field.onChange} disabled={readOnly} label="Automatic daily backup" description="The server keeps a full database backup every 24 hours. Copy backups off this computer regularly." />
        )} />
      </SectionCard>
      {can('backups.manage') && (
        <Card title="Database backups" description="Full PostgreSQL backups. Restore with: pg_restore --clean --if-exists -d <database> <file>"
          actions={<Button variant="primary" size="sm" icon={<Plus className="size-3.5" />} loading={create.isPending} onClick={() => create.mutate()}>Back up now</Button>} flush>
          <DataTable rows={backups.data} loading={backups.isLoading} error={backups.error} rowKey={(b) => b.name} empty={<EmptyState compact icon={Database} title="No backups yet" />} columns={[
            { key: 'name', header: 'File', cell: (b) => <span className="font-mono text-[12px]">{b.name}</span> },
            { key: 'when', header: 'Created', cell: (b) => dateTime(b.createdAt) },
            { key: 'size', header: 'Size', align: 'right', cell: (b) => <span className="num">{(b.size / 1024 / 1024).toFixed(1)} MB</span> },
            { key: 'dl', header: '', align: 'right', cell: (b) => <Button size="sm" variant="ghost" icon={<Download className="size-3.5" />} onClick={() => downloadFile(`/backups/${b.name}`, undefined, b.name).catch((e) => toast.error('Download failed', e.message))}>Download</Button> },
          ]} />
        </Card>
      )}
    </div>
  );
}

function RolesSection() {
  const { can } = useAuth();
  const { data, isLoading } = useRoles();
  const [selected, setSelected] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  useEffect(() => { if (data && selected === null) setSelected(data.roles[0]?.id ?? null); }, [data, selected]);
  if (isLoading || !data) return <PageLoader />;
  const role = data.roles.find((r) => r.id === selected);
  return (
    <div className="grid gap-4 xl:grid-cols-[260px_1fr]">
      <Card title="Roles" flush actions={can('roles.manage') && <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setCreating(true)}>New</Button>}>
        <ul className="p-1.5">
          {data.roles.map((r) => (
            <li key={r.id}>
              <button onClick={() => setSelected(r.id)} className={cn('flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left', selected === r.id ? 'bg-brand-50' : 'hover:bg-hover')}>
                <span><span className={cn('block text-[13px] font-medium', selected === r.id && 'text-brand-700')}>{r.name}</span><span className="block text-[11.5px] text-muted">{r.userCount} active user(s)</span></span>
                {!r.isSystem && <Badge>Custom</Badge>}
              </button>
            </li>
          ))}
        </ul>
      </Card>
      {role && <RoleEditor key={role.id} role={role} catalogue={data.catalogue} />}
      <NewRoleModal open={creating} onClose={() => setCreating(false)} onCreated={setSelected} />
    </div>
  );
}

function RoleEditor({ role, catalogue }: { role: RoleOption; catalogue: { key: string; label: string; permissions: { code: string; label: string }[] }[] }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [perms, setPerms] = useState(new Set(role.permissions));
  const locked = role.code === 'super_admin' || !can('roles.manage');
  const save = useMutation({
    mutationFn: () => api.put(`/roles/${role.id}`, { name: role.name, description: role.description, permissions: [...perms] }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['roles'] }); toast.success(`${role.name} permissions saved`); },
    onError: (e) => toast.error('Could not save', (e as Error).message),
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/roles/${role.id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['roles'] }); toast.success('Role deleted'); },
    onError: (e) => toast.error('Could not delete', (e as Error).message),
  });
  const toggle = (code: string) => { const n = new Set(perms); if (n.has(code)) n.delete(code); else n.add(code); setPerms(n); };
  const dirty = perms.size !== role.permissions.length || role.permissions.some((p) => !perms.has(p));
  return (
    <Card title={role.name} description={role.code === 'super_admin' ? 'Always has every permission.' : role.description ?? undefined}
      actions={!locked && (
        <>
          {!role.isSystem && <Button size="sm" variant="ghost" loading={remove.isPending} onClick={() => remove.mutate()}>Delete role</Button>}
          <Button size="sm" variant="primary" disabled={!dirty || !perms.size} loading={save.isPending} onClick={() => save.mutate()}>Save permissions</Button>
        </>
      )}>
      <div className="grid gap-4 md:grid-cols-2">
        {catalogue.map((g) => (
          <div key={g.key} className="rounded-md border border-line p-3">
            <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.04em] text-muted">{g.label}</p>
            <div className="space-y-1.5">
              {g.permissions.map((p) => (
                <label key={p.code} className={cn('flex items-start gap-2 text-[13px]', locked ? 'cursor-default' : 'cursor-pointer')}>
                  <input type="checkbox" className="mt-0.5 accent-[var(--brand-600)]" disabled={locked} checked={perms.has(p.code)} onChange={() => toggle(p.code)} />
                  <span>{p.label}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function NewRoleModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: number) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const create = useMutation({
    mutationFn: () => api.post<{ id: number }>('/roles', { name, description, permissions: ['dashboard.view'] }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['roles'] }); onCreated(r.id); onClose(); setName(''); setDescription(''); },
  });
  return (
    <Modal open={open} onClose={onClose} size="sm" title="New role" description="Start with dashboard access, then tick the permissions it needs."
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!name.trim()} loading={create.isPending} onClick={() => create.mutate()}>Create role</Button></>}>
      {create.error && <Alert tone="danger" className="mb-3">{(create.error as Error).message}</Alert>}
      <div className="space-y-3.5">
        <Field label="Role name" required>{(id) => <Input id={id} autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Store assistant" />}</Field>
        <Field label="Description">{(id) => <Input id={id} value={description} onChange={(e) => setDescription(e.target.value)} />}</Field>
      </div>
    </Modal>
  );
}
