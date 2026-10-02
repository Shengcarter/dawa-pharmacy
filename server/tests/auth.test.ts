import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, PASSWORD, prepare, userWithRole } from './helpers';
import { pool } from '../src/db/pool';

const login = (email: string, password: string) =>
  request(app).post('/api/auth/login').set('x-dawa-client', 'web').send({ email, password });
const refreshCookie = (res: request.Response) =>
  (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('dawa_rt='))!.split(';')[0];

describe('authentication', () => {
  beforeAll(prepare);

  it('signs in, returns permissions, and sets an HttpOnly SameSite=Strict refresh cookie', async () => {
    const u = await userWithRole('cashier');
    const res = await login(u.email, PASSWORD);
    expect(res.status).toBe(200);
    expect(res.body.user.permissions).toContain('pos.sell');
    expect(res.body.user.permissions).not.toContain('reports.financial');
    const cookie = (res.headers['set-cookie'] as unknown as string[])[0];
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
  });

  it('never stores plain-text passwords', async () => {
    const u = await userWithRole('cashier');
    const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [u.userId]);
    expect(rows[0].password_hash).not.toContain(PASSWORD);
    expect(rows[0].password_hash).toMatch(/^\$2[aby]\$/);
  });

  it('rejects wrong passwords and locks the account after 5 failures', async () => {
    const u = await userWithRole('cashier');
    for (let i = 0; i < 5; i += 1) expect((await login(u.email, 'WrongPass999')).status).toBe(401);
    const locked = await login(u.email, PASSWORD);
    expect(locked.status).toBe(423);
  });

  it('rejects login without the client header (CSRF guard)', async () => {
    const u = await userWithRole('cashier');
    const res = await request(app).post('/api/auth/login').send({ email: u.email, password: PASSWORD });
    expect(res.status).toBe(403);
  });

  it('rotates refresh tokens and revokes the family when an old token is replayed', async () => {
    const u = await userWithRole('pharmacist');
    const first = await login(u.email, PASSWORD);
    const cookie1 = refreshCookie(first);
    const r1 = await request(app).post('/api/auth/refresh').set('x-dawa-client', 'web').set('Cookie', cookie1);
    expect(r1.status).toBe(200);
    const cookie2 = refreshCookie(r1);
    expect(cookie2).not.toBe(cookie1);
    const replay = await request(app).post('/api/auth/refresh').set('x-dawa-client', 'web').set('Cookie', cookie1);
    expect(replay.status).toBe(401);
    const afterReuse = await request(app).post('/api/auth/refresh').set('x-dawa-client', 'web').set('Cookie', cookie2);
    expect(afterReuse.status).toBe(401);
  });

  it('logout ends the session immediately, including the access token', async () => {
    const u = await userWithRole('cashier');
    const res = await login(u.email, PASSWORD);
    const token = res.body.accessToken;
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`)).status).toBe(200);
    await request(app).post('/api/auth/logout').set('x-dawa-client', 'web').set('Cookie', refreshCookie(res));
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`)).status).toBe(401);
  });

  it('changes password only with the correct current password and enforces strength', async () => {
    const u = await userWithRole('cashier');
    expect((await u.post('/api/auth/change-password', { currentPassword: 'nope', newPassword: 'NewPassword123', confirmPassword: 'NewPassword123' })).status).toBe(400);
    expect((await u.post('/api/auth/change-password', { currentPassword: PASSWORD, newPassword: 'short', confirmPassword: 'short' })).status).toBe(400);
    const ok = await u.post('/api/auth/change-password', { currentPassword: PASSWORD, newPassword: 'NewPassword123', confirmPassword: 'NewPassword123' });
    expect(ok.status).toBe(200);
    expect((await login(u.email, 'NewPassword123')).status).toBe(200);
  });

  it('resets a password with a single-use token', async () => {
    const u = await userWithRole('cashier');
    const { randomToken, sha256 } = await import('../src/lib/tokens');
    const token = randomToken(32);
    await pool.query(`INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '10 minutes')`, [u.userId, sha256(token)]);
    const body = { token, newPassword: 'ResetPassword9', confirmPassword: 'ResetPassword9' };
    expect((await request(app).post('/api/auth/reset-password').send(body)).status).toBe(200);
    expect((await request(app).post('/api/auth/reset-password').send(body)).status).toBe(400);
    expect((await login(u.email, 'ResetPassword9')).status).toBe(200);
  });

  it('answers forgot-password identically for unknown and existing accounts', async () => {
    const u = await userWithRole('cashier');
    const ask = (email: string) => request(app).post('/api/auth/forgot-password').set('x-dawa-client', 'web').send({ email });
    const [known, unknown] = [await ask(u.email), await ask('nobody-here@example.com')];
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.body).toEqual(unknown.body);
    // The token is issued in the background.
    let issued = 0;
    for (let i = 0; i < 20 && !issued; i++) {
      issued = (await pool.query('SELECT count(*)::int AS n FROM password_resets WHERE user_id = $1', [u.userId])).rows[0].n;
      if (!issued) await new Promise((r) => setTimeout(r, 50));
    }
    expect(issued).toBe(1);
  });

  it('lets only settings managers send a test email, and explains when SMTP is not set up', async () => {
    const cashier = await userWithRole('cashier');
    expect((await cashier.post('/api/settings/test-email', {})).status).toBe(403);
    const admin = await userWithRole('super_admin');
    const res = await admin.post('/api/settings/test-email', {});
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/SMTP_HOST/);
  });

  it('suspending a user signs them out', async () => {
    const admin = await userWithRole('super_admin');
    const u = await userWithRole('cashier');
    const roles = (await admin.get('/api/roles')).body.roles as { id: number; code: string }[];
    const cashierRole = roles.find((r) => r.code === 'cashier')!;
    const res = await admin.put(`/api/users/${u.userId}`, { fullName: 'Suspended Person', email: u.email, roleIds: [cashierRole.id], status: 'suspended' });
    expect(res.status).toBe(200);
    expect((await u.get('/api/auth/me')).status).toBe(401);
  });
});
