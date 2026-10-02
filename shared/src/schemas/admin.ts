import { z } from 'zod';
import { passwordRules } from './auth';
import { optionalPhone, optionalText, requiredText } from './common';

export const userCreateSchema = z.object({
  fullName: requiredText('Full name', 120),
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  phone: optionalPhone,
  jobTitle: optionalText(80),
  roleIds: z.array(z.coerce.number().int().positive()).min(1, 'Assign at least one role'),
  password: passwordRules,
});

export const userUpdateSchema = z.object({
  fullName: requiredText('Full name', 120),
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  phone: optionalPhone,
  jobTitle: optionalText(80),
  roleIds: z.array(z.coerce.number().int().positive()).min(1, 'Assign at least one role'),
  status: z.enum(['active', 'suspended']),
});

export const adminResetPasswordSchema = z.object({ password: passwordRules });

export const profileSchema = z.object({
  fullName: requiredText('Full name', 120),
  phone: optionalPhone,
});

export const roleSchema = z.object({
  name: requiredText('Role name', 60),
  description: optionalText(200),
  permissions: z.array(z.string()).min(1, 'Choose at least one permission'),
});
