import { PERMISSION_GROUPS, PERMISSION_LABELS } from '@dawa/shared';
import { pool, withTransaction } from '../../db/pool';
import type { Actor } from '../../lib/actor';
import { audit } from '../../lib/audit';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../lib/errors';
import { likeParam, pageParams, paginated } from '../../lib/pagination';
import { hashPassword } from '../auth/service';

interface UserInput {
  branchId: number | null;
  fullName: string;
  email: string;
  phone: string | null;
  jobTitle: string | null;
  roleIds: number[];
  accessExpiresOn: string | null;
}

async function assertRolesExist(roleIds: number[]) {
  const { rows } = await pool.query(
    `SELECT r.id, r.code, COALESCE(array_agg(p.code) FILTER (WHERE p.code IS NOT NULL), '{}') AS permissions
       FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id LEFT JOIN permissions p ON p.id = rp.permission_id
      WHERE r.id = ANY($1::int[]) GROUP BY r.id`,
    [roleIds],
  );
  if (rows.length !== new Set(roleIds).size) throw badRequest('One of the selected roles does not exist.');
  return rows as { id: number; code: string; permissions: string[] }[];
}

/** Permissions a user currently holds through their roles. */
async function permissionsOf(userId: number): Promise<string[]> {
  const { rows } = await pool.query(
    `SELECT DISTINCT p.code FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id
      WHERE ur.user_id = $1`,
    [userId],
  );
  return rows.map((r) => r.code);
}

/**
 * No escalation: without roles.manage, staff can only manage accounts whose
 * access is within their own (a manager cannot reset a Super Admin's
 * password and sign in as them).
 */
async function assertCanManage(actor: Actor, userId: number) {
  if (actor.permissions.has('roles.manage') || userId === actor.userId) return;
  const extra = (await permissionsOf(userId)).filter((p) => !actor.permissions.has(p));
  if (extra.length) throw forbidden('This account has access you do not have. Ask a Super Admin to manage it.');
}

async function activeBranch(tx: import('pg').PoolClient, branchId: number): Promise<number> {
  const { rows } = await tx.query('SELECT is_active FROM branches WHERE id = $1', [branchId]);
  if (!rows[0]) throw badRequest('Branch not found.');
  if (!rows[0].is_active) throw unprocessable('That branch is inactive.');
  return branchId;
}

/** Only a Super Admin may grant the Super Admin role, or any role carrying permissions the granter lacks. */
async function assertCanGrant(actor: Actor, roles: { code: string; permissions: string[] }[]) {
  if (actor.permissions.has('roles.manage')) return;
  if (roles.some((r) => r.code === 'super_admin')) throw unprocessable('Only a Super Admin can assign the Super Admin role.');
  if (roles.some((r) => r.permissions.some((p) => !actor.permissions.has(p)))) {
    throw forbidden('You can only assign roles whose permissions you hold yourself.');
  }
}

export async function listUsers(q: { page: number; pageSize: number; search?: string; status?: string }) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.search) {
    params.push(likeParam(q.search));
    where.push(`(u.full_name ILIKE $${params.length} OR u.email ILIKE $${params.length} OR u.phone ILIKE $${params.length})`);
  }
  if (q.status) {
    params.push(q.status);
    where.push(`u.status = $${params.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { limit, offset } = pageParams(q.page, q.pageSize);
  const { rows } = await pool.query(
    `SELECT u.id, u.full_name, u.email, u.phone, u.job_title, u.status, u.last_login_at, u.created_at, u.branch_id,
            u.mfa_enabled_at IS NOT NULL AS mfa_enabled, u.access_expires_on::text AS access_expires_on,
            (SELECT name FROM branches WHERE id = u.branch_id) AS branch_name,
            (u.locked_until IS NOT NULL AND u.locked_until > now()) AS locked,
            COALESCE(json_agg(json_build_object('id', r.id, 'code', r.code, 'name', r.name) ORDER BY r.name) FILTER (WHERE r.id IS NOT NULL), '[]') AS roles,
            count(*) OVER() AS total_count
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
       ${whereSql}
      GROUP BY u.id
      ORDER BY u.status, u.full_name
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  return paginated(rows.map(({ total_count: _t, ...r }) => r), rows[0]?.total_count ?? 0, q.page, q.pageSize);
}

export async function getUser(id: number) {
  const { rows } = await pool.query(
    `SELECT u.id, u.full_name, u.email, u.phone, u.job_title, u.status, u.last_login_at, u.created_at, u.must_change_password,
            u.mfa_enabled_at IS NOT NULL AS mfa_enabled, u.access_expires_on::text AS access_expires_on,
            u.branch_id, (SELECT name FROM branches WHERE id = u.branch_id) AS branch_name,
            (u.locked_until IS NOT NULL AND u.locked_until > now()) AS locked,
            COALESCE(json_agg(json_build_object('id', r.id, 'code', r.code, 'name', r.name)) FILTER (WHERE r.id IS NOT NULL), '[]') AS roles
       FROM users u LEFT JOIN user_roles ur ON ur.user_id = u.id LEFT JOIN roles r ON r.id = ur.role_id
      WHERE u.id = $1 GROUP BY u.id`,
    [id],
  );
  if (!rows[0]) throw notFound('User');
  const activity = await pool.query(
    `SELECT event, ip, user_agent, detail, created_at FROM login_activity WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
    [id],
  );
  const sales = await pool.query(
    `SELECT count(*)::int AS transactions, COALESCE(sum(total), 0) AS revenue
       FROM sales WHERE cashier_id = $1 AND created_at >= date_trunc('month', now())`,
    [id],
  );
  return { ...rows[0], loginActivity: activity.rows, thisMonth: sales.rows[0] };
}

export async function createUser(actor: Actor, input: UserInput & { password: string }) {
  const roles = await assertRolesExist(input.roleIds);
  await assertCanGrant(actor, roles);
  const hash = await hashPassword(input.password);
  return withTransaction(async (tx) => {
    const dup = await tx.query('SELECT 1 FROM users WHERE lower(email) = lower($1)', [input.email]);
    if (dup.rowCount) throw conflict('A user with this email already exists.');
    const { rows } = await tx.query(
      `INSERT INTO users (branch_id, full_name, email, phone, job_title, password_hash, must_change_password, access_expires_on)
       VALUES ($1,$2,$3,$4,$5,$6, TRUE, $7) RETURNING id`,
      [await activeBranch(tx, input.branchId ?? actor.branchId), input.fullName, input.email, input.phone, input.jobTitle, hash, input.accessExpiresOn],
    );
    const id = rows[0].id as number;
    await tx.query('INSERT INTO user_roles (user_id, role_id) SELECT $1, unnest($2::int[])', [id, input.roleIds]);
    await audit(tx, actor, {
      action: 'create', module: 'users', entityType: 'user', entityId: id,
      summary: `${actor.userName} created user ${input.fullName} (${input.email})`,
      newValues: { fullName: input.fullName, email: input.email, roles: roles.map((r) => r.code), accessExpiresOn: input.accessExpiresOn },
    });
    return { id };
  });
}

export async function updateUser(actor: Actor, id: number, input: UserInput & { status: 'active' | 'suspended' }) {
  const roles = await assertRolesExist(input.roleIds);
  await assertCanGrant(actor, roles);
  await assertCanManage(actor, id);
  return withTransaction(async (tx) => {
    const before = await getUser(id);
    if (id === actor.userId && input.status === 'suspended') throw unprocessable('You cannot suspend your own account.');
    const beforeRoles = (before.roles as { code: string }[]).map((r) => r.code).sort();
    if (beforeRoles.includes('super_admin') && !roles.some((r) => r.code === 'super_admin')) {
      const others = await tx.query(
        `SELECT count(*)::int AS n FROM user_roles ur JOIN roles r ON r.id = ur.role_id JOIN users u ON u.id = ur.user_id
          WHERE r.code = 'super_admin' AND u.status = 'active' AND u.id <> $1`,
        [id],
      );
      if (others.rows[0].n === 0) throw unprocessable('At least one active Super Admin must remain.');
    }
    const dup = await tx.query('SELECT 1 FROM users WHERE lower(email) = lower($1) AND id <> $2', [input.email, id]);
    if (dup.rowCount) throw conflict('A user with this email already exists.');
    await tx.query(
      `UPDATE users SET full_name=$2, email=$3, phone=$4, job_title=$5, status=$6, branch_id=$7, access_expires_on=$8, updated_at=now() WHERE id=$1`,
      [id, input.fullName, input.email, input.phone, input.jobTitle, input.status, await activeBranch(tx, input.branchId ?? before.branch_id), input.accessExpiresOn],
    );
    await tx.query('DELETE FROM user_roles WHERE user_id = $1', [id]);
    await tx.query('INSERT INTO user_roles (user_id, role_id) SELECT $1, unnest($2::int[])', [id, input.roleIds]);
    if (input.status === 'suspended') {
      await tx.query(`UPDATE auth_sessions SET revoked_at = now(), revoked_reason = 'suspended' WHERE user_id = $1 AND revoked_at IS NULL`, [id]);
    }
    const afterRoles = roles.map((r) => r.code).sort();
    const changes: string[] = [];
    if (before.status !== input.status) changes.push(`status ${before.status} → ${input.status}`);
    if (beforeRoles.join() !== afterRoles.join()) changes.push(`roles ${beforeRoles.join(', ')} → ${afterRoles.join(', ')}`);
    if (before.full_name !== input.fullName || before.email !== input.email) changes.push('details');
    if ((before.access_expires_on ?? null) !== input.accessExpiresOn) changes.push(`access end date ${before.access_expires_on ?? 'none'} → ${input.accessExpiresOn ?? 'none'}`);
    await audit(tx, actor, {
      action: 'update', module: 'users', entityType: 'user', entityId: id,
      summary: `${actor.userName} updated user ${input.fullName}${changes.length ? `: ${changes.join('; ')}` : ''}`,
      oldValues: { status: before.status, roles: beforeRoles, email: before.email, accessExpiresOn: before.access_expires_on },
      newValues: { status: input.status, roles: afterRoles, email: input.email, accessExpiresOn: input.accessExpiresOn },
    });
    return { id };
  });
}

export async function adminResetPassword(actor: Actor, id: number, password: string) {
  await assertCanManage(actor, id);
  const user = await getUser(id);
  const hash = await hashPassword(password);
  await withTransaction(async (tx) => {
    await tx.query(
      `UPDATE users SET password_hash=$2, must_change_password=TRUE, failed_login_count=0, locked_until=NULL, password_changed_at=now() WHERE id=$1`,
      [id, hash],
    );
    await tx.query(`UPDATE auth_sessions SET revoked_at = now(), revoked_reason = 'admin_reset' WHERE user_id = $1 AND revoked_at IS NULL`, [id]);
    await audit(tx, actor, {
      action: 'password_reset', module: 'users', entityType: 'user', entityId: id,
      summary: `${actor.userName} reset the password of ${user.full_name}; they must choose a new one at next sign-in`,
    });
  });
}

export async function unlockUser(actor: Actor, id: number) {
  await assertCanManage(actor, id);
  const user = await getUser(id);
  await pool.query(`UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = $1`, [id]);
  await audit(pool, actor, { action: 'unlock', module: 'users', entityType: 'user', entityId: id, summary: `${actor.userName} unlocked ${user.full_name}` });
}

export async function listRoles() {
  const { rows } = await pool.query(
    `SELECT r.id, r.code, r.name, r.description, r.is_system,
            COALESCE(array_agg(p.code ORDER BY p.code) FILTER (WHERE p.code IS NOT NULL), '{}') AS permissions,
            (SELECT count(*)::int FROM user_roles ur JOIN users u ON u.id = ur.user_id WHERE ur.role_id = r.id AND u.status = 'active') AS user_count
       FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id LEFT JOIN permissions p ON p.id = rp.permission_id
      GROUP BY r.id ORDER BY r.is_system DESC, r.id`,
  );
  return rows;
}

export function permissionCatalogue() {
  return Object.entries(PERMISSION_GROUPS).map(([key, g]) => ({
    key,
    label: g.label,
    permissions: Object.keys(g.permissions).map((code) => ({ code, label: PERMISSION_LABELS[code] })),
  }));
}

async function setRolePermissions(tx: import('pg').PoolClient, roleId: number, permissions: string[]) {
  const unknown = permissions.filter((p) => !(p in PERMISSION_LABELS));
  if (unknown.length) throw badRequest(`Unknown permission: ${unknown.join(', ')}`);
  await tx.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);
  await tx.query(
    `INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE code = ANY($2::text[])`,
    [roleId, permissions],
  );
}

export async function createRole(actor: Actor, input: { name: string; description: string | null; permissions: string[] }) {
  return withTransaction(async (tx) => {
    const code = `custom_${input.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`.slice(0, 40);
    const dup = await tx.query('SELECT 1 FROM roles WHERE lower(name) = lower($1) OR code = $2', [input.name, code]);
    if (dup.rowCount) throw conflict('A role with this name already exists.');
    const { rows } = await tx.query(`INSERT INTO roles (code, name, description) VALUES ($1,$2,$3) RETURNING id`, [code, input.name, input.description]);
    await setRolePermissions(tx, rows[0].id, input.permissions);
    await audit(tx, actor, {
      action: 'create', module: 'roles', entityType: 'role', entityId: rows[0].id,
      summary: `${actor.userName} created role ${input.name}`, newValues: { permissions: input.permissions },
    });
    return { id: rows[0].id };
  });
}

export async function updateRole(actor: Actor, id: number, input: { name: string; description: string | null; permissions: string[] }) {
  return withTransaction(async (tx) => {
    const { rows } = await tx.query('SELECT * FROM roles WHERE id = $1 FOR UPDATE', [id]);
    const role = rows[0];
    if (!role) throw notFound('Role');
    if (role.code === 'super_admin') throw unprocessable('The Super Admin role always has every permission and cannot be edited.');
    const before = await tx.query(
      `SELECT array_agg(p.code ORDER BY p.code) AS codes FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = $1`,
      [id],
    );
    await tx.query('UPDATE roles SET name = $2, description = $3, updated_at = now() WHERE id = $1', [id, role.is_system ? role.name : input.name, input.description]);
    await setRolePermissions(tx, id, input.permissions);
    const old: string[] = before.rows[0].codes ?? [];
    const added = input.permissions.filter((p) => !old.includes(p));
    const removed = old.filter((p) => !input.permissions.includes(p));
    await audit(tx, actor, {
      action: 'update', module: 'roles', entityType: 'role', entityId: id,
      summary: `${actor.userName} changed permissions of ${role.name}${added.length ? ` (+${added.join(', +')})` : ''}${removed.length ? ` (−${removed.join(', −')})` : ''}`,
      oldValues: { permissions: old }, newValues: { permissions: input.permissions },
    });
    return { id };
  });
}

export async function deleteRole(actor: Actor, id: number) {
  return withTransaction(async (tx) => {
    const { rows } = await tx.query('SELECT * FROM roles WHERE id = $1', [id]);
    if (!rows[0]) throw notFound('Role');
    if (rows[0].is_system) throw unprocessable('Built-in roles cannot be deleted.');
    const used = await tx.query('SELECT 1 FROM user_roles WHERE role_id = $1 LIMIT 1', [id]);
    if (used.rowCount) throw unprocessable('This role is assigned to users. Reassign them first.');
    await tx.query('DELETE FROM roles WHERE id = $1', [id]);
    await audit(tx, actor, { action: 'delete', module: 'roles', entityType: 'role', entityId: id, summary: `${actor.userName} deleted role ${rows[0].name}` });
  });
}

/** Lightweight list for pickers (e.g. "employee" on an expense). */
export async function userOptions() {
  const { rows } = await pool.query(`SELECT id, full_name, job_title FROM users WHERE status = 'active' ORDER BY full_name`);
  return rows;
}

/** Clears a user's 2FA (lost phone) and signs them out everywhere; they set it up again at next sign-in. */
export async function adminResetMfa(actor: Actor, id: number) {
  if (id === actor.userId) throw unprocessable('Turn off your own two-factor authentication from My profile.');
  await assertCanManage(actor, id);
  const user = await getUser(id);
  if (!user.mfa_enabled) throw unprocessable(`${user.full_name} does not use two-factor authentication.`);
  await withTransaction(async (tx) => {
    await tx.query(
      `UPDATE users SET mfa_secret_enc = NULL, mfa_pending_secret_enc = NULL, mfa_enabled_at = NULL, mfa_last_step = NULL, mfa_recovery_hashes = '{}' WHERE id = $1`,
      [id],
    );
    await tx.query(`UPDATE auth_sessions SET revoked_at = now(), revoked_reason = 'mfa_reset' WHERE user_id = $1 AND revoked_at IS NULL`, [id]);
    await audit(tx, actor, {
      action: 'mfa_reset', module: 'users', entityType: 'user', entityId: id,
      summary: `${actor.userName} reset two-factor authentication for ${user.full_name} and signed them out`,
    });
  });
}
