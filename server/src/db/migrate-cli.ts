import { pool } from './pool';
import { runMigrations } from './migrate';

runMigrations()
  .then((ran) => {
    console.log(ran.length ? `Applied ${ran.length} migration(s).` : 'Database is up to date.');
    return pool.end();
  })
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
