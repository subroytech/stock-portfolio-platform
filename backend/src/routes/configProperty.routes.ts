import express from 'express';
import * as configPropertyController from '../controllers/configProperty.controller';
import requirePermission from '../middleware/requirePermission';

const router = express.Router();

// Every route here (reads and writes) is gated by config_properties:manage - unlike
// functionMaster.routes.ts, which splits read/write gating because non-admin-master admins
// also consume its read side, admin-master is the only consumer of any of this, so one
// permission covers everything. See roles.service.ts's ADMIN_MASTER_ONLY_PERMISSIONS guard,
// which hardcodes that this permission key can only ever be granted to the admin-master role.
router.get('/groups', requirePermission('config_properties:manage'), configPropertyController.listGroups);
router.post('/groups', requirePermission('config_properties:manage'), configPropertyController.createGroup);
router.put('/groups/:id', requirePermission('config_properties:manage'), configPropertyController.updateGroup);

router.get('/properties', requirePermission('config_properties:manage'), configPropertyController.listProperties);
router.post('/properties', requirePermission('config_properties:manage'), configPropertyController.createProperty);
router.put('/properties/:id', requirePermission('config_properties:manage'), configPropertyController.updateProperty);
router.put('/properties/:id/value', requirePermission('config_properties:manage'), configPropertyController.setValue);
router.get('/properties/:id/history', requirePermission('config_properties:manage'), configPropertyController.listValueHistory);

export default router;
