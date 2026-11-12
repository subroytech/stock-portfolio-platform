import express from 'express';
import * as candlestickController from '../controllers/candlestick.controller';

const router = express.Router();

router.get('/cached-symbols', candlestickController.getCachedSymbols);
router.get('/:symbol/:interval', candlestickController.getSnapshot);
router.post('/:symbol/:interval/refresh', candlestickController.refresh);

export default router;
