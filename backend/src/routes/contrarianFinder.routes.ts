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

// Persists the last completed scan so every user shares one result, not just
// whichever browser ran it (2026-08-04) - only someone who could run a scan
// should be able to claim to have completed one.
router.post('/last-scan', requirePermission('contrarian_finder:scan'), contrarianFinderController.saveLastScan);

// Read-only, visible to any signed-in user - same "viewing isn't the action
// the permission protects" reasoning as /universe above. Regular users who
// can't run a scan themselves are exactly who this is for.
router.get('/last-scan', contrarianFinderController.getLastScan);

// Run History (2026-08-31) - unlike /last-scan above, this IS gated: an
// Admin/Admin-Master must explicitly grant contrarian_finder:view_history to
// a role before "View archived runs" becomes available to it (the user's
// own explicit requirement, not "viewing isn't the action" reasoning).
router.get('/run-history', requirePermission('contrarian_finder:view_history'), contrarianFinderController.listRunHistory);
router.get('/run-history/:id', requirePermission('contrarian_finder:view_history'), contrarianFinderController.getRunHistoryDetail);

export default router;
