import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import * as client from '../api/client';
import LoginAsModal from './LoginAsModal';

function renderModal(onClose = vi.fn(), onImpersonated = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <LoginAsModal onClose={onClose} onImpersonated={onImpersonated} />
    </QueryClientProvider>,
  );
  return { onClose, onImpersonated };
}

const users = [
  { id: '2', email: 'plain-user@b.com', roles: ['user'], apiKeyProviders: [], status: 'active' },
  { id: '3', email: 'contra-user@b.com', roles: ['user-contra-withKey'], apiKeyProviders: ['fmp'], status: 'active' },
];

describe('LoginAsModal', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test('lists every user from the existing Manage Users list', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string) => {
      if (url === '/users') return Promise.resolve({ users });
      return Promise.resolve({});
    });
    renderModal();

    expect(await screen.findByText('plain-user@b.com')).toBeInTheDocument();
    expect(screen.getByText('contra-user@b.com')).toBeInTheDocument();
  });

  test('search filters the list by email', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string) => {
      if (url === '/users') return Promise.resolve({ users });
      return Promise.resolve({});
    });
    renderModal();
    await screen.findByText('plain-user@b.com');

    await userEvent.type(screen.getByTestId('login-as-search'), 'contra');
    expect(screen.queryByText('plain-user@b.com')).not.toBeInTheDocument();
    expect(screen.getByText('contra-user@b.com')).toBeInTheDocument();
  });

  test('requires a confirm step, then calls POST /auth/impersonate with the right id and closes on success', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/users') return Promise.resolve({ users });
      if (url === '/auth/impersonate' && options?.method === 'POST') {
        expect(JSON.parse(options.body as string)).toEqual({ userId: '2' });
        return Promise.resolve({ id: '2', email: 'plain-user@b.com', roles: ['user'], permissions: [], impersonating: true });
      }
      return Promise.resolve({});
    });
    const { onImpersonated } = renderModal();
    await screen.findByText('plain-user@b.com');

    await userEvent.click(screen.getByTestId('login-as-2'));
    expect(client.apiFetch).not.toHaveBeenCalledWith('/auth/impersonate', expect.anything());

    await userEvent.click(screen.getByTestId('login-as-confirm-2'));
    expect(onImpersonated).toHaveBeenCalled();
  });

  test('a failed impersonate attempt surfaces the backend error and does not close the modal', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/users') return Promise.resolve({ users });
      if (url === '/auth/impersonate' && options?.method === 'POST') {
        return Promise.reject(new client.ApiError(403, 'Cannot impersonate a user with Admin Console access.', null));
      }
      return Promise.resolve({});
    });
    const { onImpersonated } = renderModal();
    await screen.findByText('plain-user@b.com');

    await userEvent.click(screen.getByTestId('login-as-2'));
    await userEvent.click(screen.getByTestId('login-as-confirm-2'));

    expect(await screen.findByText('Cannot impersonate a user with Admin Console access.')).toBeInTheDocument();
    expect(onImpersonated).not.toHaveBeenCalled();
  });
});
