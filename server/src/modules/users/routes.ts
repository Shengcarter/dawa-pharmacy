import { Router } from 'express';
import { z } from 'zod';
import { adminResetPasswordSchema, paginationQuery, roleSchema, userCreateSchema, userUpdateSchema } from '@dawa/shared';
import { actorOf, requirePermission } from '../../middleware/auth';
import * as users from './service';

const idParam = (v: unknown) => z.coerce.number().int().positive().parse(v);

export const usersRouter = Router();

usersRouter.get('/options', async (_req, res) => {
  res.json(await users.userOptions());
});

usersRouter.get('/', requirePermission('users.view'), async (req, res) => {
  const q = paginationQuery.extend({ status: z.enum(['active', 'suspended']).optional() }).parse(req.query);
  res.json(await users.listUsers(q));
});

usersRouter.get('/:id', requirePermission('users.view'), async (req, res) => {
  res.json(await users.getUser(idParam(req.params.id)));
});

usersRouter.post('/', requirePermission('users.manage'), async (req, res) => {
  res.status(201).json(await users.createUser(actorOf(req), userCreateSchema.parse(req.body)));
});

usersRouter.put('/:id', requirePermission('users.manage'), async (req, res) => {
  res.json(await users.updateUser(actorOf(req), idParam(req.params.id), userUpdateSchema.parse(req.body)));
});

usersRouter.post('/:id/reset-password', requirePermission('users.manage'), async (req, res) => {
  await users.adminResetPassword(actorOf(req), idParam(req.params.id), adminResetPasswordSchema.parse(req.body).password);
  res.json({ message: 'Password reset. The user must choose a new password at next sign-in.' });
});

usersRouter.post('/:id/unlock', requirePermission('users.manage'), async (req, res) => {
  await users.unlockUser(actorOf(req), idParam(req.params.id));
  res.json({ message: 'Account unlocked.' });
});

export const rolesRouter = Router();

rolesRouter.get('/', requirePermission('users.view', 'roles.manage'), async (_req, res) => {
  res.json({ roles: await users.listRoles(), catalogue: users.permissionCatalogue() });
});

rolesRouter.post('/', requirePermission('roles.manage'), async (req, res) => {
  res.status(201).json(await users.createRole(actorOf(req), roleSchema.parse(req.body)));
});

rolesRouter.put('/:id', requirePermission('roles.manage'), async (req, res) => {
  res.json(await users.updateRole(actorOf(req), idParam(req.params.id), roleSchema.parse(req.body)));
});

rolesRouter.delete('/:id', requirePermission('roles.manage'), async (req, res) => {
  await users.deleteRole(actorOf(req), idParam(req.params.id));
  res.status(204).end();
});
