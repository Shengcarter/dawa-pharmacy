import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Factory, FolderTree, Plus } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Page } from '@/components/layout/AppLayout';
import { Alert, Button, Card, ConfirmDialog, DataTable, EmptyState, Field, Input, Modal, PageHeader, Tabs, useToast } from '@/components/ui';
import { useCategories } from './ProductsPage';
import { useManufacturers } from './ProductFormPage';

interface Editing { kind: 'category' | 'manufacturer'; id: number | null; name: string; extra: string }

export function CategoriesPage() {
  const { can } = useAuth();
  const canManage = can('products.manage');
  const toast = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'categories' | 'manufacturers'>('categories');
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<{ id: number; name: string } | null>(null);
  const categories = useCategories();
  const manufacturers = useManufacturers();
  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/categories/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['categories'] }); toast.success('Category deleted'); setDeleting(null); },
    onError: (e) => { toast.error('Cannot delete', (e as Error).message); setDeleting(null); },
  });

  return (
    <Page>
      <PageHeader
        title="Categories & manufacturers"
        description="Group products for browsing, filtering and reporting."
        actions={canManage && (
          <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEditing({ kind: tab === 'categories' ? 'category' : 'manufacturer', id: null, name: '', extra: '' })}>
            {tab === 'categories' ? 'Add category' : 'Add manufacturer'}
          </Button>
        )}
      />
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[
        { value: 'categories', label: 'Categories', count: categories.data?.length },
        { value: 'manufacturers', label: 'Manufacturers', count: manufacturers.data?.length },
      ]} />
      <Card flush>
        {tab === 'categories' ? (
          <DataTable
            rows={categories.data}
            loading={categories.isLoading}
            error={categories.error}
            rowKey={(r) => r.id}
            empty={<EmptyState icon={FolderTree} title="No categories yet" />}
            columns={[
              { key: 'name', header: 'Category', cell: (r) => <span className="font-medium">{r.name}</span> },
              { key: 'desc', header: 'Description', cell: (r) => <span className="text-muted">{r.description ?? '—'}</span>, hideBelow: 'md' },
              { key: 'count', header: 'Products', align: 'right', cell: (r) => <Link className="text-brand-700 hover:underline num" to={`/inventory/products?categoryId=${r.id}`}>{r.productCount}</Link> },
              {
                key: 'a', header: '', align: 'right',
                cell: (r) => canManage && (
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditing({ kind: 'category', id: r.id, name: r.name, extra: r.description ?? '' })}>Edit</Button>
                    <Button size="sm" variant="ghost" disabled={r.productCount > 0} title={r.productCount > 0 ? 'Move its products first' : undefined} onClick={() => setDeleting({ id: r.id, name: r.name })}>Delete</Button>
                  </div>
                ),
              },
            ]}
          />
        ) : (
          <DataTable
            rows={manufacturers.data}
            loading={manufacturers.isLoading}
            error={manufacturers.error}
            rowKey={(r) => r.id}
            empty={<EmptyState icon={Factory} title="No manufacturers yet" />}
            columns={[
              { key: 'name', header: 'Manufacturer', cell: (r) => <span className="font-medium">{r.name}</span> },
              { key: 'country', header: 'Country', cell: (r) => r.country ?? '—' },
              { key: 'count', header: 'Products', align: 'right', cell: (r) => <span className="num">{r.productCount}</span> },
              { key: 'a', header: '', align: 'right', cell: (r) => canManage && <Button size="sm" variant="ghost" onClick={() => setEditing({ kind: 'manufacturer', id: r.id, name: r.name, extra: r.country ?? '' })}>Edit</Button> },
            ]}
          />
        )}
      </Card>
      <EditModal editing={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && del.mutate(deleting.id)}
        loading={del.isPending}
        tone="danger"
        title="Delete category?"
        message={`“${deleting?.name}” will be removed. This cannot be undone.`}
        confirmLabel="Delete"
      />
    </Page>
  );
}

function EditModal({ editing, onClose }: { editing: Editing | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const [extra, setExtra] = useState('');
  useEffect(() => { if (editing) { setName(editing.name); setExtra(editing.extra); } }, [editing]);
  const isCat = editing?.kind === 'category';
  const save = useMutation({
    mutationFn: () => {
      const path = isCat ? '/categories' : '/manufacturers';
      const body = isCat ? { name, description: extra } : { name, country: extra };
      return editing?.id ? api.put(`${path}/${editing.id}`, body) : api.post(path, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [isCat ? 'categories' : 'manufacturers'] });
      toast.success('Saved');
      onClose();
    },
  });
  return (
    <Modal open={editing !== null} onClose={onClose} size="sm" title={`${editing?.id ? 'Edit' : 'New'} ${isCat ? 'category' : 'manufacturer'}`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!name.trim()} onClick={() => save.mutate()}>Save</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-3.5">
        {save.error && <Alert tone="danger">{save.error instanceof ApiError ? save.error.message : 'Could not save'}</Alert>}
        <Field label="Name" required>{(id) => <Input id={id} autoFocus value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label={isCat ? 'Description' : 'Country'}>{(id) => <Input id={id} value={extra} onChange={(e) => setExtra(e.target.value)} />}</Field>
      </form>
    </Modal>
  );
}
