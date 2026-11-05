import express from 'express';
import * as portfolioController from '../controllers/portfolio.controller';
import requirePermission from '../middleware/requirePermission';

const router = express.Router();

router.get('/', portfolioController.list);
router.post('/', portfolioController.create);

// Portfolio Upload - Flex (CLAUDE.md's "Portfolio Upload - Flex" section) - registered before
// /:id so "flex" is never captured as an :id.
router.post('/flex', requirePermission('portfolio_upload:flex'), portfolioController.createFlex);

router.get('/:id', portfolioController.getOne);
router.put('/:id', portfolioController.update);
router.delete('/:id', portfolioController.remove);
// Portfolio Upload - Legacy - was ungated until this permission existed (migration 024);
// granted to 'user' by default so nobody loses today's working import on rollout.
router.post('/:id/import', requirePermission('portfolio_upload:legacy'), portfolioController.importHoldings);
router.post('/:id/flex-template', requirePermission('portfolio_upload:flex'), portfolioController.saveFlexTemplate);
router.put('/:id/flex-template', requirePermission('portfolio_upload:flex'), portfolioController.changeFlexTemplate);
router.post('/:id/refresh-prices', portfolioController.refreshPrices);

export default router;
