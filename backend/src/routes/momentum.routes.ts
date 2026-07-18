import express from 'express';
import * as momentumController from '../controllers/momentum.controller';

const router = express.Router();

router.get('/:symbol', momentumController.analyze);

export default router;
