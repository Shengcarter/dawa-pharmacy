import { env } from '../config/env';
import { logger } from '../lib/logger';
import { runAllAlerts } from '../modules/notifications/service';
import { runScheduledBackup } from '../modules/backups/service';

/**
 * In-process scheduler (single-instance deployments). Alerts are recomputed
 * on an interval and after every stock-changing transaction. For multi-
 * instance setups run `npm run alerts` from cron instead and set the interval to 0.
 */
export function startScheduler(): () => void {
  if (env.isTest || env.ALERTS_INTERVAL_MINUTES === 0) return () => undefined;
  const tick = async () => {
    try {
      await runAllAlerts();
      await runScheduledBackup();
    } catch (err) {
      logger.error({ err }, 'Scheduled job failed');
    }
  };
  const first = setTimeout(tick, 5_000);
  const timer = setInterval(tick, env.ALERTS_INTERVAL_MINUTES * 60_000);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
