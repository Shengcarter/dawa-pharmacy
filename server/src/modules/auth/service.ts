import { randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { PRIVILEGED_PERMISSIONS, preferencesSchema, todayIn, type AuthUser } from '@dawa/shared';
import { pool, withTransaction, type Db } from '../../db/pool';
import type { Actor } from '../../lib/actor';
import { audit } from '../../lib/audit';
import { AppError, badRequest, forbidden, unauthorized, unprocessable } from '../../lib/errors';
import { decrypt, encrypt } from '../../lib/crypto';
import { randomToken, sha256, signAccessToken } from '../../lib/tokens';
import { sendMail } from '../../lib/mailer';
import { env } from '../../config/env';
import { getSettings } from '../settings/service';

const BCRYPT_ROUNDS = 12;
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const RESET_TOKEN_MINUTES = 30;
const MFA_CHALLENGE_MINUTES = 5;
const MFA_MAX_ATTEMPTS = 5;
const RECOVERY_CODE_COUNT = 10;
// Accept the previous and next 30-second code for clock drift.
authenticator.options = { window: 1 };

export const hashPassword = (password: string) => bcrypt.hash(password, BCRYPT_ROUNDS);

export interface ClientInfo {
  ip: string | null;
  userAgent: string | null;
}

export async function logActivity(db: Db, userId: number | null, email: string, event: string, client: ClientInfo, detail?: string) {
  await db.query(
    `INSERT INTO login_activity (user_id, email, event, ip, user_agent, detail) VALUES ($1,$2,$3,$4,$5,$6)`,
    [userId, email, event, client.ip, client.userAgent?.slice(0, 300) ?? null, detail ?? null],
  );
}

export async function loadAuthUser(userId: number, db: Db = pool): Promise<AuthUser> {
  const { rows } = await db.query(
    `SELECT u.id, u.full_name, u.email, u.phone, u.job_title, u.must_change_password, u.preferences, u.mfa_enabled_at,
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
  const mfaEnabled = u.mfa_enabled_at !== null;
  const mfaRequired = await mfaRequiredFor(u.permissions);
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
    mfaEnabled,
    mfaSetupRequired: mfaRequired && !mfaEnabled,
    preferences: preferencesSchema.parse(u.preferences ?? {}),
  };
}

export interface IssuedSession {
  accessToken: string;
  /** Null when the cookie already holds the current refresh token (see refresh()). */
  refreshToken: string | null;
  expiresAt: Date;
  user: AuthUser;
}

/**
 * Creates a session row. A rotation passes the family's original expiry: the
 * session length is absolute from sign-in, however active the user is.
 */
async function issueSession(db: Db, userId: number, client: ClientInfo, familyId: string = randomUUID(), absoluteExpiry?: Date) {
  const settings = await getSettings();
  const refreshToken = randomToken(48);
  const expiresAt = absoluteExpiry ?? new Date(Date.now() + settings.system.sessionHours * 3_600_000);
  const { rows } = await db.query(
    `INSERT INTO auth_sessions (user_id, token_hash, family_id, expires_at, ip, user_agent)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [userId, sha256(refreshToken), familyId, expiresAt, client.ip, client.userAgent?.slice(0, 300) ?? null],
  );
  const sessionId = rows[0].id as number;
  return { sessionId, refreshToken, expiresAt, accessToken: signAccessToken(userId, sessionId) };
}

/** Whether the 2FA policy applies to an account with these permissions. */
export async function mfaRequiredFor(permissions: Iterable<string>) {
  const settings = await getSettings();
  if (!settings.system.requireAdminMfa) return false;
  const set = new Set(permissions);
  return PRIVILEGED_PERMISSIONS.some((p) => set.has(p));
}

/** A precomputed hash so unknown emails take as long as wrong passwords (no user enumeration by timing). */
const DUMMY_HASH = bcrypt.hashSync('dawa-timing-equaliser', BCRYPT_ROUNDS);

export type LoginResult = (IssuedSession & { refreshToken: string; mfaRequired?: false }) | { mfaRequired: true; mfaToken: string };

export async function login(email: string, password: string, client: ClientInfo): Promise<LoginResult> {
  const { rows } = await pool.query(
    `SELECT id, email, password_hash, status, failed_login_count, locked_until, mfa_enabled_at, access_expires_on::text AS access_expires_on
       FROM users WHERE lower(email) = lower($1)`,
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
  if (await accessExpired(user.access_expires_on)) {
    await logActivity(pool, user.id, email, 'access_expired', client, `access ended ${user.access_expires_on}`);
    throw new AppError(403, 'ACCESS_EXPIRED', 'Your access to this system has ended. Contact your manager.');
  }
  if (user.mfa_enabled_at) {
    // Password is right; the session is only issued after the second factor.
    await pool.query(`UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = $1`, [user.id]);
    const mfaToken = randomToken(32);
    await pool.query(
      `INSERT INTO mfa_challenges (user_id, token_hash, expires_at) VALUES ($1, $2, now() + make_interval(mins => $3))`,
      [user.id, sha256(mfaToken), MFA_CHALLENGE_MINUTES],
    );
    return { mfaRequired: true, mfaToken };
  }
  return startSession(user.id, user.email, client);
}

async function accessExpired(lastDay: string | null) {
  if (!lastDay) return false;
  const settings = await getSettings();
  return lastDay < todayIn(settings.general.timezone);
}

function startSession(userId: number, email: string, client: ClientInfo, detail?: string) {
  return withTransaction(async (tx) => {
    await tx.query(`UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = now() WHERE id = $1`, [userId]);
    const session = await issueSession(tx, userId, client);
    await logActivity(tx, userId, email, 'login', client, detail);
    const authUser = await loadAuthUser(userId, tx);
    return { accessToken: session.accessToken, refreshToken: session.refreshToken, expiresAt: session.expiresAt, user: authUser };
  });
}

// ---------------------------------------------------------------------------
// Two-factor authentication (TOTP, RFC 6238, via otplib)
// ---------------------------------------------------------------------------
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const normaliseRecovery = (code: string) => code.replace(/[\s-]/g, '').toUpperCase();

function newRecoveryCodes() {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const bytes = randomBytes(10);
    const chars = [...bytes].map((b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]).join('');
    return `${chars.slice(0, 5)}-${chars.slice(5)}`;
  });
}

/**
 * Checks a TOTP code and returns its time step, refusing a code (or an older
 * one) that was already used, so an intercepted code cannot be replayed.
 */
function checkTotp(secret: string, code: string, lastStep: number | null): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const delta = authenticator.checkDelta(code, secret);
  if (delta === null) return null;
  const step = Math.floor(Date.now() / 1000 / 30) + delta;
  if (lastStep !== null && step <= lastStep) return null;
  return step;
}

interface MfaUserRow { id: number; email: string; mfa_secret_enc: string | null; mfa_last_step: string | null; mfa_recovery_hashes: string[] }

/** Verifies a TOTP or recovery code for a user (inside a transaction holding the user row). Returns how it matched. */
async function verifySecondFactor(tx: Db, user: MfaUserRow, code: string): Promise<'totp' | 'recovery' | null> {
  if (!user.mfa_secret_enc) return null;
  const step = checkTotp(decrypt(user.mfa_secret_enc), code, user.mfa_last_step === null ? null : Number(user.mfa_last_step));
  if (step !== null) {
    await tx.query('UPDATE users SET mfa_last_step = $2 WHERE id = $1', [user.id, step]);
    return 'totp';
  }
  const hash = sha256(normaliseRecovery(code));
  if (user.mfa_recovery_hashes.includes(hash)) {
    await tx.query('UPDATE users SET mfa_recovery_hashes = array_remove(mfa_recovery_hashes, $2) WHERE id = $1', [user.id, hash]);
    return 'recovery';
  }
  return null;
}

/** Second step of sign-in: the challenge token from login() plus a code. */
export async function completeMfaLogin(mfaToken: string, code: string, client: ClientInfo) {
  const invalid = new AppError(401, 'MFA_INVALID', 'That code is not right. Check your authenticator app and try again.');
  const expired = new AppError(401, 'MFA_EXPIRED', 'This sign-in has expired. Enter your email and password again.');
  const outcome = await withTransaction(async (tx) => {
    const { rows } = await tx.query(
      `SELECT c.id, c.attempts, c.used_at, c.expires_at < now() AS expired, u.id AS user_id, u.email, u.status,
              u.mfa_secret_enc, u.mfa_last_step, u.mfa_recovery_hashes, u.access_expires_on::text AS access_expires_on
         FROM mfa_challenges c JOIN users u ON u.id = c.user_id WHERE c.token_hash = $1 FOR UPDATE OF c, u`,
      [sha256(mfaToken)],
    );
    const c = rows[0];
    if (!c || c.used_at || c.expired || c.attempts >= MFA_MAX_ATTEMPTS || c.status !== 'active') return { error: expired };
    const matched = await verifySecondFactor(tx, { id: c.user_id, email: c.email, mfa_secret_enc: c.mfa_secret_enc, mfa_last_step: c.mfa_last_step, mfa_recovery_hashes: c.mfa_recovery_hashes }, code);
    if (!matched) {
      await tx.query('UPDATE mfa_challenges SET attempts = attempts + 1 WHERE id = $1', [c.id]);
      await logActivity(tx, c.user_id, c.email, 'mfa_failed', client, `attempt ${c.attempts + 1} of ${MFA_MAX_ATTEMPTS}`);
      return { error: invalid };
    }
    await tx.query('UPDATE mfa_challenges SET used_at = now() WHERE id = $1', [c.id]);
    if (matched === 'recovery') await logActivity(tx, c.user_id, c.email, 'mfa_recovery_used', client);
    return { userId: c.user_id as number, email: c.email as string, matched };
  });
  // Failed attempts are committed before the error is raised.
  if ('error' in outcome) throw outcome.error;
  return startSession(outcome.userId, outcome.email, client, outcome.matched === 'recovery' ? 'with a recovery code' : 'with 2FA');
}

async function lockedUserForMfa(tx: Db, userId: number) {
  const { rows } = await tx.query(
    'SELECT id, email, password_hash, mfa_secret_enc, mfa_pending_secret_enc, mfa_last_step, mfa_recovery_hashes, mfa_enabled_at FROM users WHERE id = $1 FOR UPDATE',
    [userId],
  );
  if (!rows[0]) throw unauthorized();
  return rows[0];
}

/** Starts enrolment: a new secret (kept pending until confirmed) and its QR code. */
export async function startMfaSetup(actor: Actor) {
  const settings = await getSettings();
  return withTransaction(async (tx) => {
    const user = await lockedUserForMfa(tx, actor.userId);
    if (user.mfa_enabled_at) throw unprocessable('Two-factor authentication is already on. Turn it off first to move it to a new device.');
    const secret = authenticator.generateSecret(20);
    await tx.query('UPDATE users SET mfa_pending_secret_enc = $2 WHERE id = $1', [actor.userId, encrypt(secret)]);
    const otpauthUrl = authenticator.keyuri(user.email, settings.general.pharmacyName || 'Dawa', secret);
    return { secret, otpauthUrl, qrDataUrl: await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 220 }) };
  });
}

/** Confirms enrolment with the current password and a code; returns single-use recovery codes (shown once). */
export async function enableMfa(actor: Actor, code: string, currentPassword: string, client: ClientInfo) {
  return withTransaction(async (tx) => {
    const user = await lockedUserForMfa(tx, actor.userId);
    if (user.mfa_enabled_at) throw unprocessable('Two-factor authentication is already on.');
    if (!(await bcrypt.compare(currentPassword, user.password_hash))) throw badRequest('Current password is incorrect.', { fields: { currentPassword: 'Current password is incorrect' } });
    if (!user.mfa_pending_secret_enc) throw unprocessable('Start the set-up again.');
    const secret = decrypt(user.mfa_pending_secret_enc);
    const step = checkTotp(secret, code, null);
    if (step === null) throw badRequest('That code is not right. Check the time on your phone and try the newest code.', { fields: { code: 'Code not accepted' } });
    const codes = newRecoveryCodes();
    await tx.query(
      `UPDATE users SET mfa_secret_enc = $2, mfa_pending_secret_enc = NULL, mfa_enabled_at = now(), mfa_last_step = $3, mfa_recovery_hashes = $4 WHERE id = $1`,
      [actor.userId, encrypt(secret), step, codes.map((c) => sha256(normaliseRecovery(c)))],
    );
    await logActivity(tx, actor.userId, user.email, 'mfa_enabled', client);
    await audit(tx, actor, { action: 'mfa_enabled', module: 'auth', entityType: 'user', entityId: actor.userId, summary: `${actor.userName} turned on two-factor authentication` });
    return { recoveryCodes: codes };
  });
}

export async function disableMfa(actor: Actor, code: string, currentPassword: string, client: ClientInfo) {
  return withTransaction(async (tx) => {
    const user = await lockedUserForMfa(tx, actor.userId);
    if (!user.mfa_enabled_at) throw unprocessable('Two-factor authentication is not on.');
    if (await mfaRequiredFor(actor.permissions)) throw forbidden('Your role must use two-factor authentication. Ask another administrator to reset it if you lost your device.');
    if (!(await bcrypt.compare(currentPassword, user.password_hash))) throw badRequest('Current password is incorrect.', { fields: { currentPassword: 'Current password is incorrect' } });
    if (!(await verifySecondFactor(tx, user, code))) throw badRequest('That code is not right.', { fields: { code: 'Code not accepted' } });
    await tx.query(`UPDATE users SET mfa_secret_enc = NULL, mfa_pending_secret_enc = NULL, mfa_enabled_at = NULL, mfa_last_step = NULL, mfa_recovery_hashes = '{}' WHERE id = $1`, [actor.userId]);
    await logActivity(tx, actor.userId, user.email, 'mfa_disabled', client);
    await audit(tx, actor, { action: 'mfa_disabled', module: 'auth', entityType: 'user', entityId: actor.userId, summary: `${actor.userName} turned off two-factor authentication` });
  });
}

export async function regenerateRecoveryCodes(actor: Actor, code: string) {
  return withTransaction(async (tx) => {
    const user = await lockedUserForMfa(tx, actor.userId);
    if (!user.mfa_enabled_at) throw unprocessable('Two-factor authentication is not on.');
    if (!(await verifySecondFactor(tx, user, code))) throw badRequest('That code is not right.', { fields: { code: 'Code not accepted' } });
    const codes = newRecoveryCodes();
    await tx.query('UPDATE users SET mfa_recovery_hashes = $2 WHERE id = $1', [actor.userId, codes.map((c) => sha256(normaliseRecovery(c)))]);
    await audit(tx, actor, { action: 'mfa_recovery_codes', module: 'auth', entityType: 'user', entityId: actor.userId, summary: `${actor.userName} generated new 2FA recovery codes` });
    return { recoveryCodes: codes };
  });
}

/**
 * Another tab may present the token it read just before this one rotated it;
 * within this window that is a parallel refresh, not a stolen token.
 */
const ROTATION_GRACE_SECONDS = 30;

/**
 * Rotates a refresh token. Presenting a token that was rotated more than
 * ROTATION_GRACE_SECONDS ago means it was copied: the whole session family is
 * revoked. Within the window (two tabs refreshing at once) the caller gets an
 * access token for the family's current session and no new refresh token, so
 * the shared cookie keeps the one the first refresh set.
 */
export async function refresh(refreshToken: string, client: ClientInfo): Promise<IssuedSession> {
  const ended = () => unauthorized('Your session has ended. Please sign in again.');
  const result = await withTransaction(async (tx) => {
    const { rows } = await tx.query(
      `SELECT s.*, u.status, u.email, u.access_expires_on::text AS access_expires_on,
              (s.revoked_at > now() - make_interval(secs => $2)) AS in_grace,
              (s.created_at < now() - make_interval(mins => $3)) AS idle
         FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 FOR UPDATE OF s`,
      [sha256(refreshToken), ROTATION_GRACE_SECONDS, Math.max((await getSettings()).system.idleTimeoutMinutes, env.ACCESS_TOKEN_TTL_MINUTES + 5)],
    );
    const s = rows[0];
    if (!s) return null;
    if (s.revoked_at) {
      if (s.revoked_reason === 'rotated' && s.in_grace && s.status === 'active') {
        const head = await tx.query(
          `SELECT id FROM auth_sessions WHERE family_id = $1 AND revoked_at IS NULL AND expires_at > now() ORDER BY id DESC LIMIT 1`,
          [s.family_id],
        );
        if (head.rows[0]) {
          const user = await loadAuthUser(s.user_id, tx);
          return { accessToken: signAccessToken(s.user_id, head.rows[0].id), refreshToken: null, expiresAt: new Date(s.expires_at), user };
        }
        return null;
      }
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
    // Each refresh creates a new row, so the row's age is the time since the sign-in was last used.
    const endedFor = s.idle ? 'idle_timeout' : (await accessExpired(s.access_expires_on)) ? 'access_expired' : null;
    if (endedFor) {
      await tx.query(`UPDATE auth_sessions SET revoked_at = now(), revoked_reason = $2 WHERE family_id = $1 AND revoked_at IS NULL`, [s.family_id, endedFor]);
      await logActivity(tx, s.user_id, s.email, endedFor === 'idle_timeout' ? 'session_expired' : 'access_expired', client, endedFor === 'idle_timeout' ? 'signed out after inactivity' : undefined);
      return null;
    }
    const next = await issueSession(tx, s.user_id, client, s.family_id, new Date(s.expires_at));
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
      WHERE revoked_at IS NULL AND family_id IN (SELECT family_id FROM auth_sessions WHERE token_hash = $1 OR id = $2)
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
      `UPDATE auth_sessions SET revoked_at = now(), revoked_reason = 'password_changed'
        WHERE user_id = $1 AND revoked_at IS NULL AND family_id <> (SELECT family_id FROM auth_sessions WHERE id = $2)`,
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
