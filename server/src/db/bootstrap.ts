import { PERMISSION_GROUPS, SYSTEM_ROLES } from '@dawa/shared';
import { withTransaction } from './pool';

export const DEFAULT_EXPENSE_CATEGORIES = [
  'Rent', 'Electricity', 'Water', 'Transport', 'Salaries', 'Maintenance', 'Supplies', 'Marketing', 'Banking fees', 'Other',
];

/**
 * Idempotent system data: permission catalogue, built-in roles, the main
 * branch and default expense categories. Runs on every start so new
 * permissions ship with upgrades. Built-in roles get their default
 * permissions only when first created (later edits by an admin are kept);
 * Super Admin always holds every permission.
 */
export async function syncSystemData(): Promise<void> {
  await withTransaction(async (tx) => {
    for (const [module, group] of Object.entries(PERMISSION_GROUPS)) {
      for (const [code, description] of Object.entries(group.permissions)) {
        await tx.query(
          `INSERT INTO permissions (code, module, description) VALUES ($1,$2,$3)
           ON CONFLICT (code) DO UPDATE SET module = EXCLUDED.module, description = EXCLUDED.description`,
          [code, module, description],
        );
      }
    }
    for (const [code, role] of Object.entries(SYSTEM_ROLES)) {
      const { rows } = await tx.query(
        `INSERT INTO roles (code, name, description, is_system) VALUES ($1,$2,$3,TRUE)
         ON CONFLICT (code) DO NOTHING RETURNING id`,
        [code, role.name, role.description],
      );
      if (rows[0] || code === 'super_admin') {
        const roleId = rows[0]?.id ?? (await tx.query('SELECT id FROM roles WHERE code = $1', [code])).rows[0].id;
        await tx.query(
          `INSERT INTO role_permissions (role_id, permission_id)
           SELECT $1, id FROM permissions WHERE code = ANY($2::text[]) ON CONFLICT DO NOTHING`,
          [roleId, role.permissions],
        );
      }
    }
    await tx.query(`INSERT INTO branches (code, name) VALUES ('MAIN', 'Main branch') ON CONFLICT (code) DO NOTHING`);
    for (const name of DEFAULT_EXPENSE_CATEGORIES) {
      await tx.query(
        `INSERT INTO expense_categories (name, is_system) SELECT $1::varchar, TRUE WHERE NOT EXISTS (SELECT 1 FROM expense_categories WHERE lower(name) = lower($1::varchar))`,
        [name],
      );
    }
  });
}
