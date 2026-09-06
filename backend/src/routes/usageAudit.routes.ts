import express from 'express';
import * as usageAuditController from '../controllers/usageAudit.controller';
import requirePermission from '../middleware/requirePermission';

const router = express.Router();

// User Usage Dashboard - gated Function, zero default grants (migration 040).
router.get('/last-3-days', requirePermission('usage_audit:view'), usageAuditController.getLast3Days);
router.get('/monthly', requirePermission('usage_audit:view'), usageAuditController.getMonthly);
router.get('/available-months', requirePermission('usage_audit:view'), usageAuditController.getAvailableMonths);

export default router;
