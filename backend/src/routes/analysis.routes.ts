import express from 'express';
import * as analysisController from '../controllers/analysis.controller';

const router = express.Router();

router.get('/health', analysisController.health);
router.get('/long-term/:symbol', analysisController.longTermAnalysis);

export default router;
