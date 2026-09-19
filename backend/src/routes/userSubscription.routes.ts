import express from 'express';
import * as userSubscriptionController from '../controllers/userSubscription.controller';
import requirePermission from '../middleware/requirePermission';

const router = express.Router();

// Admin Console Phase 8 - api_keys:manage_own (migration 018) gates a user's own API-key
// management, admin-only by default. Previously ungated (any signed-in user could reach
// these), the deliberate original bring-your-own-key design - now a real, per-role
// permission an admin can grant/revoke.
router.get('/', requirePermission('api_keys:manage_own'), userSubscriptionController.list);
router.put('/:provider', requirePermission('api_keys:manage_own'), userSubscriptionController.upsert);
router.delete('/:provider', requirePermission('api_keys:manage_own'), userSubscriptionController.remove);

export default router;
