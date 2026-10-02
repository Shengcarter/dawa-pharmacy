import { Router } from 'express';
import { z } from 'zod';
import { CURRENCIES, settingsSchemas, type SettingsSection } from '@dawa/shared';
import { actorOf, requirePermission } from '../../middleware/auth';
import { badRequest } from '../../lib/errors';
import { logoUpload, PUBLIC_DIR, relativePublicPath, removeStoredFile } from '../../lib/uploads';
import { mailEnabled } from '../../lib/mailer';
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
