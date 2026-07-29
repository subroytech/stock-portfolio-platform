import express from 'express';
import * as analysisController from '../controllers/analysis.controller';

const router = express.Router();

router.get('/health', analysisController.health);
router.get('/long-term/:symbol', analysisController.longTermAnalysis);
router.get('/contrarian-comeback/:symbol/gate', analysisController.contrarianComebackGate);
router.post('/contrarian-comeback/:symbol', analysisController.contrarianComebackSubmit);

export default router;
