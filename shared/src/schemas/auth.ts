import { z } from 'zod';

export const passwordRules = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128, 'Use 128 characters or fewer')
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
  preferences: Preferences;
}
