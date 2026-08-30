import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import * as client from '../api/client';
import ChangePasswordPage from './ChangePasswordPage';

const SESSION = { id: '1', email: 'jordan@example.com', roles: ['user'], permissions: [], impersonating: false, status: 'active', firstName: 'Jordan', lastName: 'Rivera' };
const VALID_PASSWORD = 'Br4nd!NewPasswordXY';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ChangePasswordPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ChangePasswordPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string) => {
      if (url === '/auth/me') return Promise.resolve(SESSION);
      return Promise.resolve({});
    });
  });

  test('submit disabled until current + a valid, matching new password are entered', async () => {
    renderPage();
    await screen.findByTestId('change-password-current');
    expect(screen.getByTestId('change-password-submit')).toBeDisabled();

    await userEvent.type(screen.getByTestId('change-password-current'), 'OldPassword1!Xyz');
    await userEvent.type(screen.getByTestId('change-password-new'), VALID_PASSWORD);
    await userEvent.type(screen.getByTestId('change-password-confirm'), VALID_PASSWORD);
    expect(screen.getByTestId('change-password-submit')).not.toBeDisabled();
  });

  test('the new-password check uses the session\'s own first/last name (rejects a password containing it)', async () => {
    renderPage();
    await screen.findByTestId('change-password-current');
    await userEvent.type(screen.getByTestId('change-password-current'), 'OldPassword1!Xyz');
    await userEvent.type(screen.getByTestId('change-password-new'), 'MyJordanPassw0rd!Ex');
    expect(screen.getByTestId('password-rule-name')).toHaveAttribute('data-passed', 'false');
    expect(screen.getByTestId('change-password-submit')).toBeDisabled();
  });

  test('submits current+new password and shows a success message', async () => {
    const apiFetch = vi.spyOn(client, 'apiFetch').mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/auth/me') return Promise.resolve(SESSION);
      if (url === '/auth/change-password' && options?.method === 'POST') {
        const body = JSON.parse(options.body as string);
        expect(body).toEqual({ currentPassword: 'OldPassword1!Xyz', newPassword: VALID_PASSWORD });
        return Promise.resolve({ success: true });
      }
      return Promise.resolve({});
    });

    renderPage();
    await screen.findByTestId('change-password-current');
    await userEvent.type(screen.getByTestId('change-password-current'), 'OldPassword1!Xyz');
    await userEvent.type(screen.getByTestId('change-password-new'), VALID_PASSWORD);
    await userEvent.type(screen.getByTestId('change-password-confirm'), VALID_PASSWORD);
    await userEvent.click(screen.getByTestId('change-password-submit'));

    expect(await screen.findByTestId('change-password-success')).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith('/auth/change-password', expect.objectContaining({ method: 'POST' }));
  });

  test('a failed change shows the backend error inline', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/auth/me') return Promise.resolve(SESSION);
      if (url === '/auth/change-password' && options?.method === 'POST') {
        return Promise.reject(new client.ApiError(401, 'Current password is incorrect.', null));
      }
      return Promise.resolve({});
    });

    renderPage();
    await screen.findByTestId('change-password-current');
    await userEvent.type(screen.getByTestId('change-password-current'), 'WrongOne1!Xyz');
    await userEvent.type(screen.getByTestId('change-password-new'), VALID_PASSWORD);
    await userEvent.type(screen.getByTestId('change-password-confirm'), VALID_PASSWORD);
    await userEvent.click(screen.getByTestId('change-password-submit'));

    expect(await screen.findByText('Current password is incorrect.')).toBeInTheDocument();
  });
});
