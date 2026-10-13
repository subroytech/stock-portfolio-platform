import express from 'express';
import * as rateLimitController from '../controllers/rateLimit.controller';

const router = express.Router();

router.get('/status', rateLimitController.status);

export default router;
