import type { NextFunction, Request, Response } from 'express';
import type { Permission } from '@dawa/shared';
import { pool } from '../db/pool';
import type { Actor } from '../lib/actor';
import { forbidden, unauthorized } from '../lib/errors';
import { verifyAccessToken } from '../lib/tokens';

export const clientIp = (req: Request) => req.ip ?? req.socket.remoteAddress ?? null;

/**
 * Verifies the bearer access token, then confirms in one query that the
 * session is still live and the user is active, and loads their permissions.
 * A logout, suspension or role change therefore takes effect immediately.
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw unauthorized();
  let claims;
  try {
    claims = verifyAccessToken(header.slice(7));
  } catch {
    throw unauthorized('Your session has expired. Please sign in again.');
  }
  const { rows } = await pool.query(
    `SELECT u.id, u.full_name, u.branch_id,
            COALESCE(array_agg(DISTINCT p.code) FILTER (WHERE p.code IS NOT NULL), '{}') AS permissions
       FROM users u
       -- The token's session may since have been rotated (another tab refreshed);
       -- it stays valid while its sign-in (session family) is still live.
       JOIN auth_sessions s ON s.id = $2 AND s.user_id = u.id AND (s.revoked_at IS NULL OR s.revoked_reason = 'rotated')
       JOIN auth_sessions live ON live.family_id = s.family_id AND live.revoked_at IS NULL AND live.expires_at > now()
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN role_permissions rp ON rp.role_id = ur.role_id
       LEFT JOIN permissions p ON p.id = rp.permission_id
      WHERE u.id = $1 AND u.status = 'active'
      GROUP BY u.id`,
    [Number(claims.sub), claims.sid],
  );
  const row = rows[0];
  if (!row) throw unauthorized('Your session has ended. Please sign in again.');
  const actor: Actor = {
    userId: row.id,
    userName: row.full_name,
    branchId: row.branch_id,
    permissions: new Set<string>(row.permissions),
    ip: clientIp(req),
    userAgent: req.headers['user-agent'] ?? null,
  };
  req.actor = actor;
  req.sessionId = claims.sid;
  next();
}

/** Allows the request when the user holds at least one of the permissions. */
export function requirePermission(...permissions: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const actor = req.actor;
    if (!actor) throw unauthorized();
    if (!permissions.some((p) => actor.permissions.has(p))) throw forbidden();
    next();
  };
}

/** Narrow helper for handlers: the authenticate middleware guarantees an actor. */
export function actorOf(req: Request): Actor {
  if (!req.actor) throw unauthorized();
  return req.actor;
}

/**
 * Cookie-authenticated endpoints (refresh, logout) require a custom header.
 * Browsers cannot attach it to cross-site form posts, which blocks CSRF
 * in addition to the SameSite=Strict cookie.
 */
export function requireClientHeader(req: Request, _res: Response, next: NextFunction) {
  if (req.headers['x-dawa-client'] !== 'web') throw forbidden('Request rejected.');
  next();
}
