import express from 'express';
import * as portfolioController from '../controllers/portfolio.controller';

const router = express.Router();

router.get('/', portfolioController.list);
router.post('/', portfolioController.create);
router.get('/:id', portfolioController.getOne);
router.put('/:id', portfolioController.update);
router.delete('/:id', portfolioController.remove);
router.post('/:id/import', portfolioController.importHoldings);
router.post('/:id/refresh-prices', portfolioController.refreshPrices);

export default router;
