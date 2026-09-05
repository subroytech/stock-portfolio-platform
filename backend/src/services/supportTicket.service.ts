// Helpdesk / Support Tickets (2026-09-05) - the first in-app channel for a user to reach an
// admin at all, since this repo has no email capability. Backed by migration 037's
// users_support_tickets + users_support_ticket_messages.

import { pool } from '../db/pool';

export type TicketStatus = 'new' | 'open' | 'on_hold' | 'closed';
const ADMIN_SETTABLE_STATUSES: TicketStatus[] = ['open', 'on_hold', 'closed'];

export interface SupportTicket {
  id: string;
  userId: string;
  subject: string;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
}

export interface SupportTicketMessage {
  id: string;
  ticketId: string;
  senderUserId: string | null;
  body: string;
  createdAt: string;
}

function rowToTicket(r: { id: string; user_id: string; subject: string; status: string; created_at: string; updated_at: string }): SupportTicket {
  return { id: r.id, userId: r.user_id, subject: r.subject, status: r.status as TicketStatus, createdAt: r.created_at, updatedAt: r.updated_at };
}

function rowToMessage(r: { id: string; ticket_id: string; sender_user_id: string | null; body: string; created_at: string }): SupportTicketMessage {
  return { id: r.id, ticketId: r.ticket_id, senderUserId: r.sender_user_id, body: r.body, createdAt: r.created_at };
}

// Transactional insert of the ticket (status 'new') + its first message - the description the
// user typed is just message #1 in the thread, never duplicated onto the ticket row itself.
export async function createTicket(userId: string, subject: string, body: string): Promise<SupportTicket> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ticketRes = await client.query<{ id: string; user_id: string; subject: string; status: string; created_at: string; updated_at: string }>(
      `INSERT INTO users_support_tickets (user_id, subject, status)
       VALUES ($1, $2, 'new')
       RETURNING id, user_id, subject, status, created_at, updated_at`,
      [userId, subject],
    );
    const ticket = ticketRes.rows[0];
    await client.query(
      `INSERT INTO users_support_ticket_messages (ticket_id, sender_user_id, body) VALUES ($1, $2, $3)`,
      [ticket.id, userId, body],
    );
    await client.query('COMMIT');
    return rowToTicket(ticket);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => { /* best-effort */ });
    throw err;
  } finally {
    client.release();
  }
}

export async function listTicketsForUser(userId: string): Promise<SupportTicket[]> {
  const { rows } = await pool.query(
    `SELECT id, user_id, subject, status, created_at, updated_at
     FROM users_support_tickets WHERE user_id = $1 ORDER BY updated_at DESC`,
    [userId],
  );
  return rows.map(rowToTicket);
}

export async function listAllTickets(status?: TicketStatus): Promise<SupportTicket[]> {
  const { rows } = status
    ? await pool.query(
        `SELECT id, user_id, subject, status, created_at, updated_at
         FROM users_support_tickets WHERE status = $1 ORDER BY updated_at DESC`,
        [status],
      )
    : await pool.query(
        `SELECT id, user_id, subject, status, created_at, updated_at
         FROM users_support_tickets ORDER BY updated_at DESC`,
      );
  return rows.map(rowToTicket);
}

// Zero-filled for any status with no rows - the summary page always shows all 4 tiles, never a
// missing one just because nothing's ever been Closed yet.
export async function getSummaryCounts(): Promise<Record<TicketStatus, number>> {
  const { rows } = await pool.query<{ status: string; count: string }>(
    `SELECT status, count(*) FROM users_support_tickets GROUP BY status`,
  );
  const counts: Record<TicketStatus, number> = { new: 0, open: 0, on_hold: 0, closed: 0 };
  for (const r of rows) counts[r.status as TicketStatus] = Number(r.count);
  return counts;
}

export async function getTicketById(ticketId: string): Promise<SupportTicket | null> {
  const { rows } = await pool.query(
    `SELECT id, user_id, subject, status, created_at, updated_at FROM users_support_tickets WHERE id = $1`,
    [ticketId],
  );
  return rows[0] ? rowToTicket(rows[0]) : null;
}

export async function getMessagesForTicket(ticketId: string): Promise<SupportTicketMessage[]> {
  const { rows } = await pool.query(
    `SELECT id, ticket_id, sender_user_id, body, created_at
     FROM users_support_ticket_messages WHERE ticket_id = $1 ORDER BY created_at ASC`,
    [ticketId],
  );
  return rows.map(rowToMessage);
}

// The read-receipt side effect - opening a ticket as an admin is a deliberate, named exception
// to "GETs don't mutate" in this app, same as an email client marking a message read on open.
// No-op (WHERE status = 'new') if it wasn't 'new', so re-opening an already-open ticket never
// pointlessly bumps updated_at or re-triggers anything.
export async function markOpenedByAdmin(ticketId: string): Promise<void> {
  await pool.query(
    `UPDATE users_support_tickets SET status = 'open', updated_at = now() WHERE id = $1 AND status = 'new'`,
    [ticketId],
  );
}

// isOwner=true (the ticket's own user replying) always reopens to 'new' - this IS the reopen
// mechanic, not a separate button. isOwner=false (admin replying) sets nextStatus instead.
export async function addMessage(
  ticketId: string,
  senderUserId: string,
  body: string,
  options: { isOwner: boolean; nextStatus?: TicketStatus },
): Promise<SupportTicketMessage> {
  const nextStatus: TicketStatus = options.isOwner ? 'new' : (options.nextStatus ?? 'open');
  if (!options.isOwner && !ADMIN_SETTABLE_STATUSES.includes(nextStatus)) {
    throw new Error(`Invalid status: ${nextStatus}`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const msgRes = await client.query<{ id: string; ticket_id: string; sender_user_id: string | null; body: string; created_at: string }>(
      `INSERT INTO users_support_ticket_messages (ticket_id, sender_user_id, body)
       VALUES ($1, $2, $3)
       RETURNING id, ticket_id, sender_user_id, body, created_at`,
      [ticketId, senderUserId, body],
    );
    await client.query(
      `UPDATE users_support_tickets SET status = $2, updated_at = now() WHERE id = $1`,
      [ticketId, nextStatus],
    );
    await client.query('COMMIT');
    return rowToMessage(msgRes.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => { /* best-effort */ });
    throw err;
  } finally {
    client.release();
  }
}

// Feeds the red badge on UserPersonaBadge.tsx via resolveSession() - only ever queried for a
// session already confirmed to hold support:manage.
export async function getNewTicketCount(): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT count(*) FROM users_support_tickets WHERE status = 'new'`,
  );
  return Number(rows[0].count);
}
