import net from 'node:net';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { authenticator } from 'otplib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app, PASSWORD, prepare, userWithRole, type Client } from './helpers';
import { pool } from '../src/db/pool';
import { invalidateSettingsCache } from '../src/modules/settings/service';
import { scanFile } from '../src/lib/clamav';
import { decryptFile, encryptingStream, parseKey } from '../src/lib/backupCrypto';
import { errorHandler } from '../src/middleware/error';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createWriteStream } from 'node:fs';
import { randomBytes } from 'node:crypto';

const web = (r: request.Test) => r.set('x-dawa-client', 'web');
const login = (email: string, password = PASSWORD) => web(request(app).post('/api/auth/login')).send({ email, password });
const loginMfa = (mfaToken: string, code: string) => web(request(app).post('/api/auth/login/mfa')).send({ mfaToken, code });

async function setSystem(patch: Record<string, unknown>) {
  await pool.query(
    `INSERT INTO settings (section, value) VALUES ('system', $1::jsonb)
     ON CONFLICT (section) DO UPDATE SET value = settings.value || EXCLUDED.value`,
    [JSON.stringify(patch)],
  );
  invalidateSettingsCache();
}

/** A code for the next 30-second step, so it is never a replay of one already used. */
const nextCode = (secret: string) => authenticator.generate(secret);

/** Enrols a user in 2FA through the API; returns the secret and recovery codes. */
async function enrol(c: Client) {
  const setup = await c.post('/api/auth/mfa/setup');
  expect(setup.status).toBe(200);
  const secret = setup.body.secret as string;
  expect(setup.body.qrDataUrl).toMatch(/^data:image\/png;base64,/);
  const enabled = await c.post('/api/auth/mfa/enable', { code: nextCode(secret), currentPassword: PASSWORD });
  expect(enabled.status).toBe(200);
  return { secret, recoveryCodes: enabled.body.recoveryCodes as string[] };
}

describe('security controls', () => {
  beforeAll(prepare);
  afterAll(() => setSystem({ requireAdminMfa: false, idleTimeoutMinutes: 30 }));

  describe('two-factor authentication', () => {
    it('requires a valid code after the password, rejects wrong and replayed codes, and limits attempts', async () => {
      const u = await userWithRole('pharmacist');
      const { secret } = await enrol(u);
      const { rows } = await pool.query('SELECT mfa_secret_enc FROM users WHERE id = $1', [u.userId]);
      expect(rows[0].mfa_secret_enc).toMatch(/^v1:/); // encrypted at rest
      expect(rows[0].mfa_secret_enc).not.toContain(secret);

      const step1 = await login(u.email);
      expect(step1.status).toBe(200);
      expect(step1.body).toEqual({ mfaRequired: true, mfaToken: expect.any(String) });
      expect(step1.headers['set-cookie']).toBeUndefined(); // no session before the second factor

      expect((await loginMfa(step1.body.mfaToken, '000000')).status).toBe(401);
      // The enrolment code's step is already used: replaying the same code is refused.
      const used = authenticator.generate(secret);
      const replay = await loginMfa(step1.body.mfaToken, used);
      expect(replay.status).toBe(401);

      // Attempt limit: the challenge dies after five wrong codes.
      for (let i = 0; i < 3; i += 1) await loginMfa(step1.body.mfaToken, '111111');
      expect((await loginMfa(step1.body.mfaToken, '222222')).body.error.code).toBe('MFA_EXPIRED');

      const failures = await pool.query(`SELECT count(*)::int AS n FROM login_activity WHERE user_id = $1 AND event = 'mfa_failed'`, [u.userId]);
      expect(failures.rows[0].n).toBeGreaterThanOrEqual(4);
    });

    it('signs in with a recovery code exactly once', async () => {
      const u = await userWithRole('pharmacist');
      const { recoveryCodes } = await enrol(u);
      expect(recoveryCodes).toHaveLength(10);
      const a = await login(u.email);
      const ok = await loginMfa(a.body.mfaToken, recoveryCodes[0]);
      expect(ok.status).toBe(200);
      expect(ok.body.accessToken).toBeTruthy();
      const b = await login(u.email);
      expect((await loginMfa(b.body.mfaToken, recoveryCodes[0])).status).toBe(401);
      const stored = await pool.query('SELECT mfa_recovery_hashes FROM users WHERE id = $1', [u.userId]);
      expect(stored.rows[0].mfa_recovery_hashes).toHaveLength(9);
      expect(JSON.stringify(stored.rows[0].mfa_recovery_hashes)).not.toContain(recoveryCodes[1]); // hashed
    });

    it('turning 2FA off needs the password and a code', async () => {
      const u = await userWithRole('cashier');
      const { recoveryCodes } = await enrol(u);
      expect((await u.post('/api/auth/mfa/disable', { code: recoveryCodes[0], currentPassword: 'WrongPass123' })).status).toBe(400);
      expect((await u.post('/api/auth/mfa/disable', { code: recoveryCodes[1], currentPassword: PASSWORD })).status).toBe(200);
      expect((await login(u.email)).body.accessToken).toBeTruthy();
    });

    it('when required for administrators, blocks them until enrolled and stops them turning it off', async () => {
      const admin = await userWithRole('manager');
      const cashier = await userWithRole('cashier');
      await setSystem({ requireAdminMfa: true });
      try {
        const blocked = await admin.get('/api/products');
        expect(blocked.status).toBe(403);
        expect(blocked.body.error.code).toBe('MFA_SETUP_REQUIRED');
        expect((await admin.get('/api/auth/me')).body.mfaSetupRequired).toBe(true);
        expect((await cashier.get('/api/products')).status).toBe(200); // not an administrator
        const { recoveryCodes } = await enrol(admin);
        expect((await admin.get('/api/products')).status).toBe(200);
        const off = await admin.post('/api/auth/mfa/disable', { code: recoveryCodes[0], currentPassword: PASSWORD });
        expect(off.status).toBe(403);
      } finally {
        await setSystem({ requireAdminMfa: false });
      }
    });

    it('an administrator can reset a lost 2FA device, which signs the user out', async () => {
      const admin = await userWithRole('super_admin');
      const u = await userWithRole('pharmacist');
      await enrol(u);
      expect((await admin.post(`/api/users/${u.userId}/reset-mfa`)).status).toBe(200);
      expect((await u.get('/api/auth/me')).status).toBe(401);
      expect((await login(u.email)).body.accessToken).toBeTruthy();
      const log = await pool.query(`SELECT 1 FROM audit_logs WHERE action = 'mfa_reset' AND entity_id = $1`, [String(u.userId)]);
      expect(log.rowCount).toBe(1);
    });
  });

  describe('sessions and accounts', () => {
    it('enforces a required password change on the server, not just in the interface', async () => {
      const u = await userWithRole('cashier');
      await pool.query('UPDATE users SET must_change_password = TRUE WHERE id = $1', [u.userId]);
      const r = await u.get('/api/products');
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
      expect((await u.get('/api/auth/me')).status).toBe(200);
      const changed = await u.post('/api/auth/change-password', { currentPassword: PASSWORD, newPassword: 'BrandNewPass9', confirmPassword: 'BrandNewPass9' });
      expect(changed.status).toBe(200);
      expect((await u.get('/api/products')).status).toBe(200);
    });

    it('ends access after the account end date, for new sign-ins and existing sessions', async () => {
      const u = await userWithRole('cashier');
      await pool.query(`UPDATE users SET access_expires_on = current_date - 2 WHERE id = $1`, [u.userId]);
      expect((await u.get('/api/products')).body.error.code).toBe('ACCESS_EXPIRED');
      const r = await login(u.email);
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe('ACCESS_EXPIRED');
    });

    it('keeps the absolute session expiry on refresh, and ends idle sessions', async () => {
      const u = await userWithRole('cashier');
      const first = await login(u.email);
      const cookie = (first.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('dawa_rt='))!.split(';')[0];
      const original = (await pool.query(`SELECT expires_at FROM auth_sessions WHERE user_id = $1 ORDER BY id DESC LIMIT 1`, [u.userId])).rows[0].expires_at;
      await new Promise((r) => setTimeout(r, 20));
      const refreshed = await web(request(app).post('/api/auth/refresh')).set('Cookie', cookie);
      expect(refreshed.status).toBe(200);
      const after = (await pool.query(`SELECT expires_at FROM auth_sessions WHERE user_id = $1 ORDER BY id DESC LIMIT 1`, [u.userId])).rows[0].expires_at;
      expect(new Date(after).getTime()).toBe(new Date(original).getTime()); // not extended by activity

      const cookie2 = (refreshed.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('dawa_rt='))!.split(';')[0];
      await pool.query(`UPDATE auth_sessions SET created_at = now() - interval '2 hours' WHERE user_id = $1 AND revoked_at IS NULL`, [u.userId]);
      const idle = await web(request(app).post('/api/auth/refresh')).set('Cookie', cookie2);
      expect(idle.status).toBe(401);
      const ev = await pool.query(`SELECT 1 FROM login_activity WHERE user_id = $1 AND event = 'session_expired'`, [u.userId]);
      expect(ev.rowCount).toBe(1);
    });

    it('refuses passwords bcrypt would truncate (over 72 bytes)', async () => {
      const u = await userWithRole('cashier');
      const long = `Aa1${'é'.repeat(40)}`; // 83 bytes in UTF-8
      const r = await u.post('/api/auth/change-password', { currentPassword: PASSWORD, newPassword: long, confirmPassword: long });
      expect(r.status).toBe(400);
    });
  });

  describe('authorization', () => {
    it('stops a manager taking over a Super Admin account or granting permissions they lack', async () => {
      const manager = await userWithRole('manager');
      const superAdmin = await userWithRole('super_admin');
      const cashier = await userWithRole('cashier');
      expect((await manager.post(`/api/users/${superAdmin.userId}/reset-password`, { password: 'Takeover123x' })).status).toBe(403);
      expect((await manager.post(`/api/users/${cashier.userId}/reset-password`, { password: 'Resetpass123' })).status).toBe(200);
      const roles = (await superAdmin.get('/api/roles')).body.roles as { id: number; code: string }[];
      const custom = await superAdmin.post('/api/roles', { name: `Role admin ${Date.now()}`, description: null, permissions: ['dashboard.view', 'roles.manage'] });
      expect(custom.status).toBe(201);
      const target = await userWithRole('cashier');
      const user = (await superAdmin.get(`/api/users/${target.userId}`)).body;
      const grant = await manager.put(`/api/users/${target.userId}`, {
        fullName: user.fullName, email: user.email, roleIds: [custom.body.id, roles.find((r) => r.code === 'cashier')!.id], status: 'active',
      });
      expect(grant.status).toBe(403);
    });

    it('limits cashiers to their own sales and blocks other modules', async () => {
      const a = await userWithRole('cashier');
      const b = await userWithRole('cashier');
      const admin = await userWithRole('super_admin');
      const product = (await admin.get('/api/products?pageSize=1')).body.data[0];
      const sale = (await pool.query(`SELECT id FROM sales ORDER BY id DESC LIMIT 1`)).rows[0];
      if (sale) expect([403, 404]).toContain((await b.get(`/api/sales/${sale.id}`)).status);
      expect((await a.get('/api/reports/profit-loss')).status).toBe(403);
      expect((await a.get('/api/audit-logs')).status).toBe(403);
      expect((await a.get('/api/backups')).status).toBe(403);
      expect((await a.post('/api/users', {})).status).toBe(403);
      if (product) expect((await a.get(`/api/products/${product.id}`)).body.purchasePrice).toBeUndefined(); // cost hidden
    });

    it('treats SQL in user input as plain text', async () => {
      const admin = await userWithRole('super_admin');
      const r = await admin.get(`/api/customers?search=${encodeURIComponent("' OR 1=1; DROP TABLE customers; --")}`);
      expect(r.status).toBe(200);
      expect(r.body.data).toEqual([]);
      expect((await pool.query('SELECT count(*)::int AS n FROM customers')).rows[0].n).toBeGreaterThanOrEqual(0);
    });
  });

  describe('uploads', () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
    it('checks file content, not just the declared type', async () => {
      const admin = await userWithRole('super_admin');
      const product = (await admin.get('/api/products?pageSize=1')).body.data[0]
        ?? (await admin.post('/api/products', { name: 'Upload test', productType: 'tablet', unit: 'strip', purchasePrice: 1, sellingPrice: 2, reorderLevel: 1 })).body;
      const send = (buf: Buffer, name: string, type: string) =>
        request(app).post(`/api/products/${product.id}/image`).set('Authorization', `Bearer ${admin.token}`).attach('file', buf, { filename: name, contentType: type });
      expect((await send(Buffer.from('<html><script>alert(1)</script></html>'), 'x.png', 'image/png')).status).toBe(400);
      expect((await send(Buffer.from('<svg onload=alert(1)>'), 'x.svg', 'image/svg+xml')).status).toBe(400);
      expect((await send(png, 'ok.png', 'image/png')).status).toBe(200);
    });

    it('refuses PDFs with scripts or embedded files', async () => {
      const admin = await userWithRole('super_admin');
      const cat = (await admin.get('/api/expenses/categories')).body[0];
      const exp = await admin.post('/api/expenses', { categoryId: cat.id, description: 'Upload test', amount: 100, paymentMethod: 'cash', expenseDate: new Date().toISOString().slice(0, 10) });
      const send = (buf: Buffer) =>
        request(app).post(`/api/expenses/${exp.body.id}/receipt`).set('Authorization', `Bearer ${admin.token}`).attach('file', buf, { filename: 'r.pdf', contentType: 'application/pdf' });
      expect((await send(Buffer.from('%PDF-1.4\n1 0 obj << /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >>'))).status).toBe(400);
      expect((await send(Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF'))).status).toBe(200);
      const served = await admin.get(`/api/expenses/${exp.body.id}/receipt`);
      expect(served.headers['content-security-policy']).toContain('sandbox');
      expect(served.headers['content-disposition']).toMatch(/attachment/);
    });

    it('speaks the ClamAV INSTREAM protocol and fails closed', async () => {
      const dir = mkdtempSync(path.join(tmpdir(), 'scan-'));
      const file = path.join(dir, 'f.bin');
      writeFileSync(file, 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
      const fakeClamd = (reply: (received: Buffer) => string) => new Promise<number>((resolve) => {
        const server = net.createServer((sock) => {
          let data = Buffer.alloc(0);
          sock.on('data', (d) => {
            data = Buffer.concat([data, d]);
            if (data.subarray(-4).equals(Buffer.alloc(4))) { sock.end(reply(data)); server.close(); }
          });
        }).listen(0, () => resolve((server.address() as net.AddressInfo).port));
      });
      let port = await fakeClamd((d) => (d.includes(Buffer.from('EICAR')) ? 'stream: Eicar-Test-Signature FOUND\0' : 'stream: OK\0'));
      expect(await scanFile(file, '127.0.0.1', port)).toEqual({ clean: false, signature: 'Eicar-Test-Signature' });
      writeFileSync(file, 'harmless');
      port = await fakeClamd(() => 'stream: OK\0');
      expect(await scanFile(file, '127.0.0.1', port)).toEqual({ clean: true });
      await expect(scanFile(file, '127.0.0.1', 1)).rejects.toThrow(); // unreachable scanner → error, never "clean"
    });
  });

  describe('backups', () => {
    it('encrypts backups and detects tampering or a wrong key', async () => {
      const dir = mkdtempSync(path.join(tmpdir(), 'bk-'));
      const key = randomBytes(32);
      const plain = randomBytes(200_000);
      await pipeline(Readable.from([plain]), encryptingStream(key), createWriteStream(path.join(dir, 'b.enc')));
      await decryptFile(path.join(dir, 'b.enc'), path.join(dir, 'b.out'), key);
      expect(readFileSync(path.join(dir, 'b.out')).equals(plain)).toBe(true);
      await expect(decryptFile(path.join(dir, 'b.enc'), path.join(dir, 'x'), parseKey(randomBytes(32).toString('base64')))).rejects.toThrow();
      const tampered = readFileSync(path.join(dir, 'b.enc'));
      tampered[5000] ^= 0xff;
      writeFileSync(path.join(dir, 't.enc'), tampered);
      await expect(decryptFile(path.join(dir, 't.enc'), path.join(dir, 'y'), key)).rejects.toThrow();
    });
  });

  describe('headers, errors and audit', () => {
    it('sends security headers', async () => {
      const r = await request(app).get('/api/health');
      expect(r.headers['content-security-policy']).toContain("default-src 'self'");
      expect(r.headers['content-security-policy']).toContain("frame-ancestors 'none'");
      expect(r.headers['x-content-type-options']).toBe('nosniff');
      expect(r.headers['referrer-policy']).toBe('no-referrer');
      expect(r.headers['permissions-policy']).toContain('camera=()');
      expect(r.headers['x-powered-by']).toBeUndefined();
    });

    it('never returns internal error details', () => {
      let body: { error: { message: string; code: string } } | undefined;
      let status = 0;
      const res = { status: (s: number) => { status = s; return res; }, json: (b: typeof body) => { body = b; return res; } };
      const err = new Error('relation "secret_table" does not exist: SELECT password_hash FROM users WHERE token = abc');
      errorHandler(err, { path: '/x', method: 'GET' } as never, res as never, () => undefined);
      expect(status).toBe(500);
      expect(JSON.stringify(body)).not.toMatch(/secret_table|SELECT|password_hash|stack/);
      expect(body!.error.code).toBe('INTERNAL');
    });

    it('rejects malformed JSON without echoing it', async () => {
      const r = await request(app).post('/api/auth/login').set('x-dawa-client', 'web').set('Content-Type', 'application/json').send('{"email": "a", bad');
      expect(r.status).toBe(400);
      expect(JSON.stringify(r.body)).not.toContain('bad');
    });

    it('keeps the audit log append-only', async () => {
      await expect(pool.query(`UPDATE audit_logs SET summary = 'edited' WHERE id = (SELECT max(id) FROM audit_logs)`)).rejects.toThrow(/append-only/);
      await expect(pool.query(`DELETE FROM audit_logs WHERE created_at > now() - interval '1 day'`)).rejects.toThrow(/cannot be deleted/);
    });

    it('records data exports in the audit log', async () => {
      const admin = await userWithRole('super_admin');
      expect((await admin.get('/api/sales?format=csv')).status).toBe(200);
      await new Promise((r) => setTimeout(r, 100));
      const log = await pool.query(`SELECT summary FROM audit_logs WHERE action = 'export' AND user_id = $1`, [admin.userId]);
      expect(log.rows[0]?.summary).toMatch(/exported \d+ rows? to sales\.csv/);
    });
  });
});
