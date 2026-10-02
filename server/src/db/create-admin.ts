import { createInterface } from 'node:readline/promises';
import { passwordRules } from '@dawa/shared';
import { pool } from './pool';
import { runMigrations } from './migrate';
import { syncSystemData } from './bootstrap';
import { hashPassword } from '../modules/auth/service';

/**
 * Creates the first Super Admin for a fresh production install:
 *   npm run create-admin -w server
 * Reads ADMIN_NAME / ADMIN_EMAIL / ADMIN_PASSWORD from the environment, or asks.
 */
async function main() {
  await runMigrations();
  await syncSystemData();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const name = process.env.ADMIN_NAME || (await rl.question('Full name: '));
  const email = (process.env.ADMIN_EMAIL || (await rl.question('Email: '))).trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || (await rl.question('Password (10+ chars, upper, lower, number): '));
  rl.close();
  const check = passwordRules.safeParse(password);
  if (!check.success) throw new Error(check.error.issues[0].message);
  const branch = await pool.query(`SELECT id FROM branches WHERE code = 'MAIN'`);
  const { rows } = await pool.query(
    `INSERT INTO users (branch_id, full_name, email, password_hash, job_title) VALUES ($1,$2,$3,$4,'Administrator')
     ON CONFLICT (lower(email)) DO NOTHING RETURNING id`,
    [branch.rows[0].id, name, email, await hashPassword(password)],
  );
  if (!rows[0]) throw new Error(`A user with email ${email} already exists.`);
  await pool.query(`INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = 'super_admin'`, [rows[0].id]);
  console.log(`Super Admin ${email} created.`);
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
