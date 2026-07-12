import express from 'express';
import * as quotesController from '../controllers/quotes.controller';

const router = express.Router();

router.get('/', quotesController.getQuotes);

export default router;
