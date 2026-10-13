import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import * as client from '../api/client';
import SupportWidget from './SupportWidget';

const TICKET = { id: 't1', userId: 'u1', subject: 'Login trouble', status: 'new', createdAt: '2026-09-05T00:00:00Z', updatedAt: '2026-09-05T00:00:00Z' };
const THREAD = {
  ticket: TICKET,
  messages: [{ id: 'm1', ticketId: 't1', senderUserId: 'u1', body: 'I cannot log in', createdAt: '2026-09-05T00:00:00Z' }],
};

function renderWidget() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SupportWidget />
    </QueryClientProvider>,
  );
}

function mockRoutedFetch(overrides: Record<string, unknown> = {}) {
  return vi.spyOn(client, 'apiFetch').mockImplementation((path: string, init?: RequestInit) => {
    if (path === '/support/tickets/mine' && !init) return Promise.resolve(overrides.mine ?? { tickets: [TICKET] });
    if (path === '/support/tickets' && init?.method === 'POST') return Promise.resolve(overrides.create ?? { ticket: TICKET });
    if (path === '/support/tickets/mine/t1') return Promise.resolve(overrides.detail ?? THREAD);
    if (path === '/support/tickets/mine/t1/messages') return Promise.resolve(overrides.reply ?? { message: { id: 'm2', ticketId: 't1', senderUserId: 'u1', body: 'more info', createdAt: '2026-09-05T01:00:00Z' } });
    return Promise.resolve({});
  });
}

describe('SupportWidget', () => {
  beforeEach(() => vi.restoreAllMocks());

  test('the modal is closed by default', () => {
    mockRoutedFetch();
    renderWidget();
    expect(screen.queryByTestId('support-widget-modal')).not.toBeInTheDocument();
  });

  test('clicking the trigger opens the modal and lists the caller\'s own tickets', async () => {
    mockRoutedFetch();
    renderWidget();
    await userEvent.click(screen.getByTestId('support-widget-trigger'));
    expect(await screen.findByTestId('support-ticket-row-t1')).toHaveTextContent('Login trouble');
  });

  test('shows an empty state when there are no tickets yet', async () => {
    mockRoutedFetch({ mine: { tickets: [] } });
    renderWidget();
    await userEvent.click(screen.getByTestId('support-widget-trigger'));
    expect(await screen.findByTestId('support-ticket-list-empty')).toBeInTheDocument();
  });

  test('creating a new ticket submits subject+body and opens the new ticket\'s thread', async () => {
    const apiFetch = mockRoutedFetch();
    renderWidget();
    await userEvent.click(screen.getByTestId('support-widget-trigger'));
    await userEvent.click(await screen.findByTestId('support-new-ticket-button'));

    await userEvent.type(screen.getByTestId('support-new-ticket-subject'), 'Login trouble');
    await userEvent.type(screen.getByTestId('support-new-ticket-body'), 'I cannot log in');
    await userEvent.click(screen.getByTestId('support-new-ticket-submit'));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/support/tickets', expect.objectContaining({ method: 'POST', body: JSON.stringify({ subject: 'Login trouble', body: 'I cannot log in' }) })));
    expect(await screen.findByTestId('support-ticket-thread')).toBeInTheDocument();
  });

  test('opening a ticket from the list shows its thread', async () => {
    mockRoutedFetch();
    renderWidget();
    await userEvent.click(screen.getByTestId('support-widget-trigger'));
    await userEvent.click(await screen.findByTestId('support-ticket-row-t1'));

    expect(await screen.findByTestId('support-ticket-thread')).toHaveTextContent('I cannot log in');
  });

  test('replying in the thread sends the message and clears the box', async () => {
    const apiFetch = mockRoutedFetch();
    renderWidget();
    await userEvent.click(screen.getByTestId('support-widget-trigger'));
    await userEvent.click(await screen.findByTestId('support-ticket-row-t1'));
    await screen.findByTestId('support-ticket-thread');

    await userEvent.type(screen.getByTestId('support-reply-body'), 'more info');
    await userEvent.click(screen.getByTestId('support-reply-submit'));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/support/tickets/mine/t1/messages', expect.objectContaining({ method: 'POST', body: JSON.stringify({ body: 'more info' }) })));
    expect(screen.getByTestId('support-reply-body')).toHaveValue('');
  });

  test('Back returns from a thread to the ticket list', async () => {
    mockRoutedFetch();
    renderWidget();
    await userEvent.click(screen.getByTestId('support-widget-trigger'));
    await userEvent.click(await screen.findByTestId('support-ticket-row-t1'));
    await screen.findByTestId('support-ticket-thread');

    await userEvent.click(screen.getByTestId('support-back-button'));
    expect(await screen.findByTestId('support-ticket-list')).toBeInTheDocument();
  });

  test('shows an unread badge on the trigger button when a ticket has an unseen admin reply', async () => {
    mockRoutedFetch({ mine: { tickets: [{ ...TICKET, unreadByUser: true }] } });
    renderWidget();
    expect(await screen.findByTestId('support-widget-unread-count')).toHaveTextContent('1');
  });

  test('no unread badge when nothing is unread', async () => {
    mockRoutedFetch({ mine: { tickets: [{ ...TICKET, unreadByUser: false }] } });
    renderWidget();
    await screen.findByTestId('support-widget-trigger');
    expect(screen.queryByTestId('support-widget-unread-count')).not.toBeInTheDocument();
  });

  test('an unread ticket shows a dot next to its subject in the list', async () => {
    mockRoutedFetch({ mine: { tickets: [{ ...TICKET, unreadByUser: true }] } });
    renderWidget();
    await userEvent.click(screen.getByTestId('support-widget-trigger'));
    expect(await screen.findByTestId('support-ticket-unread-dot-t1')).toBeInTheDocument();
  });

  test('Close resets the widget back to its initial state', async () => {
    mockRoutedFetch();
    renderWidget();
    await userEvent.click(screen.getByTestId('support-widget-trigger'));
    await userEvent.click(await screen.findByTestId('support-ticket-row-t1'));
    await screen.findByTestId('support-ticket-thread');

    await userEvent.click(screen.getByTestId('support-widget-close'));
    expect(screen.queryByTestId('support-widget-modal')).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId('support-widget-trigger'));
    expect(await screen.findByTestId('support-ticket-list')).toBeInTheDocument();
  });
});
