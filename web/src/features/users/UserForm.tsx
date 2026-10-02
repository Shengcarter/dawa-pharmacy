import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { userCreateSchema, userUpdateSchema } from '@dawa/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { applyServerErrors, useZodForm } from '@/lib/forms';
import { Alert, Button, Field, Input, Modal, Select, useToast } from '@/components/ui';
import { useBranches } from '@/lib/branches';

export interface RoleOption { id: number; code: string; name: string; description: string | null; isSystem: boolean; permissions: string[]; userCount: number }
export function useRoles() {
  return useQuery({ queryKey: ['roles'], queryFn: () => api.get<{ roles: RoleOption[]; catalogue: { key: string; label: string; permissions: { code: string; label: string }[] }[] }>('/roles') });
}

export function UserFormModal({ open, onClose, user, onSaved }: { open: boolean; onClose: () => void; user?: { id: number; fullName: string; email: string; phone: string | null; jobTitle: string | null; status: string; branchId?: number; accessExpiresOn?: string | null; roles: { id: number }[] } | null; onSaved?: (id: number) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const roles = useRoles();
  const branches = useBranches();
  const [error, setError] = useState<string | null>(null);
  const editing = Boolean(user);
  const form = useZodForm(editing ? userUpdateSchema : userCreateSchema);
  useEffect(() => {
    if (!open) return;
    setError(null);
    form.reset((user
      ? { fullName: user.fullName, email: user.email, phone: user.phone ?? '', jobTitle: user.jobTitle ?? '', status: user.status, roleIds: user.roles.map((r) => r.id), branchId: user.branchId ?? '', accessExpiresOn: user.accessExpiresOn ?? '' }
      : { fullName: '', email: '', phone: '', jobTitle: '', password: '', roleIds: [], branchId: '', accessExpiresOn: '' }) as never);
  }, [open, user, form]);
  const save = useMutation({ mutationFn: (body: unknown) => (user ? api.put<{ id: number }>(`/users/${user.id}`, body) : api.post<{ id: number }>('/users', body)) });
  const submit = form.handleSubmit(async (data) => {
    try {
      const r = await save.mutateAsync(data);
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['user'] });
      toast.success(user ? 'User updated' : 'User created — they must change the password at first sign-in');
      onSaved?.(r.id);
      onClose();
    } catch (e) {
      setError(applyServerErrors(form, e));
    }
  });
  const errors = form.formState.errors as Record<string, { message?: string }>;
  const selected = (form.watch('roleIds') as number[] | undefined) ?? [];
  const toggle = (id: number) => form.setValue('roleIds', (selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]) as never, { shouldValidate: true });
  const r = form.register as (name: string) => ReturnType<typeof form.register>;
  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit user' : 'Add user'} size="lg"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={submit}>{editing ? 'Save' : 'Create user'}</Button></>}>
      <form onSubmit={submit} className="grid gap-3.5 sm:grid-cols-2">
        {error && <Alert tone="danger" className="sm:col-span-2">{error}</Alert>}
        <Field label="Full name" required error={errors.fullName?.message}>{(id) => <Input id={id} autoFocus {...r('fullName')} />}</Field>
        <Field label="Job title" error={errors.jobTitle?.message}>{(id) => <Input id={id} placeholder="e.g. Pharmacist" {...r('jobTitle')} />}</Field>
        <Field label="Email (sign-in)" required error={errors.email?.message}>{(id) => <Input id={id} type="email" autoComplete="off" {...r('email')} />}</Field>
        <Field label="Phone" error={errors.phone?.message}>{(id) => <Input id={id} type="tel" {...r('phone')} />}</Field>
        {(branches.data?.length ?? 0) > 1 && (
          <Field label="Branch" hint="Where this person works; they see and sell that branch's stock.">{(id) => (
            <Select id={id} placeholder={editing ? undefined : 'Same as mine'} {...r('branchId')}>
              {branches.data?.filter((b) => b.isActive || b.id === user?.branchId).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          )}</Field>
        )}
        {!editing ? (
          <Field label="Temporary password" required error={errors.password?.message} hint="10+ characters, upper and lower case and a number. They change it at first sign-in.">
            {(id) => <Input id={id} type="text" autoComplete="new-password" {...r('password')} />}
          </Field>
        ) : (
          <Field label="Status">{(id) => <Select id={id} {...r('status')}><option value="active">Active</option><option value="suspended">Suspended — cannot sign in</option></Select>}</Field>
        )}
        <Field label="Access ends" error={(errors as Record<string, { message?: string }>).accessExpiresOn?.message} hint="Optional — for temporary or locum staff. They cannot sign in after this day.">
          {(id) => <Input id={id} type="date" {...r('accessExpiresOn' as never)} />}
        </Field>
        <div className="sm:col-span-2">
          <p className="mb-1.5 text-[12.5px] font-medium">Roles <span className="text-danger">*</span></p>
          {errors.roleIds?.message && <p className="mb-1.5 text-[12px] text-danger">{errors.roleIds.message}</p>}
          <div className="grid gap-2 sm:grid-cols-2">
            {roles.data?.roles.filter((role) => role.code !== 'super_admin' || can('roles.manage')).map((role) => (
              <label key={role.id} className={`flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 ${selected.includes(role.id) ? 'border-brand-600 bg-brand-50/60' : 'border-line hover:bg-hover'}`}>
                <input type="checkbox" className="mt-0.5 accent-[var(--brand-600)]" checked={selected.includes(role.id)} onChange={() => toggle(role.id)} />
                <span><span className="block text-[13px] font-medium">{role.name}</span><span className="block text-[12px] text-muted">{role.description}</span></span>
              </label>
            ))}
          </div>
        </div>
      </form>
    </Modal>
  );
}
