-- Helpdesk / Support Tickets, 2026-09-05. No email exists anywhere in this app - this is the
-- first in-app channel for a user to reach an admin at all, and the only one reachable while
-- a self-registered account is still status: 'pending' (see PendingReviewPage.tsx).
--
-- Unprefixed bucket - child data of the account itself, same reasoning as
-- users_roles/users_security_answers (SCHEMA.md's naming-convention section).
CREATE TABLE users_support_tickets (
  id INT8 PRIMARY KEY DEFAULT unique_rowid(),
  user_id INT8 NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject VARCHAR(150) NOT NULL,
  -- 'new' | 'open' | 'on_hold' | 'closed', app-enforced vocabulary, no DB check constraint -
  -- same convention as users.status/tx_portfolios.flex_template_status. 'new' doubles as the
  -- "unread by admin" flag: the status on creation, and whatever a ticket flips back to the
  -- instant its owner sends a fresh message regardless of prior status - the reopen mechanic.
  status VARCHAR(20) NOT NULL DEFAULT 'new',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Bumped by application code on every new message or status change - no DB trigger, this
  -- schema never uses them.
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_support_tickets_user_id ON users_support_tickets(user_id);
-- Serves three things at once: the admin's per-status filtered list, its newest-activity-first
-- sort, and the summary page's per-status counts.
CREATE INDEX idx_support_tickets_status_updated ON users_support_tickets(status, updated_at DESC);

-- Deliberately no `description` column on the ticket above - the description is just message
-- #1 in this thread, avoiding storing it twice. Deliberately no `is_admin_reply` column either
-- - derived for free by the app as `sender_user_id !== ticket.user_id`, which is also immune
-- to a sender's role changing later (a stored flag or a live role-lookup both have that edge
-- case; this doesn't).
CREATE TABLE users_support_ticket_messages (
  id INT8 PRIMARY KEY DEFAULT unique_rowid(),
  ticket_id INT8 NOT NULL REFERENCES users_support_tickets(id) ON DELETE CASCADE,
  -- SET NULL, not CASCADE: an admin's own account being deleted later shouldn't erase their
  -- reply from someone else's ticket history. The ticket itself only disappears via the
  -- owner's own cascade above.
  sender_user_id INT8 REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_support_ticket_messages_ticket_id ON users_support_ticket_messages(ticket_id, created_at);

-- Gated Function, zero default grants - same precedent as contrarian_finder:view_history
-- (migration 036). NOT added to roles.service.ts's ADMIN_MASTER_ONLY_PERMISSIONS - any role
-- holding permissions:manage (admin or admin-master) can grant this to any role.
INSERT INTO m_function_master (permission_key, name, description, status) VALUES
  ('support:manage', 'Manage Support Tickets',
   'View and respond to every user''s support tickets, and change their status.', 'active');
