import express from 'express';
import * as portfolioAdminController from '../controllers/portfolioAdmin.controller';
import requirePermission from '../middleware/requirePermission';

// Admin - Portfolio Admin - Manage Portfolio. Mounted at /portfolio-admin in app.ts (behind requireAuth).
const router = express.Router();

router.get('/portfolios', requirePermission('portfolio_admin:manage'), portfolioAdminController.listPortfolios);
router.post('/portfolios/:id/restore', requirePermission('portfolio_admin:manage'), portfolioAdminController.restorePortfolio);
router.delete('/portfolios/:id', requirePermission('portfolio_admin:manage'), portfolioAdminController.permanentlyDeletePortfolio);

export default router;
