import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useWatch } from 'react-hook-form';
import { DOSAGE_FORMS, PRODUCT_STATUSES, PRODUCT_TYPES, UNITS, productSchema } from '@dawa/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { applyServerErrors, useZodForm } from '@/lib/forms';
import { useFormat } from '@/lib/settings';
import type { Option } from '@/lib/types';
import { Page } from '@/components/layout/AppLayout';
import { Alert, Button, Card, Checkbox, ErrorState, Field, FormSection, Input, PageHeader, PageLoader, Select, Textarea, useToast } from '@/components/ui';
import { useCategories } from './ProductsPage';

export function useManufacturers() {
  return useQuery({ queryKey: ['manufacturers'], queryFn: () => api.get<(Option & { country: string | null; productCount: number })[]>('/manufacturers'), staleTime: 300_000 });
}
export function useSupplierOptions() {
  return useQuery({ queryKey: ['supplier-options'], queryFn: () => api.get<(Option & { code: string; paymentTermsDays: number })[]>('/suppliers/options'), staleTime: 300_000 });
}

const empty = (v: unknown) => (v === null || v === undefined ? '' : v);

export function ProductFormPage() {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const { settings, currency } = useFormat();
  const categories = useCategories();
  const manufacturers = useManufacturers();
  const suppliers = useSupplierOptions();
  const [error, setError] = useState<string | null>(null);
  const [openingOpen, setOpeningOpen] = useState(false);
  const canPrice = !editing || can('products.manage_prices');

  const existing = useQuery({ queryKey: ['product', id], queryFn: () => api.get<Record<string, unknown>>(`/products/${id}`), enabled: editing });
  const form = useZodForm(productSchema, {
    defaultValues: {
      productType: 'tablet', unit: 'strip', packSize: 1, reorderLevel: settings?.inventory.defaultReorderLevel ?? 20,
      isBatchTracked: true, requiresPrescription: false, taxRate: settings?.sales.defaultTaxRate ?? 0, status: 'active',
    } as never,
  });
  useEffect(() => {
    const p = existing.data;
    if (!p) return;
    form.reset({
      sku: p.sku, barcode: empty(p.barcode), name: p.name, genericName: empty(p.genericName), brandName: empty(p.brandName),
      productType: p.productType, categoryId: empty(p.categoryId), manufacturerId: empty(p.manufacturerId), defaultSupplierId: empty(p.defaultSupplierId),
      dosageForm: empty(p.dosageForm), strength: empty(p.strength), unit: p.unit, packSize: p.packSize, purchasePrice: p.purchasePrice ?? 0,
      sellingPrice: p.sellingPrice, wholesalePrice: empty(p.wholesalePrice), minSellingPrice: empty(p.minSellingPrice), reorderLevel: p.reorderLevel,
      maxStockLevel: empty(p.maxStockLevel), requiresPrescription: p.requiresPrescription, isBatchTracked: p.isBatchTracked, taxRate: p.taxRate,
      status: p.status, description: empty(p.description), storageInstructions: empty(p.storageInstructions),
    } as never);
  }, [existing.data, form]);

  const [cost, price, tracked] = useWatch({ control: form.control, name: ['purchasePrice', 'sellingPrice', 'isBatchTracked'] }) as [unknown, unknown, boolean];
  const margin = Number(price) > 0 && Number(cost) >= 0 ? ((Number(price) - Number(cost)) / Number(price)) * 100 : null;

  const save = useMutation({
    mutationFn: (body: unknown) => (editing ? api.put<{ id: number }>(`/products/${id}`, body) : api.post<{ id: number }>('/products', body)),
  });
  const submit = form.handleSubmit(async (data) => {
    setError(null);
    try {
      const body = { ...data, openingStock: openingOpen ? data.openingStock : null };
      const r = await save.mutateAsync(body);
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['product', String(r.id)] });
      toast.success(editing ? 'Product updated' : 'Product created');
      navigate(`/inventory/products/${r.id}`);
    } catch (e) {
      setError(applyServerErrors(form, e));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, () => {
    setError('Some fields need attention — see the highlighted fields below.');
    document.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' });
  });

  if (editing && existing.isLoading) return <PageLoader />;
  if (editing && existing.error) return <Page><ErrorState error={existing.error} onRetry={existing.refetch} /></Page>;
  const { errors } = form.formState;
  const r = form.register;
  const num = { inputMode: 'decimal' as const };

  return (
    <Page>
      <PageHeader
        breadcrumbs={[{ label: 'Products', to: '/inventory/products' }, { label: editing ? String(existing.data?.name ?? '') : 'New product' }]}
        title={editing ? 'Edit product' : 'Add product'}
        actions={
          <>
            <Button onClick={() => navigate(-1)}>Cancel</Button>
            <Button variant="primary" loading={save.isPending} onClick={submit}>{editing ? 'Save changes' : 'Create product'}</Button>
          </>
        }
      />
      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}
      <Card bodyClassName="py-0">
        <form onSubmit={submit} noValidate>
          <FormSection title="Product" description="How the product appears at the till, on receipts and in reports.">
            <Field label="Product name" required error={errors.name?.message} className="sm:col-span-2">
              {(id) => <Input id={id} placeholder="e.g. Paracetamol 500mg Tablets" {...r('name')} invalid={!!errors.name} />}
            </Field>
            <Field label="Generic name" error={errors.genericName?.message}>{(id) => <Input id={id} placeholder="e.g. Paracetamol" {...r('genericName')} />}</Field>
            <Field label="Brand name" error={errors.brandName?.message}>{(id) => <Input id={id} {...r('brandName')} />}</Field>
            <Field label="Product type" required error={errors.productType?.message}>
              {(id) => <Select id={id} {...r('productType')}>{Object.entries(PRODUCT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}
            </Field>
            <Field label="Category" error={errors.categoryId?.message}>
              {(id) => <Select id={id} placeholder="— None —" {...r('categoryId')}>{categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}
            </Field>
            <Field label="Dosage form">
              {(id) => (
                <>
                  <Input id={id} list="dosage-forms" placeholder="e.g. Film-coated tablet" {...r('dosageForm')} />
                  <datalist id="dosage-forms">{DOSAGE_FORMS.map((d) => <option key={d} value={d} />)}</datalist>
                </>
              )}
            </Field>
            <Field label="Strength" error={errors.strength?.message}>{(id) => <Input id={id} placeholder="e.g. 500mg, 125mg/5ml" {...r('strength')} />}</Field>
            <Field label="Manufacturer">
              {(id) => <Select id={id} placeholder="— None —" {...r('manufacturerId')}>{manufacturers.data?.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>}
            </Field>
            <Field label="Default supplier">
              {(id) => <Select id={id} placeholder="— None —" {...r('defaultSupplierId')}>{suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>}
            </Field>
          </FormSection>

          <FormSection title="Codes & packaging" description="Leave SKU empty to generate one. Scan the manufacturer barcode into the barcode field.">
            <Field label="SKU" error={errors.sku?.message} hint={!editing ? 'Generated automatically if left blank.' : undefined}>{(id) => <Input id={id} className="font-mono uppercase" {...r('sku')} />}</Field>
            <Field label="Barcode" error={errors.barcode?.message} hint="EAN-13 check digit is verified.">{(id) => <Input id={id} className="font-mono" inputMode="numeric" {...r('barcode')} />}</Field>
            <Field label="Selling unit" required error={errors.unit?.message} hint="The unit sold at the till and counted in stock.">
              {(id) => (
                <>
                  <Input id={id} list="units" {...r('unit')} />
                  <datalist id="units">{UNITS.map((u) => <option key={u} value={u} />)}</datalist>
                </>
              )}
            </Field>
            <Field label="Units per pack" error={errors.packSize?.message} hint="e.g. 10 strips per box; used when ordering.">{(id) => <Input id={id} {...num} {...r('packSize')} />}</Field>
          </FormSection>

          <FormSection title="Pricing" description={canPrice ? `Prices per selling unit, in ${currency}.` : 'You can view prices but not change them.'}>
            <Field label="Purchase price" required error={errors.purchasePrice?.message} hint="Default cost; each batch keeps its own cost.">
              {(id) => <Input id={id} {...num} prefix={currency} disabled={!canPrice} {...r('purchasePrice')} />}
            </Field>
            <Field label="Selling price" required error={errors.sellingPrice?.message} hint={margin !== null ? `Margin ${margin.toFixed(1)}%` : undefined}>
              {(id) => <Input id={id} {...num} prefix={currency} disabled={!canPrice} {...r('sellingPrice')} invalid={!!errors.sellingPrice} />}
            </Field>
            <Field label="Wholesale price" error={errors.wholesalePrice?.message}>{(id) => <Input id={id} {...num} prefix={currency} disabled={!canPrice} {...r('wholesalePrice')} />}</Field>
            <Field label="Minimum selling price" error={errors.minSellingPrice?.message} hint="Discounts cannot go below this without override permission.">
              {(id) => <Input id={id} {...num} prefix={currency} disabled={!canPrice} {...r('minSellingPrice')} />}
            </Field>
            <Field label="VAT rate" error={errors.taxRate?.message} hint={settings?.sales.taxInclusive ? 'Prices include VAT.' : 'VAT is added on top of prices.'}>
              {(id) => <Select id={id} disabled={!canPrice} {...r('taxRate')}><option value="0">Exempt / 0%</option><option value="18">Standard 18%</option></Select>}
            </Field>
          </FormSection>

          <FormSection title="Stock control" description="Reorder level drives low-stock alerts; critical is a share of it (Settings → Inventory).">
            <Field label="Reorder level" required error={errors.reorderLevel?.message}>{(id) => <Input id={id} {...num} {...r('reorderLevel')} />}</Field>
            <Field label="Maximum stock level" error={errors.maxStockLevel?.message} hint="Used to suggest order quantities.">{(id) => <Input id={id} {...num} {...r('maxStockLevel')} />}</Field>
            <div className="space-y-2.5 sm:col-span-2">
              <Checkbox label="Prescription-only medicine (Rx) — requires a prescription and a pharmacist to dispense" {...r('requiresPrescription')} />
              <Checkbox label="Track batches and expiry dates (recommended for all medicines)" {...r('isBatchTracked')} />
            </div>
            <Field label="Status">{(id) => <Select id={id} {...r('status')}>{Object.entries(PRODUCT_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
          </FormSection>

          {!editing && can('inventory.adjust') && (
            <section className="border-b border-line py-5">
              <button type="button" className="flex items-center gap-1.5 text-[13px] font-semibold" onClick={() => setOpeningOpen((o) => !o)} aria-expanded={openingOpen}>
                {openingOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                Record opening stock
                <span className="font-normal text-muted">— for stock already on the shelf when you start using the system</span>
              </button>
              {openingOpen && (
                <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:ml-[252px] lg:grid-cols-3">
                  <Field label="Batch number" required error={errors.openingStock?.batchNumber?.message}>{(id) => <Input id={id} placeholder={tracked ? '' : 'Any reference, e.g. OPENING'} {...r('openingStock.batchNumber')} />}</Field>
                  <Field label="Expiry date" required={tracked} error={errors.openingStock?.expiryDate?.message}>{(id) => <Input id={id} type="date" disabled={!tracked} {...r('openingStock.expiryDate')} />}</Field>
                  <Field label="Manufacturing date" error={errors.openingStock?.manufactureDate?.message}>{(id) => <Input id={id} type="date" disabled={!tracked} {...r('openingStock.manufactureDate')} />}</Field>
                  <Field label="Quantity" required error={errors.openingStock?.quantity?.message}>{(id) => <Input id={id} {...num} {...r('openingStock.quantity')} />}</Field>
                  <Field label="Unit cost" required error={errors.openingStock?.unitCost?.message}>{(id) => <Input id={id} {...num} prefix={currency} {...r('openingStock.unitCost')} />}</Field>
                </div>
              )}
            </section>
          )}

          <FormSection title="Details" description="Shown to staff on the product page.">
            <Field label="Storage instructions" className="sm:col-span-2">{(id) => <Input id={id} placeholder="e.g. Store below 25°C. Protect from light." {...r('storageInstructions')} />}</Field>
            <Field label="Description" className="sm:col-span-2">{(id) => <Textarea id={id} rows={3} {...r('description')} />}</Field>
          </FormSection>
        </form>
      </Card>
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={() => navigate(-1)}>Cancel</Button>
        <Button variant="primary" loading={save.isPending} onClick={submit}>{editing ? 'Save changes' : 'Create product'}</Button>
      </div>
    </Page>
  );
}
