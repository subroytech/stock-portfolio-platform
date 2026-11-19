import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, test, vi } from 'vitest';
import * as client from '../api/client';
import RolesPage from './RolesPage';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <RolesPage />
    </QueryClientProvider>,
  );
}

describe('RolesPage', () => {
  test('lists existing roles with their user count', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({
      roles: [{ id: '1', name: 'user', userCount: 3 }, { id: '2', name: 'admin', userCount: 0 }],
    });
    renderPage();
    expect(await screen.findByText('user')).toBeInTheDocument();
    expect(screen.getByText('3 users')).toBeInTheDocument();
    expect(screen.getByText('admin')).toBeInTheDocument();
    expect(screen.getByText('0 users')).toBeInTheDocument();
  });

  test('creating a role POSTs the name and clears the input', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/roles' && init?.method === 'POST') return Promise.resolve({ role: { id: '3', name: 'analyst', userCount: 0 } });
      return Promise.resolve({ roles: [] });
    });
    renderPage();

    const input = screen.getByLabelText('New role name');
    await userEvent.type(input, 'analyst');
    await userEvent.click(screen.getByRole('button', { name: 'Create role' }));

    await waitFor(() => expect(client.apiFetch).toHaveBeenCalledWith('/roles', {
      method: 'POST',
      body: JSON.stringify({ name: 'analyst' }),
    }));
    await waitFor(() => expect(input).toHaveValue(''));
  });

  test('a role with zero users has an enabled Delete button that calls DELETE /roles/:id', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/roles/2' && init?.method === 'DELETE') return Promise.resolve({ success: true });
      return Promise.resolve({ roles: [{ id: '2', name: 'analyst', userCount: 0 }] });
    });
    renderPage();
    await screen.findByText('analyst');

    const deleteButton = screen.getByRole('button', { name: 'Delete' });
    expect(deleteButton).not.toBeDisabled();
    await userEvent.click(deleteButton);

    await waitFor(() => expect(client.apiFetch).toHaveBeenCalledWith('/roles/2', { method: 'DELETE' }));
  });

  test('a role with users has a disabled Delete button', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({ roles: [{ id: '1', name: 'user', userCount: 5 }] });
    renderPage();
    await screen.findByText('user');
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
  });
});
