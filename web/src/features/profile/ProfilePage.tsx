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

type Tab = 'profile' | 'password' | 'security' | 'preferences' | 'activity';

export function ProfilePage() {
  const user = useUser();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) ?? 'profile';
  const required = params.get('required') === '1' || user.mustChangePassword;
  // A password change comes first, then 2FA set-up when policy requires it.
  const mfaRequired = !required && user.mfaSetupRequired;
  const forced: Tab | null = required ? 'password' : mfaRequired ? 'security' : null;
  return (
    <Page>
      <PageHeader title="My profile" description={`${user.email} · ${user.roles.map((r) => r.name).join(', ')}`} />
      {required && <Alert tone="warning" className="mb-4" title="Choose a new password to continue">Your password was set by an administrator. Choose your own before using the system.</Alert>}
      {mfaRequired && <Alert tone="warning" className="mb-4" title="Set up two-factor authentication to continue">Your role can manage users, settings or backups, so the pharmacy requires a second sign-in step for your account.</Alert>}
      <Tabs className="mb-4" value={forced ?? tab} onChange={(t) => !forced && setParams({ tab: t })} tabs={[
        { value: 'profile', label: 'Profile' }, { value: 'password', label: 'Password' }, { value: 'security', label: 'Two-factor' },
        { value: 'preferences', label: 'Preferences' }, { value: 'activity', label: 'Sign-in activity' },
      ]} />
      <div className="max-w-2xl">
        {(required || (!forced && tab === 'password')) && <PasswordForm />}
        {(mfaRequired || (!forced && tab === 'security')) && <TwoFactor />}
        {!forced && tab === 'profile' && <ProfileForm />}
        {!forced && tab === 'preferences' && <Preferences />}
        {!forced && tab === 'activity' && <Activity />}
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

function TwoFactor() {
  const user = useUser();
  const { setUser } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string; qrDataUrl: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'idle' | 'disable' | 'regenerate'>('idle');
  const [error, setError] = useState<string | null>(null);
  const reset = () => { setCode(''); setPassword(''); setError(null); };
  const refreshUser = async () => setUser(await api.get<AuthUser>('/auth/me'));

  const start = useMutation({
    mutationFn: () => api.post<{ secret: string; otpauthUrl: string; qrDataUrl: string }>('/auth/mfa/setup'),
    onSuccess: (r) => { reset(); setSetup(r); },
    onError: (e) => setError((e as Error).message),
  });
  const enable = useMutation({
    mutationFn: () => api.post<{ recoveryCodes: string[] }>('/auth/mfa/enable', { code, currentPassword: password }),
    onSuccess: async (r) => { setSetup(null); reset(); setCodes(r.recoveryCodes); await refreshUser(); toast.success('Two-factor authentication is on'); },
    onError: (e) => setError((e as Error).message),
  });
  const disable = useMutation({
    mutationFn: () => api.post('/auth/mfa/disable', { code, currentPassword: password }),
    onSuccess: async () => { setMode('idle'); reset(); await refreshUser(); toast.success('Two-factor authentication is off'); },
    onError: (e) => setError((e as Error).message),
  });
  const regenerate = useMutation({
    mutationFn: () => api.post<{ recoveryCodes: string[] }>('/auth/mfa/recovery-codes', { code }),
    onSuccess: (r) => { setMode('idle'); reset(); setCodes(r.recoveryCodes); },
    onError: (e) => setError((e as Error).message),
  });

  if (codes) {
    return (
      <Card title="Save your recovery codes">
        <Alert tone="warning" className="mb-4">Each code works once, if you lose your phone. Store them somewhere safe (printed, or in a password manager). They will not be shown again.</Alert>
        <div className="grid grid-cols-2 gap-2 rounded-md border border-line bg-subtle p-4 font-mono text-[14px] sm:grid-cols-5">
          {codes.map((c) => <span key={c}>{c}</span>)}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={() => navigator.clipboard.writeText(codes.join('\n')).then(() => toast.success('Copied')).catch(() => undefined)}>Copy</Button>
          <Button variant="primary" onClick={() => { setCodes(null); if (window.location.search.includes('required')) navigate('/'); }}>I have saved them</Button>
        </div>
      </Card>
    );
  }

  if (setup) {
    return (
      <Card title="Set up your authenticator app">
        <ol className="mb-4 list-decimal space-y-1 pl-5 text-[13px] text-muted">
          <li>Install an authenticator app (Google Authenticator, Microsoft Authenticator, Authy…).</li>
          <li>Scan this QR code with it, or type the key by hand.</li>
          <li>Enter the 6-digit code it shows, and your password.</li>
        </ol>
        <div className="flex flex-wrap items-start gap-5">
          <img src={setup.qrDataUrl} alt="QR code for your authenticator app" className="size-44 rounded border border-line bg-white p-1" />
          <form className="min-w-[240px] flex-1 space-y-3" onSubmit={(e) => { e.preventDefault(); enable.mutate(); }}>
            {error && <Alert tone="danger">{error}</Alert>}
            <Field label="Key (if you cannot scan)">{(id) => <Input id={id} readOnly value={setup.secret.replace(/(.{4})/g, '$1 ').trim()} className="font-mono text-[12px]" />}</Field>
            <Field label="6-digit code">{(id) => <Input id={id} autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} className="font-mono tracking-[0.3em]" />}</Field>
            <Field label="Your password">{(id) => <Input id={id} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
            <div className="flex justify-end gap-2">
              <Button onClick={() => { setSetup(null); reset(); }}>Cancel</Button>
              <Button type="submit" variant="primary" loading={enable.isPending} disabled={code.length !== 6 || !password}>Turn on</Button>
            </div>
          </form>
        </div>
      </Card>
    );
  }

  if (!user.mfaEnabled) {
    return (
      <Card title="Two-factor authentication">
        {error && <Alert tone="danger" className="mb-3">{error}</Alert>}
        <p className="text-[13px] text-muted">Signing in will need your password and a 6-digit code from an app on your phone, so a stolen password alone is not enough.</p>
        <div className="mt-4 flex justify-end"><Button variant="primary" loading={start.isPending} onClick={() => start.mutate()}>Set up two-factor authentication</Button></div>
      </Card>
    );
  }

  return (
    <Card title="Two-factor authentication" actions={<Badge tone="success" dot>On</Badge>}>
      <p className="text-[13px] text-muted">Each sign-in asks for a code from your authenticator app. If you lose your phone, use a recovery code, or ask an administrator to reset it.</p>
      {mode !== 'idle' ? (
        <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); (mode === 'disable' ? disable : regenerate).mutate(); }}>
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Current code (or a recovery code)">{(id) => <Input id={id} autoFocus autoComplete="one-time-code" maxLength={11} value={code} onChange={(e) => setCode(e.target.value)} className="font-mono" />}</Field>
          {mode === 'disable' && <Field label="Your password">{(id) => <Input id={id} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>}
          <div className="flex justify-end gap-2">
            <Button onClick={() => { setMode('idle'); reset(); }}>Cancel</Button>
            <Button type="submit" variant={mode === 'disable' ? 'danger' : 'primary'} loading={disable.isPending || regenerate.isPending} disabled={code.trim().length < 6 || (mode === 'disable' && !password)}>
              {mode === 'disable' ? 'Turn off' : 'Generate new codes'}
            </Button>
          </div>
        </form>
      ) : (
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button onClick={() => setMode('regenerate')}>New recovery codes</Button>
          <Button variant="danger" onClick={() => setMode('disable')}>Turn off</Button>
        </div>
      )}
    </Card>
  );
}
