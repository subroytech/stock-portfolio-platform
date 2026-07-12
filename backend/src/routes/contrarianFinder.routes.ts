import express from 'express';
import * as contrarianFinderController from '../controllers/contrarianFinder.controller';

const router = express.Router();

router.post('/scan', contrarianFinderController.scan);

export default router;
