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
router.get('/:id', requirePermission('portfolio_template:manage_status'), portfolioTemplateController.getDetail);
router.put('/:id/status', requirePermission('portfolio_template:manage_status'), portfolioTemplateController.setStatus);

export default router;
