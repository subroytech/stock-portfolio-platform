import { useState, type FormEvent } from 'react';
import {
  useTicketSummary, useAllTickets, useAdminTicketDetail, useReplyAsAdmin,
  type TicketStatus,
} from '../api/supportTickets';
import { formatAsOf } from '../lib/format';

const STATUSES: TicketStatus[] = ['new', 'open', 'on_hold', 'closed'];
const STATUS_LABELS: Record<TicketStatus, string> = { new: 'New', open: 'Open', on_hold: 'On Hold', closed: 'Closed' };
// Admin can only ever set the ticket to one of these 3 via a reply - 'new' is exclusively the
// "unread, reopened by the user" state, never admin-settable (see supportTicket.service.ts).
const ADMIN_REPLY_STATUSES: TicketStatus[] = ['open', 'on_hold', 'closed'];

function statusColorClass(status: TicketStatus): string {
  if (status === 'new') return 'bg-danger/10 text-danger';
  if (status === 'open') return 'bg-success/10 text-success';
  if (status === 'on_hold') return 'bg-warning/10 text-warning';
  return 'bg-border text-text-secondary';
}

type View = { kind: 'summary' } | { kind: 'list'; status: TicketStatus } | { kind: 'detail'; ticketId: string; backStatus: TicketStatus };

// Admin Console "Support Tickets" tab (Helpdesk / Support Tickets, 2026-09-05), gated by
// support:manage. Three internal view-states, no new routes - Summary (per-status counts) ->
// List (filtered) -> Detail (thread + reply), same "internal navigation state" shape already
// used elsewhere in this Admin Console (e.g. ConfigPropertiesPage.tsx's group/property drill-down).
export default function AdminSupportTicketsPage() {
  const [view, setView] = useState<View>({ kind: 'summary' });

  if (view.kind === 'list') {
    return (
      <ListView
        status={view.status}
        onBack={() => setView({ kind: 'summary' })}
        onSelectTicket={(ticketId) => setView({ kind: 'detail', ticketId, backStatus: view.status })}
      />
    );
  }
  if (view.kind === 'detail') {
    return <DetailView ticketId={view.ticketId} onBack={() => setView({ kind: 'list', status: view.backStatus })} />;
  }
  return <SummaryView onSelectStatus={(status) => setView({ kind: 'list', status })} />;
}

function SummaryView({ onSelectStatus }: { onSelectStatus: (status: TicketStatus) => void }) {
  const { data, isLoading, isError } = useTicketSummary();

  return (
    <div data-testid="admin-support-summary">
      <h1 className="mb-4 text-lg font-semibold text-text-primary">Support Tickets</h1>
      {isLoading && <p className="text-sm text-text-secondary">Loading…</p>}
      {isError && <p className="text-sm text-danger">Could not load the ticket summary.</p>}
      {data && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => onSelectStatus(status)}
              data-testid={`admin-support-summary-tile-${status}`}
              className="rounded-card border border-border bg-bg-card p-5 text-left shadow-card transition-colors hover:bg-bg-primary"
            >
              <p className="text-3xl font-semibold text-text-primary">{data.counts[status]}</p>
              <p className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${statusColorClass(status)}`}>
                {STATUS_LABELS[status]}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ListView({ status, onBack, onSelectTicket }: { status: TicketStatus; onBack: () => void; onSelectTicket: (ticketId: string) => void }) {
  const { data, isLoading, isError } = useAllTickets(status);

  return (
    <div>
      <button type="button" onClick={onBack} data-testid="admin-support-list-back" className="mb-4 text-sm text-accent hover:underline">
        ← Back to Summary
      </button>
      <h1 className="mb-4 text-lg font-semibold text-text-primary">{STATUS_LABELS[status]} Tickets</h1>
      {isLoading && <p className="text-sm text-text-secondary">Loading…</p>}
      {isError && <p className="text-sm text-danger">Could not load tickets.</p>}
      {data && data.tickets.length === 0 && <p className="text-sm text-text-secondary">No {STATUS_LABELS[status].toLowerCase()} tickets.</p>}
      <div data-testid="admin-support-list" className="divide-y divide-border rounded-card border border-border bg-bg-card">
        {data?.tickets.map((ticket) => (
          <button
            key={ticket.id}
            type="button"
            onClick={() => onSelectTicket(ticket.id)}
            data-testid={`admin-support-list-row-${ticket.id}`}
            className="block w-full px-4 py-3 text-left hover:bg-bg-primary"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-text-primary">{ticket.subject}</span>
              <span className="text-xs text-text-secondary">Updated {formatAsOf(ticket.updatedAt)}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function DetailView({ ticketId, onBack }: { ticketId: string; onBack: () => void }) {
  const { data, isLoading, isError } = useAdminTicketDetail(ticketId);
  const [replyBody, setReplyBody] = useState('');
  const [nextStatus, setNextStatus] = useState<TicketStatus>('open');
  const reply = useReplyAsAdmin(ticketId);

  async function handleReply(e: FormEvent) {
    e.preventDefault();
    if (!replyBody.trim()) return;
    await reply.mutateAsync({ body: replyBody.trim(), status: nextStatus });
    setReplyBody('');
  }

  return (
    <div data-testid="admin-support-detail">
      <button type="button" onClick={onBack} data-testid="admin-support-detail-back" className="mb-4 text-sm text-accent hover:underline">
        ← Back to List
      </button>

      {isLoading && <p className="text-sm text-text-secondary">Loading…</p>}
      {isError && <p className="text-sm text-danger">Could not load this ticket.</p>}

      {data && (
        <>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h1 className="text-lg font-semibold text-text-primary">{data.ticket.subject}</h1>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusColorClass(data.ticket.status)}`}>
              {STATUS_LABELS[data.ticket.status]}
            </span>
          </div>

          <div className="mb-4 space-y-3">
            {data.messages.map((message) => {
              const isFromOwner = message.senderUserId === data.ticket.userId;
              return (
                <div
                  key={message.id}
                  data-testid={`admin-support-message-${message.id}`}
                  className={`max-w-[85%] rounded-btn px-3 py-2 text-sm ${isFromOwner ? 'bg-bg-primary text-text-primary' : 'ml-auto bg-accent text-white'}`}
                >
                  <p className="whitespace-pre-wrap">{message.body}</p>
                  <p className={`mt-1 text-[.7rem] ${isFromOwner ? 'text-text-secondary' : 'text-white/80'}`}>
                    {isFromOwner ? 'User' : 'Support'} · {formatAsOf(message.createdAt)}
                  </p>
                </div>
              );
            })}
          </div>

          <form onSubmit={handleReply}>
            <textarea
              required rows={4} value={replyBody} onChange={(e) => setReplyBody(e.target.value)}
              placeholder="Write a reply…"
              data-testid="admin-support-reply-body"
              className="mb-2 w-full rounded-btn border border-border bg-bg-primary px-3 py-2 text-text-primary"
            />
            <div className="flex items-center gap-3">
              <select
                value={nextStatus}
                onChange={(e) => setNextStatus(e.target.value as TicketStatus)}
                data-testid="admin-support-reply-status"
                className="rounded-btn border border-border bg-bg-primary px-3 py-1.5 text-sm text-text-primary"
              >
                {ADMIN_REPLY_STATUSES.map((s) => (
                  <option key={s} value={s}>{s === 'open' ? 'Keep Open' : STATUS_LABELS[s]}</option>
                ))}
              </select>
              <button
                type="submit"
                disabled={reply.isPending || !replyBody.trim()}
                data-testid="admin-support-reply-submit"
                className="rounded-btn bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
              >
                {reply.isPending ? 'Sending…' : 'Send Reply'}
              </button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}
