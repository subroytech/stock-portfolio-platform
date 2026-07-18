import express from 'express';
import * as stockPreviewController from '../controllers/stockPreview.controller';

const router = express.Router();

router.get('/:symbol', stockPreviewController.preview);

export default router;
