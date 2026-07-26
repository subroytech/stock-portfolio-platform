import express from 'express';
import * as analysisController from '../controllers/analysis.controller';

const router = express.Router();

router.get('/health', analysisController.health);

export default router;
