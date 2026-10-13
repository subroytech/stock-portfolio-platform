import express from 'express';
import * as usersController from '../controllers/users.controller';
import requirePermission from '../middleware/requirePermission';

const router = express.Router();

router.get('/', requirePermission('users:manage_roles'), usersController.list);
router.post('/', requirePermission('users:create'), usersController.create);
router.put('/:id/role', requirePermission('users:manage_roles'), usersController.updateRole);
router.put('/:id/status', requirePermission('users:manage_roles'), usersController.updateStatus);
router.put('/:id', requirePermission('users:manage_roles'), usersController.updateUser);

export default router;
