import { rateLimit } from 'express-rate-limit';
import { env } from '../config/env';

const message = (text: string) => ({ error: { code: 'RATE_LIMITED', message: text } });

export const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: env.isTest ? 10_000 : 600,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: message('Too many requests. Please slow down.'),
});

export const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: env.isTest ? 1000 : 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: message('Too many sign-in attempts. Try again in a few minutes.'),
});

export const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: env.isTest ? 1000 : 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: message('Too many reset requests. Try again later.'),
});
