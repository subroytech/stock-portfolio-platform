import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';

// Helpdesk / Support Tickets (2026-09-05) - the first in-app channel for a user to reach an
// admin at all, since this repo has no email capability.

export type TicketStatus = 'new' | 'open' | 'on_hold' | 'closed';

export interface SupportTicket {
  id: string;
  userId: string;
  subject: string;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
  // Who this ticket is from (admin's list/detail views) and whether the owner has seen the
  // latest message yet (drives SupportWidget's own unread badge/dot) - both populated by every
  // list/detail endpoint below.
  userEmail?: string;
  unreadByUser?: boolean;
}

export interface SupportTicketMessage {
  id: string;
  ticketId: string;
  senderUserId: string | null;
  body: string;
  createdAt: string;
}

// ---- User side: any authenticated session, including status: 'pending'. ----

export function useMyTickets() {
  return useQuery({
    queryKey: ['supportTickets', 'mine'],
    queryFn: () => apiFetch<{ tickets: SupportTicket[] }>('/support/tickets/mine'),
  });
}

export function useCreateTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { subject: string; body: string }) =>
      apiFetch<{ ticket: SupportTicket }>('/support/tickets', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['supportTickets', 'mine'] }),
  });
}

// enabled: only fetched once a ticket is actually selected - opening it is what triggers the
// server-side markOpenedByUser read-receipt, so this also invalidates the ticket list (the
// SupportWidget trigger button's unread badge count is derived from it), mirroring
// useAdminTicketDetail's own invalidation below.
export function useMyTicketDetail(ticketId: string | null) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ['supportTickets', 'mine', ticketId],
    queryFn: async () => {
      const result = await apiFetch<{ ticket: SupportTicket; messages: SupportTicketMessage[] }>(`/support/tickets/mine/${ticketId}`);
      queryClient.invalidateQueries({ queryKey: ['supportTickets', 'mine'], exact: true });
      return result;
    },
    enabled: ticketId != null,
  });
}

export function useReplyToMyTicket(ticketId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: string) =>
      apiFetch<{ message: SupportTicketMessage }>(`/support/tickets/mine/${ticketId}/messages`, { method: 'POST', body: JSON.stringify({ body }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supportTickets', 'mine', ticketId] });
      queryClient.invalidateQueries({ queryKey: ['supportTickets', 'mine'], exact: true });
    },
  });
}

// ---- Admin side: requires support:manage. ----

export function useAllTickets(status?: TicketStatus) {
  return useQuery({
    queryKey: ['supportTickets', 'all', status ?? null],
    queryFn: () => apiFetch<{ tickets: SupportTicket[] }>(`/support/tickets${status ? `?status=${status}` : ''}`),
  });
}

export function useTicketSummary() {
  return useQuery({
    queryKey: ['supportTickets', 'summary'],
    queryFn: () => apiFetch<{ counts: Record<TicketStatus, number> }>('/support/tickets/summary'),
  });
}

// enabled: only fetched once a ticket is actually selected - opening it is what triggers the
// server-side new -> open read-receipt transition, so this also invalidates the session (the
// red badge's count) and the summary/list views on success, not just its own cache entry.
export function useAdminTicketDetail(ticketId: string | null) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ['supportTickets', 'admin', ticketId],
    queryFn: async () => {
      const result = await apiFetch<{ ticket: SupportTicket; messages: SupportTicketMessage[] }>(`/support/tickets/${ticketId}`);
      // Live-decrementing badge: this is what makes the count on UserPersonaBadge.tsx go down
      // the instant a ticket is read, not just on the admin's next login.
      queryClient.invalidateQueries({ queryKey: ['session'] });
      queryClient.invalidateQueries({ queryKey: ['supportTickets', 'summary'] });
      queryClient.invalidateQueries({ queryKey: ['supportTickets', 'all'] });
      return result;
    },
    enabled: ticketId != null,
  });
}

export function useReplyAsAdmin(ticketId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { body: string; status: TicketStatus }) =>
      apiFetch<{ message: SupportTicketMessage }>(`/support/tickets/${ticketId}/messages`, { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supportTickets', 'admin', ticketId] });
      queryClient.invalidateQueries({ queryKey: ['supportTickets', 'summary'] });
      queryClient.invalidateQueries({ queryKey: ['supportTickets', 'all'] });
      queryClient.invalidateQueries({ queryKey: ['session'] });
    },
  });
}
