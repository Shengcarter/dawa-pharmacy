import { Router, type Request, type Response } from 'express';
import {
  changePasswordSchema, forgotPasswordSchema, loginSchema, mfaCode, mfaDisableSchema, mfaEnableSchema, mfaLoginSchema, preferencesSchema,
  profileSchema, resetPasswordSchema,
} from '@dawa/shared';
import { z } from 'zod';
import { env } from '../../config/env';
import { actorOf, authenticate, clientIp, requireClientHeader } from '../../middleware/auth';
import { loginLimiter, mfaLimiter, passwordResetLimiter, sensitiveLimiter } from '../../middleware/rateLimit';
import { mailEnabled } from '../../lib/mailer';
import { logger } from '../../lib/logger';
import * as auth from './service';

const COOKIE = 'dawa_rt';
const cookiePath = '/api/auth';

function setRefreshCookie(res: Response, token: string, expiresAt: Date) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'strict',
    path: cookiePath,
    expires: expiresAt,
  });
}

const client = (req: Request) => ({ ip: clientIp(req), userAgent: req.headers['user-agent'] ?? null });

export const authRouter = Router();

authRouter.post('/login', loginLimiter, requireClientHeader, async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  const result = await auth.login(email, password, client(req));
  if (result.mfaRequired) {
    res.json({ mfaRequired: true, mfaToken: result.mfaToken });
    return;
  }
  setRefreshCookie(res, result.refreshToken, result.expiresAt);
  res.json({ accessToken: result.accessToken, user: result.user });
});

/** Second sign-in step for accounts with two-factor authentication. */
authRouter.post('/login/mfa', mfaLimiter, requireClientHeader, async (req, res) => {
  const { mfaToken, code } = mfaLoginSchema.parse(req.body);
  const session = await auth.completeMfaLogin(mfaToken, code, client(req));
  setRefreshCookie(res, session.refreshToken, session.expiresAt);
  res.json({ accessToken: session.accessToken, user: session.user });
});

authRouter.post('/mfa/setup', authenticate, sensitiveLimiter, async (req, res) => {
  res.json(await auth.startMfaSetup(actorOf(req)));
});
authRouter.post('/mfa/enable', authenticate, sensitiveLimiter, async (req, res) => {
  const { code, currentPassword } = mfaEnableSchema.parse(req.body);
  res.json(await auth.enableMfa(actorOf(req), code, currentPassword, client(req)));
});
authRouter.post('/mfa/disable', authenticate, sensitiveLimiter, async (req, res) => {
  const { code, currentPassword } = mfaDisableSchema.parse(req.body);
  await auth.disableMfa(actorOf(req), code, currentPassword, client(req));
  res.json({ message: 'Two-factor authentication is off.' });
});
authRouter.post('/mfa/recovery-codes', authenticate, sensitiveLimiter, async (req, res) => {
  const { code } = z.object({ code: mfaCode }).parse(req.body);
  res.json(await auth.regenerateRecoveryCodes(actorOf(req), code));
});

authRouter.post('/refresh', requireClientHeader, async (req, res) => {
  const token = req.cookies?.[COOKIE];
  if (!token) {
    // No session cookie is a normal state (signed out), not an error.
    res.json({ accessToken: null, user: null });
    return;
  }
  try {
    const session = await auth.refresh(token, client(req));
    if (session.refreshToken) setRefreshCookie(res, session.refreshToken, session.expiresAt);
    res.json({ accessToken: session.accessToken, user: session.user });
  } catch (err) {
    res.clearCookie(COOKIE, { path: cookiePath });
    throw err;
  }
});

authRouter.post('/logout', requireClientHeader, async (req, res) => {
  await auth.logout(req.cookies?.[COOKIE], undefined, client(req));
  res.clearCookie(COOKIE, { path: cookiePath });
  res.status(204).end();
});

authRouter.post('/forgot-password', passwordResetLimiter, async (req, res) => {
  const { email } = forgotPasswordSchema.parse(req.body);
  // Runs in the background so the answer (and its timing) is the same whether
  // or not the email has an account, and an SMTP outage is logged, not shown.
  void auth.requestPasswordReset(email, client(req)).catch((err) => logger.error({ err }, 'Password reset email failed'));
  res.json({
    message: mailEnabled
      ? 'If that email belongs to an active account, a reset link is on its way.'
      : 'Email is not configured for this pharmacy. Ask a manager to reset your password from Users.',
    emailEnabled: mailEnabled,
  });
});

authRouter.post('/reset-password', passwordResetLimiter, async (req, res) => {
  const { token, newPassword } = resetPasswordSchema.parse(req.body);
  await auth.resetPassword(token, newPassword, client(req));
  res.json({ message: 'Password updated. You can now sign in.' });
});

authRouter.get('/me', authenticate, async (req, res) => {
  res.json(await auth.loadAuthUser(actorOf(req).userId));
});

authRouter.post('/change-password', authenticate, sensitiveLimiter, async (req, res) => {
  const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
  await auth.changePassword(actorOf(req), req.sessionId!, currentPassword, newPassword);
  res.json({ message: 'Password changed. Other devices have been signed out.' });
});

authRouter.put('/profile', authenticate, async (req, res) => {
  res.json(await auth.updateProfile(actorOf(req), profileSchema.parse(req.body)));
});

authRouter.put('/preferences', authenticate, async (req, res) => {
  res.json(await auth.updatePreferences(actorOf(req), preferencesSchema.parse(req.body)));
});

authRouter.get('/activity', authenticate, async (req, res) => {
  res.json(await auth.myLoginActivity(actorOf(req)));
});
