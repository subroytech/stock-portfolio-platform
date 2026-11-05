import express from 'express';
import * as portfolioTemplateController from '../controllers/portfolioTemplate.controller';
import requirePermission from '../middleware/requirePermission';

const router = express.Router();

// Viewing/creating templates is part of using Flex itself - gated the same as running a Flex
// upload, not a separate permission. requireAuth (mounted in app.ts) has already run.
router.get('/', requirePermission('portfolio_upload:flex'), portfolioTemplateController.listApproved);
router.get('/mine/pending', requirePermission('portfolio_upload:flex'), portfolioTemplateController.listMyPending);
router.post('/', requirePermission('portfolio_upload:flex'), portfolioTemplateController.create);

// Admin Console approval function - the entire approval mechanism (CLAUDE.md's "Portfolio
// Upload - Flex" section). Both /admin/all and /:id must be registered after /mine/pending
// (and /admin/all before /:id) so neither static segment is ever captured as an :id.
router.get('/admin/all', requirePermission('portfolio_template:manage_status'), portfolioTemplateController.listAll);

// Unattached Flex portfolios ('Flex-Err', abandoned before Save Template/Delete Portfolio) -
// the other half of this screen's template-health concern. Flat resources (no specific
// template id involved), so - same ordering rule as /admin/all above - must be registered
// before /:id or "unattached-portfolios" would be captured as an :id.
router.get('/unattached-portfolios', requirePermission('portfolio_template:manage_status'), portfolioTemplateController.listUnattached);
router.delete('/unattached-portfolios/:portfolioId', requirePermission('portfolio_template:manage_status'), portfolioTemplateController.removeUnattached);

router.get('/:id', requirePermission('portfolio_template:manage_status'), portfolioTemplateController.getDetail);
router.put('/:id/status', requirePermission('portfolio_template:manage_status'), portfolioTemplateController.setStatus);
router.delete('/:id', requirePermission('portfolio_template:manage_status'), portfolioTemplateController.remove);

// The "bound portfolios" pop-up - shown when the Delete above 409s because the template is
// still in use. Same permission - viewing/deleting a bound portfolio here is part of the same
// admin action as deleting the template itself, not a separate capability.
router.get('/:id/bound-portfolios', requirePermission('portfolio_template:manage_status'), portfolioTemplateController.listBound);
router.delete('/:id/bound-portfolios/:portfolioId', requirePermission('portfolio_template:manage_status'), portfolioTemplateController.removeBound);

export default router;
