import express from 'express';
import * as rolesController from '../controllers/roles.controller';
import requirePermission from '../middleware/requirePermission';

const router = express.Router();

router.get('/', requirePermission('roles:manage'), rolesController.list);
router.post('/', requirePermission('roles:manage'), rolesController.create);
router.delete('/:id', requirePermission('roles:manage'), rolesController.remove);

router.get('/:id/permissions', requirePermission('permissions:manage'), rolesController.listPermissions);
router.post('/:id/permissions', requirePermission('permissions:manage'), rolesController.grantPermission);
router.delete('/:id/permissions/:key', requirePermission('permissions:manage'), rolesController.revokePermission);

export default router;
