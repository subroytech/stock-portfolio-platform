import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import * as client from '../api/client';
import type { UserWithRoles } from '../api/users';
import FlexQuotaOverridesModal from './FlexQuotaOverridesModal';

beforeEach(() => vi.restoreAllMocks());

const BASE_USER: UserWithRoles = {
  id: '2', email: 'a@b.com', roles: ['user'], apiKeyProviders: [], status: 'active',
  flexMaxPendingTemplatesOverride: null, flexMaxApprovedTemplatesOverride: null, flexMaxPortfoliosOverride: null,
};

function renderModal(user: UserWithRoles = BASE_USER, onClose = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { onClose, ...render(
    <QueryClientProvider client={queryClient}>
      <FlexQuotaOverridesModal user={user} onClose={onClose} />
    </QueryClientProvider>,
  ) };
}

function mockPut(response: unknown = { id: '2' }) {
  return vi.spyOn(client, 'apiFetch').mockImplementation((path: string, init?: RequestInit) => {
    if (path === '/users/2' && init?.method === 'PUT') return Promise.resolve(response);
    return Promise.reject(new Error(`unexpected call ${path}`));
  });
}

describe('FlexQuotaOverridesModal', () => {
  test('pre-fills current override values, blank for null', () => {
    renderModal({
      ...BASE_USER, flexMaxPendingTemplatesOverride: 4, flexMaxApprovedTemplatesOverride: 8, flexMaxPortfoliosOverride: null,
    });
    expect(screen.getByLabelText('Max Pending-Approval Templates')).toHaveValue('4');
    expect(screen.getByLabelText('Max Approved Templates')).toHaveValue('8');
    expect(screen.getByLabelText('Max Flex Portfolios')).toHaveValue('');
  });

  test('Save is disabled until a field actually changes', () => {
    renderModal();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  test('setting a value PUTs only that field', async () => {
    const apiFetch = mockPut();
    renderModal();

    await userEvent.type(screen.getByLabelText('Max Flex Portfolios'), '10');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/users/2', {
      method: 'PUT',
      body: JSON.stringify({ flexMaxPortfoliosOverride: 10 }),
    }));
  });

  test('clearing an existing override sends null, not omitted', async () => {
    const apiFetch = mockPut();
    renderModal({ ...BASE_USER, flexMaxPortfoliosOverride: 10 });

    await userEvent.clear(screen.getByLabelText('Max Flex Portfolios'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/users/2', {
      method: 'PUT',
      body: JSON.stringify({ flexMaxPortfoliosOverride: null }),
    }));
  });

  test('an unmodified field is never included in the PUT body', async () => {
    const apiFetch = mockPut();
    renderModal({ ...BASE_USER, flexMaxPendingTemplatesOverride: 4 });

    await userEvent.type(screen.getByLabelText('Max Flex Portfolios'), '10');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/users/2', {
      method: 'PUT',
      body: JSON.stringify({ flexMaxPortfoliosOverride: 10 }),
    }));
  });

  test('a non-numeric value is rejected client-side and blocks Save', async () => {
    renderModal();
    await userEvent.type(screen.getByLabelText('Max Flex Portfolios'), 'abc');
    expect(screen.getByText(/must be blank or a non-negative whole number/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  test('a negative value is rejected client-side', async () => {
    renderModal();
    await userEvent.type(screen.getByLabelText('Max Flex Portfolios'), '-1');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  test('closes on successful save', async () => {
    mockPut();
    const { onClose } = renderModal();

    await userEvent.type(screen.getByLabelText('Max Flex Portfolios'), '10');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  test('Close button calls onClose without saving', async () => {
    const apiFetch = mockPut();
    const { onClose } = renderModal();

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalled();
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
