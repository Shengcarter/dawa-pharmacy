import { createInterface } from 'node:readline';
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
  const ask = prompter();
  const name = process.env.ADMIN_NAME || (await ask('Full name: '));
  const email = (process.env.ADMIN_EMAIL || (await ask('Email: '))).trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || (await ask('Password (10+ chars, upper, lower, number): ', true));
  ask.close();
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

/**
 * Line-by-line prompts that also work with piped input (readline's question()
 * drops lines that arrive before it is asked). Hidden answers are not echoed
 * on a terminal.
 */
function prompter() {
  const tty = process.stdin.isTTY === true;
  let muted = false;
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: tty });
  if (tty) {
    const write = (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput.bind(rl);
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s) => write(muted && !s.includes('\n') ? '' : s);
  }
  const lines: string[] = [];
  const waiting: ((line: string) => void)[] = [];
  let ended = false;
  rl.on('line', (line) => (waiting.length ? waiting.shift()!(line) : lines.push(line)));
  rl.on('close', () => {
    ended = true;
    while (waiting.length) waiting.shift()!('');
  });
  const ask = (prompt: string, hidden = false) =>
    new Promise<string>((resolve) => {
      process.stdout.write(prompt);
      muted = hidden;
      const done = (line: string) => {
        muted = false;
        resolve(line);
      };
      if (lines.length) done(lines.shift()!);
      else if (ended) done('');
      else waiting.push(done);
    });
  return Object.assign(ask, { close: () => rl.close() });
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
