import express from 'express';
import * as functionMasterController from '../controllers/functionMaster.controller';
import requirePermission from '../middleware/requirePermission';

const router = express.Router();

// GET gated by permissions:manage - it's the permission picker's primary consumer (see
// Admin Console plan's "read-route pragmatic-coupling design"); functions:manage owns writes.
router.get('/', requirePermission('permissions:manage'), functionMasterController.list);
router.post('/', requirePermission('functions:manage'), functionMasterController.create);
router.put('/:id', requirePermission('functions:manage'), functionMasterController.updateStatus);

export default router;
