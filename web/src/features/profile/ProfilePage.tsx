import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Monitor, Moon, Sun } from 'lucide-react';
import { changePasswordSchema, profileSchema, type AuthUser } from '@dawa/shared';
import { api } from '@/lib/api';
import { useAuth, useUser } from '@/lib/auth';
import { applyServerErrors, useZodForm } from '@/lib/forms';
import { applyTheme } from '@/lib/hooks';
import { cn } from '@/lib/cn';
import { Page } from '@/components/layout/AppLayout';
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Switch, Tabs, useToast } from '@/components/ui';
import { LoginActivityTable, type LoginEvent } from '../users/UserDetailPage';

type Tab = 'profile' | 'password' | 'preferences' | 'activity';

export function ProfilePage() {
  const user = useUser();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) ?? 'profile';
  const required = params.get('required') === '1' || user.mustChangePassword;
  return (
    <Page>
      <PageHeader title="My profile" description={`${user.email} · ${user.roles.map((r) => r.name).join(', ')}`} />
      {required && <Alert tone="warning" className="mb-4" title="Choose a new password to continue">Your password was set by an administrator. Choose your own before using the system.</Alert>}
      <Tabs className="mb-4" value={required ? 'password' : tab} onChange={(t) => !required && setParams({ tab: t })} tabs={[
        { value: 'profile', label: 'Profile' }, { value: 'password', label: 'Password' }, { value: 'preferences', label: 'Preferences' }, { value: 'activity', label: 'Sign-in activity' },
      ]} />
      <div className="max-w-2xl">
        {(required || tab === 'password') && <PasswordForm />}
        {!required && tab === 'profile' && <ProfileForm />}
        {!required && tab === 'preferences' && <Preferences />}
        {!required && tab === 'activity' && <Activity />}
      </div>
    </Page>
  );
}

function ProfileForm() {
  const user = useUser();
  const { setUser } = useAuth();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const form = useZodForm(profileSchema, { defaultValues: { fullName: user.fullName, phone: user.phone ?? '' } });
  const save = useMutation({ mutationFn: (b: unknown) => api.put<AuthUser>('/auth/profile', b) });
  const submit = form.handleSubmit(async (d) => {
    try { setUser(await save.mutateAsync(d)); toast.success('Profile updated'); } catch (e) { setError(applyServerErrors(form, e)); }
  });
  return (
    <Card title="Your details">
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" required error={form.formState.errors.fullName?.message}>{(id) => <Input id={id} {...form.register('fullName')} />}</Field>
          <Field label="Phone" error={form.formState.errors.phone?.message}>{(id) => <Input id={id} {...form.register('phone')} />}</Field>
          <Field label="Email" hint="Ask an administrator to change your sign-in email.">{(id) => <Input id={id} value={user.email} disabled />}</Field>
          <Field label="Branch">{(id) => <Input id={id} value={user.branch.name} disabled />}</Field>
        </div>
        <div className="flex flex-wrap gap-1">{user.roles.map((r) => <Badge key={r.code} tone="brand">{r.name}</Badge>)}</div>
        <div className="flex justify-end"><Button type="submit" variant="primary" loading={save.isPending}>Save</Button></div>
      </form>
    </Card>
  );
}

function PasswordForm() {
  const user = useUser();
  const { setUser } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const form = useZodForm(changePasswordSchema, { defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' } });
  const save = useMutation({ mutationFn: (b: unknown) => api.post<{ message: string }>('/auth/change-password', b) });
  const submit = form.handleSubmit(async (d) => {
    setError(null);
    try {
      const r = await save.mutateAsync(d);
      toast.success('Password changed', r.message);
      form.reset();
      if (user.mustChangePassword) { setUser({ ...user, mustChangePassword: false }); navigate('/'); }
    } catch (e) { setError(applyServerErrors(form, e)); }
  });
  const { errors } = form.formState;
  return (
    <Card title="Change password" description="At least 10 characters, with upper- and lowercase letters and a number. Other devices are signed out.">
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Current password" required error={errors.currentPassword?.message}>{(id) => <Input id={id} type="password" autoComplete="current-password" {...form.register('currentPassword')} />}</Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="New password" required error={errors.newPassword?.message}>{(id) => <Input id={id} type="password" autoComplete="new-password" {...form.register('newPassword')} />}</Field>
          <Field label="Confirm new password" required error={errors.confirmPassword?.message}>{(id) => <Input id={id} type="password" autoComplete="new-password" {...form.register('confirmPassword')} />}</Field>
        </div>
        <div className="flex justify-end"><Button type="submit" variant="primary" loading={save.isPending}>Change password</Button></div>
      </form>
    </Card>
  );
}

function Preferences() {
  const user = useUser();
  const { setUser } = useAuth();
  const toast = useToast();
  const [prefs, setPrefs] = useState(user.preferences);
  useEffect(() => applyTheme(prefs.theme), [prefs.theme]);
  const save = useMutation({
    mutationFn: () => api.put<AuthUser['preferences']>('/auth/preferences', prefs),
    onSuccess: (p) => { setUser({ ...user, preferences: p }); toast.success('Preferences saved'); },
  });
  const themes = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'Match device', icon: Monitor },
  ] as const;
  return (
    <Card title="Preferences">
      <div className="space-y-5">
        <div>
          <p className="mb-2 text-[13px] font-medium">Appearance</p>
          <div className="grid grid-cols-3 gap-2 sm:max-w-md">
            {themes.map((t) => (
              <button key={t.value} onClick={() => setPrefs({ ...prefs, theme: t.value })}
                className={cn('flex flex-col items-center gap-1.5 rounded-md border px-3 py-3 text-[12.5px] font-medium', prefs.theme === t.value ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-line hover:bg-hover')}>
                <t.icon className="size-4" />{t.label}
              </button>
            ))}
          </div>
        </div>
        <Switch checked={prefs.sidebarCollapsed} onChange={(v) => setPrefs({ ...prefs, sidebarCollapsed: v })} label="Collapsed sidebar" description="Show only icons in the navigation on large screens." />
        <div className="flex justify-end border-t border-line pt-4"><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save preferences</Button></div>
      </div>
    </Card>
  );
}

function Activity() {
  const { data } = useQuery({ queryKey: ['my-activity'], queryFn: () => api.get<LoginEvent[]>('/auth/activity') });
  return <Card title="Recent sign-ins" description="If you see activity you don't recognise, change your password and tell your manager." flush><LoginActivityTable rows={data ?? []} /></Card>;
}
