import { Router } from 'express';
import { z } from 'zod';
import { CURRENCIES, settingsSchemas, type SettingsSection } from '@dawa/shared';
import { actorOf, requirePermission } from '../../middleware/auth';
import { AppError, badRequest } from '../../lib/errors';
import { pool } from '../../db/pool';
import { logoUpload, PUBLIC_DIR, relativePublicPath, removeStoredFile } from '../../lib/uploads';
import { mailEnabled, sendMail } from '../../lib/mailer';
import { getSettings, publicSettings, updateSettingsSection } from './service';

export const publicSettingsRouter = Router();
publicSettingsRouter.get('/settings', async (_req, res) => {
  res.json(await publicSettings());
});

export const settingsRouter = Router();

/** Every signed-in user needs currency, time zone and sales rules for the UI. */
settingsRouter.get('/', async (req, res) => {
  const s = await getSettings();
  const actor = actorOf(req);
  const full = actor.permissions.has('settings.view') || actor.permissions.has('settings.manage');
  res.json({
    general: s.general,
    inventory: s.inventory,
    sales: s.sales,
    ...(full ? { notifications: s.notifications, system: s.system } : {}),
    meta: { currencies: Object.values(CURRENCIES), emailEnabled: mailEnabled },
  });
});

settingsRouter.put('/:section', requirePermission('settings.manage'), async (req, res) => {
  const section = z.enum(Object.keys(settingsSchemas) as [SettingsSection, ...SettingsSection[]]).parse(req.params.section);
  const body = { ...req.body };
  if (section === 'general') delete body.logoPath; // logo changes go through the upload endpoint
  if (section === 'inventory') delete body.valuationMethod;
  res.json(await updateSettingsSection(actorOf(req), section, body));
});

/** Sends a test message to the signed-in manager so they can check the SMTP settings. */
settingsRouter.post('/test-email', requirePermission('settings.manage'), async (req, res) => {
  if (!mailEnabled) throw badRequest('Email is not configured. Set SMTP_HOST and SMTP_FROM (and SMTP_USER / SMTP_PASSWORD if your provider needs them) in the server environment, then restart.');
  const { rows } = await pool.query('SELECT email FROM users WHERE id = $1', [actorOf(req).userId]);
  const { general } = await getSettings();
  try {
    await sendMail(rows[0].email, `${general.pharmacyName}: test email`, `This is a test message from ${general.pharmacyName}. Outgoing email works, so staff can reset forgotten passwords by email.`);
  } catch (err) {
    throw new AppError(502, 'EMAIL_FAILED', `The mail server refused the message: ${(err as Error).message}`);
  }
  res.json({ sentTo: rows[0].email });
});

settingsRouter.post('/logo', requirePermission('settings.manage'), logoUpload, async (req, res) => {
  if (!req.file) throw badRequest('Choose an image to upload.');
  const before = (await getSettings()).general.logoPath;
  const logoPath = relativePublicPath('branding', req.file.filename);
  await updateSettingsSection(actorOf(req), 'general', { logoPath });
  await removeStoredFile(PUBLIC_DIR, before);
  res.json({ logoPath });
});

settingsRouter.delete('/logo', requirePermission('settings.manage'), async (req, res) => {
  const before = (await getSettings()).general.logoPath;
  await updateSettingsSection(actorOf(req), 'general', { logoPath: null });
  await removeStoredFile(PUBLIC_DIR, before);
  res.status(204).end();
});
