import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { loginSchema } from '@dawa/shared';
import { useAuth } from '@/lib/auth';
import { useZodForm } from '@/lib/forms';
import { ApiError } from '@/lib/api';
import { Alert, Button, Field, Input } from '@/components/ui';
import { AuthShell } from './AuthShell';
import { IDLE_FLAG } from '@/lib/idle';

export function LoginPage() {
  const { login, completeMfa, status } = useAuth();
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  // Validate on submit: an on-blur error would shift "Forgot password?" away from the pointer mid-click.
  const form = useZodForm(loginSchema, { defaultValues: { email: '', password: '' }, mode: 'onSubmit' });
  const [idleNotice] = useState(() => {
    try {
      const m = sessionStorage.getItem(IDLE_FLAG);
      sessionStorage.removeItem(IDLE_FLAG);
      return m ? `You were signed out after ${m} minutes without activity.` : null;
    } catch { return null; }
  });
  const state = location.state as { from?: string; notice?: string } | null;
  const from = state?.from ?? '/';

  if (status === 'signed-in') return <Navigate to={from} replace />;

  const submit = form.handleSubmit(async ({ email, password }) => {
    setError(null);
    try {
      const r = await login(email, password);
      if ('mfaToken' in r) { setMfaToken(r.mfaToken); return; }
      navigate(from, { replace: true });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not sign in. Check your connection.');
    }
  });

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaToken) return;
    setError(null);
    setVerifying(true);
    try {
      await completeMfa(mfaToken, code);
      navigate(from, { replace: true });
    } catch (err) {
      const expired = err instanceof ApiError && err.code === 'MFA_EXPIRED';
      setError(err instanceof ApiError ? err.message : 'Could not verify the code. Check your connection.');
      if (expired) { setMfaToken(null); setCode(''); }
    } finally {
      setVerifying(false);
    }
  };

  const { errors, isSubmitting } = form.formState;
  if (mfaToken) {
    return (
      <AuthShell title="Two-step verification" subtitle="Enter the 6-digit code from your authenticator app.">
        <form onSubmit={verify} className="space-y-4" noValidate>
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Verification code" hint="Lost your phone? Enter one of your recovery codes instead.">
            {(id) => (
              <Input id={id} autoFocus autoComplete="one-time-code" inputMode="text" maxLength={11} placeholder="123456"
                value={code} onChange={(e) => setCode(e.target.value)} className="text-center font-mono tracking-[0.3em]" />
            )}
          </Field>
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={verifying} disabled={code.trim().length < 6}>Verify and sign in</Button>
          <button type="button" className="w-full text-center text-[12.5px] text-muted hover:text-fg" onClick={() => { setMfaToken(null); setCode(''); setError(null); }}>
            Back to sign in
          </button>
        </form>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Sign in" subtitle="Use the email and password your manager set up for you.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error ? <Alert tone="danger">{error}</Alert> : state?.notice ? <Alert tone="success">{state.notice}</Alert> : idleNotice && <Alert tone="info">{idleNotice}</Alert>}
        <Field label="Email" error={errors.email?.message}>
          {(id) => <Input id={id} type="email" autoComplete="username" autoFocus placeholder="name@pharmacy.co.tz" invalid={!!errors.email} {...form.register('email')} />}
        </Field>
        <Field
          label="Password"
          error={errors.password?.message}
          action={<Link to="/forgot-password" className="text-[12px] font-medium text-brand-700 hover:underline">Forgot password?</Link>}
        >
          {(id) => (
            <div className="relative">
              <Input id={id} type={show ? 'text' : 'password'} autoComplete="current-password" invalid={!!errors.password} className="pr-9" {...form.register('password')} />
              <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-faint hover:text-fg" aria-label={show ? 'Hide password' : 'Show password'}>
                {show ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </button>
            </div>
          )}
        </Field>
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={isSubmitting}>
          Sign in
        </Button>
      </form>
    </AuthShell>
  );
}
