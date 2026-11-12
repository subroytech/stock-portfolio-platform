import express from 'express';
import * as supportTicketController from '../controllers/supportTicket.controller';
import requirePermission from '../middleware/requirePermission';

const router = express.Router();

// Any authenticated session, including status: 'pending' - requireAuth (mounted in app.ts)
// has already run by this point, and never checks account status. This is deliberately the
// one channel a pending account has to reach an admin at all.
router.post('/tickets', supportTicketController.createTicket);
router.get('/tickets/mine', supportTicketController.listMyTickets);
router.get('/tickets/mine/:id', supportTicketController.getMyTicket);
router.post('/tickets/mine/:id/messages', supportTicketController.replyToMyTicket);

// Admin-only, gated by support:manage (migration 037, zero default grants).
router.get('/tickets/summary', requirePermission('support:manage'), supportTicketController.getTicketSummary);
router.get('/tickets', requirePermission('support:manage'), supportTicketController.listAllTickets);
router.get('/tickets/:id', requirePermission('support:manage'), supportTicketController.getTicketAdmin);
router.post('/tickets/:id/messages', requirePermission('support:manage'), supportTicketController.replyAsAdmin);

export default router;
