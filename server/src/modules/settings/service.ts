import { SETTINGS_DEFAULTS, settingsSchemas, type Settings, type SettingsSection } from '@dawa/shared';
import { pool, type Db } from '../../db/pool';
import type { Actor } from '../../lib/actor';
import { audit, diff } from '../../lib/audit';

let cache: { value: Settings; at: number } | null = null;
const TTL_MS = 30_000;

/** All settings, merged over defaults. Cached briefly; invalidated on update. */
export async function getSettings(db: Db = pool): Promise<Settings> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const { rows } = await db.query('SELECT section, value FROM settings');
  const merged = structuredClone(SETTINGS_DEFAULTS) as Settings;
  for (const row of rows) {
    const section = row.section as SettingsSection;
    if (!(section in settingsSchemas)) continue;
    const parsed = settingsSchemas[section].safeParse({ ...merged[section], ...row.value });
    if (parsed.success) (merged as Record<string, unknown>)[section] = parsed.data;
  }
  cache = { value: merged, at: Date.now() };
  return merged;
}

export function invalidateSettingsCache() {
  cache = null;
}

export async function updateSettingsSection(actor: Actor, section: SettingsSection, input: unknown): Promise<Settings> {
  const current = await getSettings();
  const value = settingsSchemas[section].parse({ ...current[section], ...(input as object) });
  await pool.query(
    `INSERT INTO settings (section, value, updated_by, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (section) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [section, JSON.stringify(value), actor.userId],
  );
  const changes = diff(current[section] as Record<string, unknown>, value as Record<string, unknown>);
  if (changes) {
    await audit(pool, actor, {
      action: 'update',
      module: 'settings',
      entityType: 'settings',
      entityId: section,
      summary: `${actor.userName} updated ${section} settings (${Object.keys(changes.new).join(', ')})`,
      oldValues: changes.old,
      newValues: changes.new,
    });
  }
  invalidateSettingsCache();
  return getSettings();
}

/** Public subset used by receipts and the login screen. */
export async function publicSettings() {
  const s = await getSettings();
  return {
    pharmacyName: s.general.pharmacyName,
    address: s.general.address,
    phone: s.general.phone,
    email: s.general.email,
    logoPath: s.general.logoPath,
    currency: s.general.currency,
    timezone: s.general.timezone,
  };
}
