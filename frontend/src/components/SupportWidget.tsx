import { useState, type FormEvent } from 'react';
import {
  useMyTickets, useCreateTicket, useMyTicketDetail, useReplyToMyTicket,
  type TicketStatus,
} from '../api/supportTickets';
import { formatAsOf } from '../lib/format';

function formatStatus(status: TicketStatus): string {
  if (status === 'on_hold') return 'On Hold';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function statusColorClass(status: TicketStatus): string {
  if (status === 'new') return 'bg-danger/10 text-danger';
  if (status === 'open') return 'bg-success/10 text-success';
  if (status === 'on_hold') return 'bg-warning/10 text-warning';
  return 'bg-border text-text-secondary';
}

// Helpdesk / Support Tickets (2026-09-05) - a self-contained trigger + modal, not a context
// provider like lib/apiKeysModal.ts's ApiKeysModalContext. It's rendered in two independent
// places - TabShell.tsx's header, and PendingReviewPage.tsx (the one screen a status: 'pending'
// account can actually reach, and the one population with no other way to contact an admin at
// all) - and neither needs to trigger it from deep inside a page tree, so a shared context
// would be pure overhead here.
export default function SupportWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);

  function close() {
    setIsOpen(false);
    setShowNewForm(false);
    setSelectedTicketId(null);
  }

  return (
    <>
      {/* Styled as a link, not a nav action like "API Keys"/"Admin" (text-text-secondary,
          color-only-on-hover) - accent-colored at rest with an underline on hover, same
          treatment as LoginPage.tsx's "Forgot password?"/"Sign up", so it reads as clickable
          before you even touch it. Still a <button>, not an <a>, since it opens a modal rather
          than navigating - same button-styled-as-link precedent "API Keys" already uses. */}
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        data-testid="support-widget-trigger"
        className="text-sm text-accent hover:underline"
      >
        Support
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={close}>
          <div
            className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-card bg-bg-card p-6 shadow-card-lg"
            onClick={(e) => e.stopPropagation()}
            data-testid="support-widget-modal"
          >
            <div className="mb-4 flex items-center gap-3">
              {selectedTicketId ? (
                <button
                  type="button"
                  onClick={() => setSelectedTicketId(null)}
                  data-testid="support-back-button"
                  className="text-sm text-accent hover:underline"
                >
                  ← Back
                </button>
              ) : (
                <h1 className="text-lg font-semibold text-text-primary">Help &amp; Support</h1>
              )}
              <button
                type="button"
                onClick={close}
                data-testid="support-widget-close"
                className="ml-auto rounded-btn border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-primary"
              >
                Close
              </button>
            </div>

            <div className="overflow-y-auto">
              {selectedTicketId ? (
                <TicketThread ticketId={selectedTicketId} />
              ) : showNewForm ? (
                <NewTicketForm
                  onCreated={(id) => { setShowNewForm(false); setSelectedTicketId(id); }}
                  onCancel={() => setShowNewForm(false)}
                />
              ) : (
                <TicketList onSelect={setSelectedTicketId} onNew={() => setShowNewForm(true)} />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function TicketList({ onSelect, onNew }: { onSelect: (id: string) => void; onNew: () => void }) {
  const { data, isLoading, isError } = useMyTickets();

  return (
    <div>
      <button
        type="button"
        onClick={onNew}
        data-testid="support-new-ticket-button"
        className="mb-4 w-full rounded-btn bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
      >
        New Ticket
      </button>

      {isLoading && <p className="text-sm text-text-secondary">Loading…</p>}
      {isError && <p className="text-sm text-danger">Could not load your tickets.</p>}
      {data && data.tickets.length === 0 && (
        <p className="text-sm text-text-secondary" data-testid="support-ticket-list-empty">
          You haven&apos;t submitted any support tickets yet.
        </p>
      )}
      <div data-testid="support-ticket-list">
        {data?.tickets.map((ticket) => (
          <button
            key={ticket.id}
            type="button"
            onClick={() => onSelect(ticket.id)}
            data-testid={`support-ticket-row-${ticket.id}`}
            className="block w-full border-b border-border py-3 text-left hover:bg-bg-primary"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-text-primary">{ticket.subject}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusColorClass(ticket.status)}`}>
                {formatStatus(ticket.status)}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-text-secondary">Updated {formatAsOf(ticket.updatedAt)}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

function NewTicketForm({ onCreated, onCancel }: { onCreated: (ticketId: string) => void; onCancel: () => void }) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const create = useCreateTicket();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!subject.trim() || !body.trim()) return;
    const result = await create.mutateAsync({ subject: subject.trim(), body: body.trim() });
    onCreated(result.ticket.id);
  }

  return (
    <form onSubmit={handleSubmit}>
      <label className="mb-1 block text-sm text-text-secondary" htmlFor="support-subject">Subject</label>
      <input
        id="support-subject" required value={subject} onChange={(e) => setSubject(e.target.value)}
        data-testid="support-new-ticket-subject"
        className="mb-4 w-full rounded-btn border border-border bg-bg-primary px-3 py-2 text-text-primary"
      />
      <label className="mb-1 block text-sm text-text-secondary" htmlFor="support-body">How can we help?</label>
      <textarea
        id="support-body" required rows={5} value={body} onChange={(e) => setBody(e.target.value)}
        data-testid="support-new-ticket-body"
        className="mb-4 w-full rounded-btn border border-border bg-bg-primary px-3 py-2 text-text-primary"
      />
      {create.isError && <p className="mb-4 text-sm text-danger">Something went wrong. Please try again.</p>}
      <div className="flex gap-3">
        <button
          type="submit"
          disabled={create.isPending || !subject.trim() || !body.trim()}
          data-testid="support-new-ticket-submit"
          className="rounded-btn bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
        >
          {create.isPending ? 'Submitting…' : 'Submit'}
        </button>
        <button type="button" onClick={onCancel} className="text-sm text-text-secondary hover:underline">
          Cancel
        </button>
      </div>
    </form>
  );
}

function TicketThread({ ticketId }: { ticketId: string }) {
  const { data, isLoading, isError } = useMyTicketDetail(ticketId);
  const [reply, setReply] = useState('');
  const replyMutation = useReplyToMyTicket(ticketId);

  async function handleReply(e: FormEvent) {
    e.preventDefault();
    if (!reply.trim()) return;
    await replyMutation.mutateAsync(reply.trim());
    setReply('');
  }

  if (isLoading) return <p className="text-sm text-text-secondary">Loading…</p>;
  if (isError || !data) return <p className="text-sm text-danger">Could not load this ticket.</p>;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-semibold text-text-primary">{data.ticket.subject}</h2>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusColorClass(data.ticket.status)}`}>
          {formatStatus(data.ticket.status)}
        </span>
      </div>
      <div className="mb-4 space-y-3" data-testid="support-ticket-thread">
        {data.messages.map((message) => {
          const isMine = message.senderUserId === data.ticket.userId;
          return (
            <div
              key={message.id}
              data-testid={`support-ticket-message-${message.id}`}
              className={`max-w-[85%] rounded-btn px-3 py-2 text-sm ${isMine ? 'ml-auto bg-accent text-white' : 'bg-bg-primary text-text-primary'}`}
            >
              <p className="whitespace-pre-wrap">{message.body}</p>
              <p className={`mt-1 text-[.7rem] ${isMine ? 'text-white/80' : 'text-text-secondary'}`}>
                {isMine ? 'You' : 'Support'} · {formatAsOf(message.createdAt)}
              </p>
            </div>
          );
        })}
      </div>
      <form onSubmit={handleReply}>
        <textarea
          required rows={3} value={reply} onChange={(e) => setReply(e.target.value)}
          placeholder="Write a reply…"
          data-testid="support-reply-body"
          className="mb-2 w-full rounded-btn border border-border bg-bg-primary px-3 py-2 text-text-primary"
        />
        <button
          type="submit"
          disabled={replyMutation.isPending || !reply.trim()}
          data-testid="support-reply-submit"
          className="rounded-btn bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
        >
          {replyMutation.isPending ? 'Sending…' : 'Send'}
        </button>
      </form>
    </div>
  );
}
