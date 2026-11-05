import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import * as client from '../api/client';
import ProtectedRoute from './ProtectedRoute';

function renderProtected() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/login" element={<div>Login Page</div>} />
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<div data-testid="real-app">Real App</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProtectedRoute', () => {
  beforeEach(() => vi.restoreAllMocks());

  test('bounces to /login with no session', async () => {
    vi.spyOn(client, 'apiFetch').mockRejectedValue(new client.ApiError(401, 'Authentication required.', null));
    renderProtected();
    expect(await screen.findByText('Login Page')).toBeInTheDocument();
  });

  test('renders the real app for an active session', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({ id: '1', email: 'a@b.com', roles: ['user'], permissions: [], impersonating: false, status: 'active', firstName: null, lastName: null });
    renderProtected();
    expect(await screen.findByTestId('real-app')).toBeInTheDocument();
  });

  test('renders only the pending-review banner for a pending session, never the real app', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({ id: '1', email: 'a@b.com', roles: [], permissions: [], impersonating: false, status: 'pending', firstName: 'Jordan', lastName: 'Rivera' });
    renderProtected();
    expect(await screen.findByTestId('pending-review-banner')).toBeInTheDocument();
    expect(screen.queryByTestId('real-app')).not.toBeInTheDocument();
  });
});
