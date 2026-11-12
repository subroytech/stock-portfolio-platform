import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import * as client from '../api/client';
import ImpersonationBanner from './ImpersonationBanner';
import type { User } from '../api/auth';

function session(overrides: Partial<User> = {}): User {
  return { id: '2', email: 'plain-user@b.com', roles: ['user'], permissions: [], impersonating: true, status: 'active', firstName: null, lastName: null, ...overrides };
}

function renderBanner(user: User) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<ImpersonationBanner session={user} returnPath="/admin" />} />
          <Route path="/admin" element={<div>Admin Page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ImpersonationBanner', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test('renders nothing when not impersonating', () => {
    renderBanner(session({ impersonating: false }));
    expect(screen.queryByTestId('impersonation-banner')).not.toBeInTheDocument();
  });

  test('shows the impersonated email when impersonating', () => {
    renderBanner(session({ email: 'target@b.com', impersonating: true }));
    expect(screen.getByTestId('impersonation-banner')).toHaveTextContent('You are viewing as target@b.com.');
  });

  test('"Return to my account" calls POST /auth/stop-impersonating and navigates to returnPath', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/auth/stop-impersonating' && options?.method === 'POST') {
        return Promise.resolve({ id: '1', email: 'admin-master@b.com', roles: ['admin-master'], permissions: [], impersonating: false });
      }
      return Promise.resolve({});
    });
    renderBanner(session());

    await userEvent.click(screen.getByTestId('return-to-my-account'));
    expect(client.apiFetch).toHaveBeenCalledWith('/auth/stop-impersonating', expect.objectContaining({ method: 'POST' }));
    expect(await screen.findByText('Admin Page')).toBeInTheDocument();
  });
});
