import express from 'express';
import * as flexQuotaController from '../controllers/flexQuota.controller';

const router = express.Router();

// "My own" status - requireAuth only, no special permission, same boundary as e.g.
// GET /subscriptions (a user's own account data, not an admin action).
router.get('/status', flexQuotaController.getMyQuotaStatus);

export default router;
