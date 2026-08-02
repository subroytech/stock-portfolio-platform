import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, test, vi } from 'vitest';
import * as client from '../api/client';
import UserRolesPage from './UserRolesPage';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <UserRolesPage />
    </QueryClientProvider>,
  );
}

function mockFetch(usersResponse: unknown) {
  vi.spyOn(client, 'apiFetch').mockImplementation((path: string, init?: RequestInit) => {
    if (path === '/users' && !init) return Promise.resolve(usersResponse);
    if (path === '/roles') return Promise.resolve({ roles: [{ id: '1', name: 'user', userCount: 1 }, { id: '2', name: 'admin', userCount: 1 }] });
    if (path === '/users' && init?.method === 'POST') {
      return Promise.resolve({ id: '5', email: 'new@b.com', status: 'active', roles: ['user'] });
    }
    if (/^\/users\/\d+$/.test(path) && init?.method === 'PUT') {
      return Promise.resolve({ id: '2', email: 'a@b.com', status: 'active', roles: ['user'] });
    }
    return Promise.reject(new Error(`unexpected call ${path}`));
  });
}

describe('UserRolesPage', () => {
  test('lists users with their current email, status, and role pre-filled', async () => {
    mockFetch({ users: [{ id: '1', email: 'a@b.com', roles: ['user'], apiKeyProviders: [], status: 'active' }] });
    renderPage();
    expect(await screen.findByLabelText('Email for a@b.com')).toHaveValue('a@b.com');
    expect(screen.getByLabelText('Status for a@b.com')).toHaveValue('active');
    expect(screen.getByLabelText('Role for a@b.com')).toHaveValue('user');
  });

  test('a roleless user shows no role selected', async () => {
    mockFetch({ users: [{ id: '1', email: 'a@b.com', roles: [], apiKeyProviders: [], status: 'active' }] });
    renderPage();
    await screen.findByLabelText('Email for a@b.com');
    expect(screen.getByLabelText('Role for a@b.com')).toHaveValue('');
  });

  test('shows which API key providers a user has configured, or "none"', async () => {
    mockFetch({
      users: [
        { id: '1', email: 'has-keys@b.com', roles: ['user'], apiKeyProviders: ['fmp', 'finnhub'], status: 'active' },
        { id: '2', email: 'no-keys@b.com', roles: ['user'], apiKeyProviders: [], status: 'active' },
      ],
    });
    renderPage();
    await screen.findByLabelText('Email for has-keys@b.com');
    expect(screen.getByText('API keys: fmp, finnhub')).toBeInTheDocument();
    expect(screen.getByText('API keys: none')).toBeInTheDocument();
  });

  test("a user row's Save button is disabled until a field changes", async () => {
    mockFetch({ users: [{ id: '2', email: 'a@b.com', roles: ['user'], apiKeyProviders: [], status: 'active' }] });
    renderPage();
    await screen.findByLabelText('Email for a@b.com');
    const saveButtons = screen.getAllByRole('button', { name: 'Save' });
    expect(saveButtons[0]).toBeDisabled();
  });

  test('changing the role select stages locally, Save commits only the role field', async () => {
    mockFetch({ users: [{ id: '2', email: 'admin-to-be@b.com', roles: ['user'], apiKeyProviders: [], status: 'active' }] });
    renderPage();
    await screen.findByLabelText('Email for admin-to-be@b.com');

    await userEvent.selectOptions(screen.getByLabelText('Role for admin-to-be@b.com'), 'admin');
    expect(client.apiFetch).not.toHaveBeenCalledWith('/users/2', expect.anything());

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(client.apiFetch).toHaveBeenCalledWith('/users/2', {
      method: 'PUT',
      body: JSON.stringify({ role: 'admin' }),
    }));
  });

  test('changing the status select stages locally, Save commits only the status field', async () => {
    mockFetch({ users: [{ id: '2', email: 'to-deactivate@b.com', roles: ['user'], apiKeyProviders: [], status: 'active' }] });
    renderPage();
    await screen.findByLabelText('Email for to-deactivate@b.com');

    await userEvent.selectOptions(screen.getByLabelText('Status for to-deactivate@b.com'), 'deactivated');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(client.apiFetch).toHaveBeenCalledWith('/users/2', {
      method: 'PUT',
      body: JSON.stringify({ status: 'deactivated' }),
    }));
  });

  test('editing the email field stages locally, Save commits only the email field', async () => {
    mockFetch({ users: [{ id: '2', email: 'old@b.com', roles: ['user'], apiKeyProviders: [], status: 'active' }] });
    renderPage();
    const emailInput = await screen.findByLabelText('Email for old@b.com');

    await userEvent.clear(emailInput);
    await userEvent.type(emailInput, 'new@b.com');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(client.apiFetch).toHaveBeenCalledWith('/users/2', {
      method: 'PUT',
      body: JSON.stringify({ email: 'new@b.com' }),
    }));
  });

  test('typing a new password includes it in Save, but it is never pre-filled', async () => {
    mockFetch({ users: [{ id: '2', email: 'a@b.com', roles: ['user'], apiKeyProviders: [], status: 'active' }] });
    renderPage();
    await screen.findByLabelText('Email for a@b.com');
    const passwordInput = screen.getByLabelText('Password for a@b.com');
    expect(passwordInput).toHaveValue('');

    await userEvent.type(passwordInput, 'brandnewpassword');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(client.apiFetch).toHaveBeenCalledWith('/users/2', {
      method: 'PUT',
      body: JSON.stringify({ password: 'brandnewpassword' }),
    }));
  });

  test('leaving the password blank does not include it in Save', async () => {
    mockFetch({ users: [{ id: '2', email: 'a@b.com', roles: ['user'], apiKeyProviders: [], status: 'active' }] });
    renderPage();
    await screen.findByLabelText('Email for a@b.com');

    await userEvent.selectOptions(screen.getByLabelText('Status for a@b.com'), 'deactivated');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(client.apiFetch).toHaveBeenCalledWith('/users/2', {
      method: 'PUT',
      body: JSON.stringify({ status: 'deactivated' }),
    }));
  });

  test('creating a user POSTs the form fields and clears them', async () => {
    mockFetch({ users: [] });
    renderPage();
    await waitFor(() => expect(client.apiFetch).toHaveBeenCalledWith('/users'));

    await userEvent.type(screen.getByLabelText('New user email'), 'new@b.com');
    await userEvent.type(screen.getByLabelText('New user password'), 'longenoughpassword');
    await userEvent.selectOptions(screen.getByLabelText('New user status'), 'deactivated');
    await userEvent.click(screen.getByRole('button', { name: 'Create user' }));

    await waitFor(() => expect(client.apiFetch).toHaveBeenCalledWith('/users', {
      method: 'POST',
      body: JSON.stringify({ email: 'new@b.com', password: 'longenoughpassword', status: 'deactivated', role: 'user' }),
    }));
    await waitFor(() => expect(screen.getByLabelText('New user email')).toHaveValue(''));
  });

  describe('header filters', () => {
    function threeUsers() {
      return {
        users: [
          { id: '1', email: 'alice@b.com', roles: ['user'], apiKeyProviders: [], status: 'active' },
          { id: '2', email: 'bob@b.com', roles: ['admin'], apiKeyProviders: [], status: 'deactivated' },
          { id: '3', email: 'carol@b.com', roles: ['user'], apiKeyProviders: [], status: 'active' },
        ],
      };
    }

    test('typing an email substring narrows the list with no new network call', async () => {
      mockFetch(threeUsers());
      renderPage();
      await screen.findByLabelText('Email for alice@b.com');
      const callsBefore = (client.apiFetch as ReturnType<typeof vi.fn>).mock.calls.length;

      await userEvent.type(screen.getByLabelText('Filter by email'), 'ali');

      expect(screen.getByLabelText('Email for alice@b.com')).toBeInTheDocument();
      expect(screen.queryByLabelText('Email for bob@b.com')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Email for carol@b.com')).not.toBeInTheDocument();
      expect(client.apiFetch).toHaveBeenCalledTimes(callsBefore);
    });

    test('picking a status narrows the list with no new network call', async () => {
      mockFetch(threeUsers());
      renderPage();
      await screen.findByLabelText('Email for alice@b.com');
      const callsBefore = (client.apiFetch as ReturnType<typeof vi.fn>).mock.calls.length;

      await userEvent.selectOptions(screen.getByLabelText('Filter by status'), 'deactivated');

      expect(screen.getByLabelText('Email for bob@b.com')).toBeInTheDocument();
      expect(screen.queryByLabelText('Email for alice@b.com')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Email for carol@b.com')).not.toBeInTheDocument();
      expect(client.apiFetch).toHaveBeenCalledTimes(callsBefore);
    });

    test('picking a role narrows the list with no new network call', async () => {
      mockFetch(threeUsers());
      renderPage();
      await screen.findByLabelText('Email for alice@b.com');
      const callsBefore = (client.apiFetch as ReturnType<typeof vi.fn>).mock.calls.length;

      await userEvent.selectOptions(screen.getByLabelText('Filter by role'), 'admin');

      expect(screen.getByLabelText('Email for bob@b.com')).toBeInTheDocument();
      expect(screen.queryByLabelText('Email for alice@b.com')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Email for carol@b.com')).not.toBeInTheDocument();
      expect(client.apiFetch).toHaveBeenCalledTimes(callsBefore);
    });

    test('resetting a filter back to "All" restores the full list', async () => {
      mockFetch(threeUsers());
      renderPage();
      await screen.findByLabelText('Email for alice@b.com');

      await userEvent.selectOptions(screen.getByLabelText('Filter by status'), 'deactivated');
      expect(screen.queryByLabelText('Email for alice@b.com')).not.toBeInTheDocument();

      await userEvent.selectOptions(screen.getByLabelText('Filter by status'), 'all');
      expect(screen.getByLabelText('Email for alice@b.com')).toBeInTheDocument();
      expect(screen.getByLabelText('Email for bob@b.com')).toBeInTheDocument();
      expect(screen.getByLabelText('Email for carol@b.com')).toBeInTheDocument();
    });
  });
});
