import { z } from 'zod';

/** UTF-8 length without platform APIs (the shared package runs in the browser and Node). */
const utf8Bytes = (v: string) => [...v].reduce((n, ch) => {
  const c = ch.codePointAt(0)!;
  return n + (c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4);
}, 0);

export const passwordRules = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128, 'Use 128 characters or fewer')
  // bcrypt only reads the first 72 bytes; refuse longer passwords instead of silently ignoring the rest.
  .refine((v) => utf8Bytes(v) <= 72, 'Use a shorter password (at most 72 bytes)')
  .regex(/[a-z]/, 'Include a lowercase letter')
  .regex(/[A-Z]/, 'Include an uppercase letter')
  .regex(/[0-9]/, 'Include a number');

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password').max(128),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: passwordRules,
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' })
  .refine((d) => d.newPassword !== d.currentPassword, { path: ['newPassword'], message: 'Choose a different password' });

/** A 6-digit authenticator code, or a recovery code (XXXXX-XXXXX). */
export const mfaCode = z
  .string()
  .trim()
  .transform((v) => v.replace(/\s/g, '').toUpperCase())
  .refine((v) => /^\d{6}$/.test(v) || /^[A-Z0-9]{5}-?[A-Z0-9]{5}$/.test(v), 'Enter the 6-digit code from your authenticator app, or a recovery code');

export const mfaLoginSchema = z.object({ mfaToken: z.string().min(20).max(200), code: mfaCode });
export const mfaEnableSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app'),
  currentPassword: z.string().min(1, 'Enter your current password'),
});
export const mfaDisableSchema = z.object({ code: mfaCode, currentPassword: z.string().min(1, 'Enter your current password') });

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
});

export const resetPasswordSchema = z
  .object({
    token: z.string().min(20).max(200),
    newPassword: passwordRules,
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' });

export const preferencesSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).default('light'),
  sidebarCollapsed: z.boolean().default(false),
  tableDensity: z.enum(['compact', 'comfortable']).default('compact'),
});
export type Preferences = z.infer<typeof preferencesSchema>;

export interface AuthUser {
  id: number;
  fullName: string;
  email: string;
  phone: string | null;
  jobTitle: string | null;
  roles: { code: string; name: string }[];
  permissions: string[];
  branch: { id: number; name: string };
  mustChangePassword: boolean;
  /** Two-factor authentication is on for this account. */
  mfaEnabled: boolean;
  /** Policy requires 2FA for this account (an administrator) and it is not set up yet. */
  mfaSetupRequired: boolean;
  preferences: Preferences;
}

/** Permissions that make an account an administrator for security policy (2FA). */
export const PRIVILEGED_PERMISSIONS = ['users.manage', 'roles.manage', 'settings.manage', 'backups.manage'] as const;
