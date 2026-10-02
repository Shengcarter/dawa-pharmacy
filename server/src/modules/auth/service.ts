import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { preferencesSchema, type AuthUser } from '@dawa/shared';
import { pool, withTransaction, type Db } from '../../db/pool';
import type { Actor } from '../../lib/actor';
import { audit } from '../../lib/audit';
import { AppError, badRequest, unauthorized } from '../../lib/errors';
import { randomToken, sha256, signAccessToken } from '../../lib/tokens';
import { sendMail } from '../../lib/mailer';
import { env } from '../../config/env';
import { getSettings } from '../settings/service';

const BCRYPT_ROUNDS = 12;
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const RESET_TOKEN_MINUTES = 30;

export const hashPassword = (password: string) => bcrypt.hash(password, BCRYPT_ROUNDS);

interface ClientInfo {
  ip: string | null;
  userAgent: string | null;
}

async function logActivity(db: Db, userId: number | null, email: string, event: string, client: ClientInfo, detail?: string) {
  await db.query(
    `INSERT INTO login_activity (user_id, email, event, ip, user_agent, detail) VALUES ($1,$2,$3,$4,$5,$6)`,
    [userId, email, event, client.ip, client.userAgent?.slice(0, 300) ?? null, detail ?? null],
  );
}

export async function loadAuthUser(userId: number, db: Db = pool): Promise<AuthUser> {
  const { rows } = await db.query(
    `SELECT u.id, u.full_name, u.email, u.phone, u.job_title, u.must_change_password, u.preferences,
            b.id AS branch_id, b.name AS branch_name,
            COALESCE(json_agg(DISTINCT jsonb_build_object('code', r.code, 'name', r.name)) FILTER (WHERE r.id IS NOT NULL), '[]') AS roles,
            COALESCE(array_agg(DISTINCT p.code) FILTER (WHERE p.code IS NOT NULL), '{}') AS permissions
       FROM users u
       JOIN branches b ON b.id = u.branch_id
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       LEFT JOIN permissions p ON p.id = rp.permission_id
      WHERE u.id = $1
      GROUP BY u.id, b.id`,
    [userId],
  );
  const u = rows[0];
  if (!u) throw unauthorized();
  return {
    id: u.id,
    fullName: u.full_name,
    email: u.email,
    phone: u.phone,
    jobTitle: u.job_title,
    roles: u.roles,
    permissions: [...u.permissions].sort(),
    branch: { id: u.branch_id, name: u.branch_name },
    mustChangePassword: u.must_change_password,
    preferences: preferencesSchema.parse(u.preferences ?? {}),
  };
}

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  user: AuthUser;
}

async function issueSession(db: Db, userId: number, client: ClientInfo, familyId: string = randomUUID()) {
  const settings = await getSettings();
  const refreshToken = randomToken(48);
  const expiresAt = new Date(Date.now() + settings.system.sessionHours * 3_600_000);
  const { rows } = await db.query(
    `INSERT INTO auth_sessions (user_id, token_hash, family_id, expires_at, ip, user_agent)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [userId, sha256(refreshToken), familyId, expiresAt, client.ip, client.userAgent?.slice(0, 300) ?? null],
  );
  const sessionId = rows[0].id as number;
  return { sessionId, refreshToken, expiresAt, accessToken: signAccessToken(userId, sessionId) };
}

/** A precomputed hash so unknown emails take as long as wrong passwords (no user enumeration by timing). */
const DUMMY_HASH = bcrypt.hashSync('dawa-timing-equaliser', BCRYPT_ROUNDS);

export async function login(email: string, password: string, client: ClientInfo): Promise<IssuedSession> {
  const { rows } = await pool.query(
    `SELECT id, email, password_hash, status, failed_login_count, locked_until FROM users WHERE lower(email) = lower($1)`,
    [email],
  );
  const user = rows[0];
  const invalid = new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
  if (!user) {
    await bcrypt.compare(password, DUMMY_HASH);
    await logActivity(pool, null, email, 'login_failed', client, 'unknown email');
    throw invalid;
  }
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    await logActivity(pool, user.id, email, 'login_failed', client, 'account locked');
    throw new AppError(423, 'LOCKED', `Too many failed attempts. Try again after ${LOCK_MINUTES} minutes or ask a manager to reset your password.`);
  }
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    const failures = user.failed_login_count + 1;
    const lock = failures >= MAX_FAILED_LOGINS;
    await pool.query(
      `UPDATE users SET failed_login_count = $2, locked_until = CASE WHEN $3 THEN now() + make_interval(mins => $4) ELSE locked_until END WHERE id = $1`,
      [user.id, lock ? 0 : failures, lock, LOCK_MINUTES],
    );
    await logActivity(pool, user.id, email, lock ? 'locked' : 'login_failed', client, 'wrong password');
    throw invalid;
  }
  if (user.status !== 'active') {
    await logActivity(pool, user.id, email, 'login_failed', client, 'account suspended');
    throw new AppError(403, 'SUSPENDED', 'This account is suspended. Contact your manager.');
  }
  return withTransaction(async (tx) => {
    await tx.query(`UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = now() WHERE id = $1`, [user.id]);
    const session = await issueSession(tx, user.id, client);
    await logActivity(tx, user.id, user.email, 'login', client);
    const authUser = await loadAuthUser(user.id, tx);
    return { accessToken: session.accessToken, refreshToken: session.refreshToken, expiresAt: session.expiresAt, user: authUser };
  });
}

/**
 * Rotates a refresh token. Presenting a token that was already rotated means
 * it was copied: the whole session family is revoked.
 */
export async function refresh(refreshToken: string, client: ClientInfo): Promise<IssuedSession> {
  const ended = () => unauthorized('Your session has ended. Please sign in again.');
  const result = await withTransaction(async (tx) => {
    const { rows } = await tx.query(
      `SELECT s.*, u.status, u.email FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 FOR UPDATE OF s`,
      [sha256(refreshToken)],
    );
    const s = rows[0];
    if (!s) return null;
    if (s.revoked_at) {
      if (s.revoked_reason === 'rotated') {
        // Committed before the error is raised, so the revocation sticks.
        await tx.query(
          `UPDATE auth_sessions SET revoked_at = now(), revoked_reason = 'reuse_detected' WHERE family_id = $1 AND revoked_at IS NULL`,
          [s.family_id],
        );
        await logActivity(tx, s.user_id, s.email, 'token_reuse', client, 'refresh token reused; sessions revoked');
      }
      return null;
    }
    if (new Date(s.expires_at) <= new Date() || s.status !== 'active') return null;
    const next = await issueSession(tx, s.user_id, client, s.family_id);
    await tx.query(`UPDATE auth_sessions SET revoked_at = now(), revoked_reason = 'rotated', replaced_by = $2 WHERE id = $1`, [s.id, next.sessionId]);
    const user = await loadAuthUser(s.user_id, tx);
    return { accessToken: next.accessToken, refreshToken: next.refreshToken, expiresAt: next.expiresAt, user };
  });
  if (!result) throw ended();
  return result;
}

export async function logout(refreshToken: string | undefined, sessionId: number | undefined, client: ClientInfo) {
  const { rows } = await pool.query(
    `UPDATE auth_sessions SET revoked_at = now(), revoked_reason = 'logout'
      WHERE revoked_at IS NULL AND (token_hash = $1 OR id = $2)
      RETURNING user_id`,
    [refreshToken ? sha256(refreshToken) : null, sessionId ?? null],
  );
  if (rows[0]) {
    const { rows: u } = await pool.query('SELECT email FROM users WHERE id = $1', [rows[0].user_id]);
    await logActivity(pool, rows[0].user_id, u[0]?.email ?? '', 'logout', client);
  }
}

export async function changePassword(actor: Actor, sessionId: number, currentPassword: string, newPassword: string) {
  const { rows } = await pool.query('SELECT email, password_hash FROM users WHERE id = $1', [actor.userId]);
  if (!rows[0] || !(await bcrypt.compare(currentPassword, rows[0].password_hash))) {
    throw new AppError(400, 'VALIDATION', 'Current password is incorrect.', undefined);
  }
  const hash = await hashPassword(newPassword);
  await withTransaction(async (tx) => {
    await tx.query(
      `UPDATE users SET password_hash = $2, must_change_password = FALSE, password_changed_at = now(), updated_at = now() WHERE id = $1`,
      [actor.userId, hash],
    );
    // Sign out every other device.
    await tx.query(
      `UPDATE auth_sessions SET revoked_at = now(), revoked_reason = 'password_changed' WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL`,
      [actor.userId, sessionId],
    );
    await logActivity(tx, actor.userId, rows[0].email, 'password_changed', { ip: actor.ip ?? null, userAgent: actor.userAgent ?? null });
    await audit(tx, actor, { action: 'password_change', module: 'auth', entityType: 'user', entityId: actor.userId, summary: `${actor.userName} changed their password` });
  });
}

/** Always resolves the same way whether or not the email exists. */
export async function requestPasswordReset(email: string, client: ClientInfo): Promise<void> {
  const { rows } = await pool.query(`SELECT id, full_name, email, status FROM users WHERE lower(email) = lower($1)`, [email]);
  const user = rows[0];
  if (!user || user.status !== 'active') return;
  const token = randomToken(32);
  await pool.query(`UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, [user.id]);
  await pool.query(
    `INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1, $2, now() + make_interval(mins => $3))`,
    [user.id, sha256(token), RESET_TOKEN_MINUTES],
  );
  const settings = await getSettings();
  const link = `${env.APP_URL.replace(/\/$/, '')}/reset-password?token=${token}`;
  await sendMail(
    user.email,
    `${settings.general.pharmacyName}: reset your password`,
    `Hello ${user.full_name},\n\nUse this link within ${RESET_TOKEN_MINUTES} minutes to choose a new password:\n${link}\n\nIf you did not ask for this, ignore this email.`,
  );
  await logActivity(pool, user.id, user.email, 'password_reset', client, 'reset requested');
}

export async function resetPassword(token: string, newPassword: string, client: ClientInfo): Promise<void> {
  const hash = await hashPassword(newPassword);
  await withTransaction(async (tx) => {
    const { rows } = await tx.query(
      `SELECT r.id, r.user_id, u.email FROM password_resets r JOIN users u ON u.id = r.user_id
        WHERE r.token_hash = $1 AND r.used_at IS NULL AND r.expires_at > now() FOR UPDATE OF r`,
      [sha256(token)],
    );
    const reset = rows[0];
    if (!reset) throw badRequest('This reset link is invalid or has expired. Request a new one.');
    await tx.query(`UPDATE password_resets SET used_at = now() WHERE id = $1`, [reset.id]);
    await tx.query(
      `UPDATE users SET password_hash = $2, must_change_password = FALSE, failed_login_count = 0, locked_until = NULL,
              password_changed_at = now(), updated_at = now() WHERE id = $1`,
      [reset.user_id, hash],
    );
    await tx.query(`UPDATE auth_sessions SET revoked_at = now(), revoked_reason = 'password_reset' WHERE user_id = $1 AND revoked_at IS NULL`, [reset.user_id]);
    await logActivity(tx, reset.user_id, reset.email, 'password_reset', client, 'password reset completed');
  });
}

export async function updateProfile(actor: Actor, data: { fullName: string; phone: string | null }) {
  await pool.query(`UPDATE users SET full_name = $2, phone = $3, updated_at = now() WHERE id = $1`, [actor.userId, data.fullName, data.phone]);
  return loadAuthUser(actor.userId);
}

export async function updatePreferences(actor: Actor, prefs: unknown) {
  const value = preferencesSchema.parse(prefs);
  await pool.query(`UPDATE users SET preferences = $2 WHERE id = $1`, [actor.userId, JSON.stringify(value)]);
  return value;
}

export async function myLoginActivity(actor: Actor) {
  const { rows } = await pool.query(
    `SELECT id, event, ip, user_agent, detail, created_at FROM login_activity WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30`,
    [actor.userId],
  );
  return rows;
}
