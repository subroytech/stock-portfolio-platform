import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import * as client from '../api/client';
import { SESSION_EXPIRED_STORAGE_KEY } from '../lib/queryClient';
import LoginPage from './LoginPage';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  test('shows the session-expired banner when apiFetch\'s global 401 handling set the flag, and clears it', () => {
    sessionStorage.setItem(SESSION_EXPIRED_STORAGE_KEY, '1');
    renderPage();

    expect(screen.getByTestId('login-session-expired')).toHaveTextContent('Your session ended — please log in again.');
    expect(sessionStorage.getItem(SESSION_EXPIRED_STORAGE_KEY)).toBeNull();
  });

  test('shows no banner on a plain visit with no flag set', () => {
    renderPage();
    expect(screen.queryByTestId('login-session-expired')).not.toBeInTheDocument();
  });

  test('a failed login shows the normal inline error, not the session-expired banner', async () => {
    vi.spyOn(client, 'apiFetch').mockRejectedValue(new client.ApiError(401, 'Invalid email or password.', null));
    renderPage();

    await userEvent.type(screen.getByTestId('login-email'), 'a@b.com');
    await userEvent.type(screen.getByTestId('login-password'), 'wrongpassword');
    await userEvent.click(screen.getByTestId('login-submit'));

    expect(await screen.findByText('Invalid email or password.')).toBeInTheDocument();
    expect(screen.queryByTestId('login-session-expired')).not.toBeInTheDocument();
  });
});
