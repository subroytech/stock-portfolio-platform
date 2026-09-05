import { Request, Response, NextFunction } from 'express';
import * as supportTicketService from '../services/supportTicket.service';
import type { TicketStatus } from '../services/supportTicket.service';

// This route sits behind requireAuth (see app.ts), so req.user is always populated by the time
// this handler runs.
function getUserId(req: Request): string {
  if (!req.user) throw new Error('getUserId called on an unauthenticated request — is this route missing requireAuth?');
  return req.user.id;
}

const VALID_STATUSES: TicketStatus[] = ['new', 'open', 'on_hold', 'closed'];
const ADMIN_REPLY_STATUSES: TicketStatus[] = ['open', 'on_hold', 'closed'];

// POST /support/tickets - requireAuth only, deliberately reachable by a status: 'pending'
// session (requireAuth never checks account status, only ProtectedRoute.tsx does, and that's
// a frontend-only gate this route doesn't go through) - a pending account has no other way to
// reach an admin at all.
export async function createTicket(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { subject, body } = req.body || {};
  if (typeof subject !== 'string' || !subject.trim()) {
    res.status(400).json({ error: 'A subject is required.' });
    return;
  }
  if (typeof body !== 'string' || !body.trim()) {
    res.status(400).json({ error: 'A message is required.' });
    return;
  }
  try {
    const ticket = await supportTicketService.createTicket(getUserId(req), subject.trim(), body.trim());
    res.status(201).json({ ticket });
  } catch (err) {
    next(err);
  }
}

export async function listMyTickets(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tickets = await supportTicketService.listTicketsForUser(getUserId(req));
    res.json({ tickets });
  } catch (err) {
    next(err);
  }
}

// Ownership-checked (404, not 403, if the ticket isn't the caller's - never reveal that a
// ticket id belonging to someone else even exists). No status side effect - a user viewing
// their own ticket doesn't mean "read by admin".
export async function getMyTicket(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ticket = await supportTicketService.getTicketById(String(req.params.id));
    if (!ticket || ticket.userId !== getUserId(req)) {
      res.status(404).json({ error: 'No ticket found with that id.' });
      return;
    }
    const messages = await supportTicketService.getMessagesForTicket(ticket.id);
    res.json({ ticket, messages });
  } catch (err) {
    next(err);
  }
}

// Always reopens to 'new' - this IS the reopen mechanic (see supportTicket.service.ts).
export async function replyToMyTicket(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { body } = req.body || {};
  if (typeof body !== 'string' || !body.trim()) {
    res.status(400).json({ error: 'A message is required.' });
    return;
  }
  try {
    const userId = getUserId(req);
    const ticket = await supportTicketService.getTicketById(String(req.params.id));
    if (!ticket || ticket.userId !== userId) {
      res.status(404).json({ error: 'No ticket found with that id.' });
      return;
    }
    const message = await supportTicketService.addMessage(ticket.id, userId, body.trim(), { isOwner: true });
    res.status(201).json({ message });
  } catch (err) {
    next(err);
  }
}

// Everything below is gated by requirePermission('support:manage') at the route level.

export async function listAllTickets(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { status } = req.query;
  if (status != null && !VALID_STATUSES.includes(status as TicketStatus)) {
    res.status(400).json({ error: 'Invalid status filter.' });
    return;
  }
  try {
    const tickets = await supportTicketService.listAllTickets(status as TicketStatus | undefined);
    res.json({ tickets });
  } catch (err) {
    next(err);
  }
}

export async function getTicketSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const counts = await supportTicketService.getSummaryCounts();
    res.json({ counts });
  } catch (err) {
    next(err);
  }
}

// The read-receipt side effect lives here: opening a ticket as an admin flips new -> open
// before the response is returned, so the caller's own next session refresh already reflects
// the decremented count.
export async function getTicketAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ticketId = String(req.params.id);
    const existing = await supportTicketService.getTicketById(ticketId);
    if (!existing) {
      res.status(404).json({ error: 'No ticket found with that id.' });
      return;
    }
    await supportTicketService.markOpenedByAdmin(ticketId);
    const ticket = await supportTicketService.getTicketById(ticketId);
    const messages = await supportTicketService.getMessagesForTicket(ticketId);
    res.json({ ticket, messages });
  } catch (err) {
    next(err);
  }
}

export async function replyAsAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { body, status } = req.body || {};
  if (typeof body !== 'string' || !body.trim()) {
    res.status(400).json({ error: 'A message is required.' });
    return;
  }
  if (typeof status !== 'string' || !ADMIN_REPLY_STATUSES.includes(status as TicketStatus)) {
    res.status(400).json({ error: `status must be one of: ${ADMIN_REPLY_STATUSES.join(', ')}` });
    return;
  }
  try {
    const ticketId = String(req.params.id);
    const existing = await supportTicketService.getTicketById(ticketId);
    if (!existing) {
      res.status(404).json({ error: 'No ticket found with that id.' });
      return;
    }
    const message = await supportTicketService.addMessage(ticketId, getUserId(req), body.trim(), {
      isOwner: false,
      nextStatus: status as TicketStatus,
    });
    res.status(201).json({ message });
  } catch (err) {
    next(err);
  }
}
