import express from 'express';
import * as contrarianFinderController from '../controllers/contrarianFinder.controller';
import requirePermission from '../middleware/requirePermission';

const router = express.Router();

// Read-only reference data, visible to any signed-in user (requireAuth,
// mounted in app.ts, has already run by this point) - not gated behind
// contrarian_finder:scan since viewing the universe isn't the FMP-call-heavy
// action that permission protects.
router.get('/universe', contrarianFinderController.getUniverse);

// Admin-only (Architecture.md Section 3 item 6) - scanning the whole universe
// is the most FMP-call-heavy action in the app; requireAuth (mounted in
// app.ts) has already run by this point.
router.post('/scan-batch', requirePermission('contrarian_finder:scan'), contrarianFinderController.scanBatch);

// Admin Console "Master Data" Delta Update - same permission as scan-batch
// (defense in depth; the Admin Console route is the primary gate on
// reachability, since only Admin/Admin-Master pass its own access check too).
router.post('/ticker-data-refresh-batch', requirePermission('contrarian_finder:scan'), contrarianFinderController.tickerDataRefreshBatch);

export default router;
