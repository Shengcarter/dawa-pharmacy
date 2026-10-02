import { pool } from '../db/pool';
import { runAllAlerts } from '../modules/notifications/service';

runAllAlerts()
  .then(() => {
    console.log('Alerts refreshed.');
    return pool.end();
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
