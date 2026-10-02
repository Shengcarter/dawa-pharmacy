import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { forgotPasswordSchema, resetPasswordSchema } from '@dawa/shared';
import { api } from '@/lib/api';
import { useZodForm, applyServerErrors } from '@/lib/forms';
import { Alert, Button, Field, Input } from '@/components/ui';
import { AuthShell } from './AuthShell';

export function ForgotPasswordPage() {
  const [result, setResult] = useState<{ message: string; emailEnabled: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const form = useZodForm(forgotPasswordSchema, { defaultValues: { email: '' } });
  const submit = form.handleSubmit(async (data) => {
    setError(null);
    try {
      setResult(await api.post('/auth/forgot-password', data));
    } catch (e) {
      setError(applyServerErrors(form, e));
    }
  });
  return (
    <AuthShell title="Reset your password" subtitle="We'll email you a link to choose a new password.">
      {result ? (
        <div className="space-y-4">
          <Alert tone={result.emailEnabled ? 'success' : 'info'}>{result.message}</Alert>
          <Link to="/login" className="block text-center text-[13px] font-medium text-brand-700 hover:underline">Back to sign in</Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Email" error={form.formState.errors.email?.message}>
            {(id) => <Input id={id} type="email" autoFocus autoComplete="username" {...form.register('email')} />}
          </Field>
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={form.formState.isSubmitting}>Send reset link</Button>
          <Link to="/login" className="block text-center text-[13px] text-muted hover:text-fg">Back to sign in</Link>
        </form>
      )}
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';
  const [error, setError] = useState<string | null>(null);
  const form = useZodForm(resetPasswordSchema, { defaultValues: { token, newPassword: '', confirmPassword: '' } });
  const submit = form.handleSubmit(async (data) => {
    setError(null);
    try {
      await api.post('/auth/reset-password', data);
      navigate('/login', { replace: true });
    } catch (e) {
      setError(applyServerErrors(form, e));
    }
  });
  const { errors } = form.formState;
  return (
    <AuthShell title="Choose a new password" subtitle="At least 10 characters with upper- and lowercase letters and a number.">
      {!token ? (
        <Alert tone="danger">This link is incomplete. Request a new reset email.</Alert>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="New password" error={errors.newPassword?.message}>
            {(id) => <Input id={id} type="password" autoComplete="new-password" autoFocus {...form.register('newPassword')} />}
          </Field>
          <Field label="Confirm password" error={errors.confirmPassword?.message}>
            {(id) => <Input id={id} type="password" autoComplete="new-password" {...form.register('confirmPassword')} />}
          </Field>
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={form.formState.isSubmitting}>Update password</Button>
        </form>
      )}
    </AuthShell>
  );
}
