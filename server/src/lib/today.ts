import { todayIn } from '@dawa/shared';
import { getSettings } from '../modules/settings/service';
import type { Actor } from './actor';

/** Today's calendar date in the pharmacy's time zone (respecting a back-dated actor in seeds). */
export async function businessToday(actor?: Actor): Promise<string> {
  const settings = await getSettings();
  return todayIn(settings.general.timezone, actor?.occurredAt ?? new Date());
}

export async function businessTimezone(): Promise<string> {
  return (await getSettings()).general.timezone;
}
