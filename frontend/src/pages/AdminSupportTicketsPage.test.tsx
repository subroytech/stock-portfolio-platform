import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import * as client from '../api/client';
import AdminSupportTicketsPage from './AdminSupportTicketsPage';

const SUMMARY = { counts: { new: 2, open: 1, on_hold: 0, closed: 5 } };
const NEW_TICKET = { id: 't1', userId: 'u1', subject: 'Login trouble', status: 'new', createdAt: '2026-09-05T00:00:00Z', updatedAt: '2026-09-05T00:00:00Z' };
const OPEN_TICKET = { ...NEW_TICKET, id: 't1', status: 'open' };
const THREAD = {
  ticket: OPEN_TICKET,
  messages: [{ id: 'm1', ticketId: 't1', senderUserId: 'u1', body: 'I cannot log in', createdAt: '2026-09-05T00:00:00Z' }],
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AdminSupportTicketsPage />
    </QueryClientProvider>,
  );
}

function mockRoutedFetch(overrides: Record<string, unknown> = {}) {
  return vi.spyOn(client, 'apiFetch').mockImplementation((path: string, init?: RequestInit) => {
    if (path === '/support/tickets/summary') return Promise.resolve(overrides.summary ?? SUMMARY);
    if (path === '/support/tickets?status=new') return Promise.resolve(overrides.newList ?? { tickets: [NEW_TICKET] });
    if (path === '/support/tickets/t1') return Promise.resolve(overrides.detail ?? THREAD);
    if (path === '/support/tickets/t1/messages' && init?.method === 'POST') {
      return Promise.resolve(overrides.reply ?? { message: { id: 'm2', ticketId: 't1', senderUserId: 'admin-1', body: 'reply', createdAt: '2026-09-05T01:00:00Z' } });
    }
    return Promise.resolve({});
  });
}

describe('AdminSupportTicketsPage', () => {
  beforeEach(() => vi.restoreAllMocks());

  test('the summary shows per-status counts', async () => {
    mockRoutedFetch();
    renderPage();
    expect(await screen.findByTestId('admin-support-summary-tile-new')).toHaveTextContent('2');
    expect(screen.getByTestId('admin-support-summary-tile-open')).toHaveTextContent('1');
    expect(screen.getByTestId('admin-support-summary-tile-on_hold')).toHaveTextContent('0');
    expect(screen.getByTestId('admin-support-summary-tile-closed')).toHaveTextContent('5');
  });

  test('clicking a summary tile drills into that status\'s filtered list', async () => {
    mockRoutedFetch();
    renderPage();
    await userEvent.click(await screen.findByTestId('admin-support-summary-tile-new'));
    expect(await screen.findByTestId('admin-support-list-row-t1')).toHaveTextContent('Login trouble');
  });

  test('Back from the list returns to the summary', async () => {
    mockRoutedFetch();
    renderPage();
    await userEvent.click(await screen.findByTestId('admin-support-summary-tile-new'));
    await screen.findByTestId('admin-support-list-row-t1');
    await userEvent.click(screen.getByTestId('admin-support-list-back'));
    expect(await screen.findByTestId('admin-support-summary')).toBeInTheDocument();
  });

  test('opening a ticket from the list shows its thread', async () => {
    mockRoutedFetch();
    renderPage();
    await userEvent.click(await screen.findByTestId('admin-support-summary-tile-new'));
    await userEvent.click(await screen.findByTestId('admin-support-list-row-t1'));
    expect(await screen.findByTestId('admin-support-detail')).toHaveTextContent('I cannot log in');
  });

  test('opening the ticket triggers the read-receipt fetch against the admin endpoint (GET /support/tickets/:id)', async () => {
    const apiFetch = mockRoutedFetch();
    renderPage();
    await userEvent.click(await screen.findByTestId('admin-support-summary-tile-new'));
    await userEvent.click(await screen.findByTestId('admin-support-list-row-t1'));
    await screen.findByTestId('admin-support-detail');
    expect(apiFetch).toHaveBeenCalledWith('/support/tickets/t1');
  });

  test('replying defaults to "Keep Open" and can be changed to On Hold or Closed', async () => {
    const apiFetch = mockRoutedFetch();
    renderPage();
    await userEvent.click(await screen.findByTestId('admin-support-summary-tile-new'));
    await userEvent.click(await screen.findByTestId('admin-support-list-row-t1'));
    await screen.findByTestId('admin-support-detail');

    expect(screen.getByTestId('admin-support-reply-status')).toHaveValue('open');

    await userEvent.selectOptions(screen.getByTestId('admin-support-reply-status'), 'on_hold');
    await userEvent.type(screen.getByTestId('admin-support-reply-body'), 'Looking into it');
    await userEvent.click(screen.getByTestId('admin-support-reply-submit'));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/support/tickets/t1/messages', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ body: 'Looking into it', status: 'on_hold' }),
    })));
  });

  test('Back from the detail view returns to the list, not the summary', async () => {
    mockRoutedFetch();
    renderPage();
    await userEvent.click(await screen.findByTestId('admin-support-summary-tile-new'));
    await userEvent.click(await screen.findByTestId('admin-support-list-row-t1'));
    await screen.findByTestId('admin-support-detail');

    await userEvent.click(screen.getByTestId('admin-support-detail-back'));
    expect(await screen.findByTestId('admin-support-list')).toBeInTheDocument();
  });
});
