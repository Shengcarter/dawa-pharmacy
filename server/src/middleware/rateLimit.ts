import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
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

/** Second sign-in step: few guesses per IP (each challenge also allows only 5 attempts). */
export const mfaLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: env.isTest ? 1000 : 15,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: message('Too many code attempts. Wait a few minutes and sign in again.'),
});

/**
 * Sensitive actions (password and 2FA changes, user administration, exports,
 * backups): limited per signed-in user, or per IP before sign-in.
 */
export const sensitiveLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: env.isTest ? 10_000 : 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => (req.actor ? `user:${req.actor.userId}` : `ip:${ipKeyGenerator(req.ip ?? '')}`),
  message: message('Too many sensitive requests. Wait a few minutes and try again.'),
});
