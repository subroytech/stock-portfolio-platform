import express from 'express';
import * as controller from '../controllers/candlestickQuestionAnswer.controller';
import requirePermission from '../middleware/requirePermission';

const router = express.Router();

// Viewing/browsing/asking is the feature itself - one permission gates all of it, same
// "using it is the permission" precedent as portfolio_upload:flex gating both viewing and
// creating templates.
router.get('/entries', requirePermission('candlestick_question_answer:ask'), controller.searchEntries);
router.post('/ask', requirePermission('candlestick_question_answer:ask'), controller.askQuestion);

// Popular Questions (Phase 2, 2026-10-05) - a read, same "viewing is free" gate as /entries above.
router.get('/top-questions', requirePermission('candlestick_question_answer:ask'), controller.listTopQuestions);

// Admin content management - registered before /entries/:id/status style routes below aren't
// actually ambiguous here (different static prefixes), but kept grouped and ordered the same
// way portfolioTemplate.routes.ts orders its own admin routes, for consistency.
router.get('/patterns', requirePermission('candlestick_question_answer:manage_content'), controller.listPatterns);
router.post('/patterns', requirePermission('candlestick_question_answer:manage_content'), controller.createPattern);
router.get('/admin/entries', requirePermission('candlestick_question_answer:manage_content'), controller.listAllEntries);
router.post('/entries', requirePermission('candlestick_question_answer:manage_content'), controller.createEntry);
router.put('/entries/:id/status', requirePermission('candlestick_question_answer:manage_content'), controller.setEntryStatus);

// Question Templates admin management (Phase 2, 2026-10-05).
router.get('/templates', requirePermission('candlestick_question_answer:manage_content'), controller.listTemplates);
router.post('/templates', requirePermission('candlestick_question_answer:manage_content'), controller.createTemplate);
router.put('/templates/:id/status', requirePermission('candlestick_question_answer:manage_content'), controller.setTemplateStatus);

export default router;
