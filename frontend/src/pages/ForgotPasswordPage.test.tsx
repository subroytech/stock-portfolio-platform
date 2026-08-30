import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import * as client from '../api/client';
import ForgotPasswordPage from './ForgotPasswordPage';

const CHALLENGE_QUESTIONS = Array.from({ length: 4 }, (_, i) => ({ id: `q${i + 1}`, questionText: `Question ${i + 1}` }));
const VALID_PASSWORD = 'Br4nd!NewPasswordXY';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ForgotPasswordPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ForgotPasswordPage', () => {
  beforeEach(() => vi.restoreAllMocks());

  test('full happy path: email -> 4 questions -> new password -> done', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/auth/forgot-password/start' && options?.method === 'POST') {
        return Promise.resolve({ challengeToken: 'challenge-abc', questions: CHALLENGE_QUESTIONS });
      }
      if (url === '/auth/forgot-password/verify' && options?.method === 'POST') {
        const body = JSON.parse(options.body as string);
        expect(body.challengeToken).toBe('challenge-abc');
        expect(body.answers).toHaveLength(4);
        return Promise.resolve({ resetToken: 'reset-xyz' });
      }
      if (url === '/auth/forgot-password/reset' && options?.method === 'POST') {
        const body = JSON.parse(options.body as string);
        expect(body).toEqual({ resetToken: 'reset-xyz', newPassword: VALID_PASSWORD });
        return Promise.resolve({ success: true });
      }
      return Promise.resolve({});
    });

    renderPage();

    await userEvent.type(screen.getByTestId('forgot-password-email'), 'jordan@example.com');
    await userEvent.click(screen.getByTestId('forgot-password-start-submit'));

    for (const q of CHALLENGE_QUESTIONS) {
      expect(await screen.findByTestId(`forgot-password-answer-${q.id}`)).toBeInTheDocument();
      await userEvent.type(screen.getByTestId(`forgot-password-answer-${q.id}`), 'myanswer');
    }
    await userEvent.click(screen.getByTestId('forgot-password-verify-submit'));

    await screen.findByTestId('forgot-password-new-password');
    await userEvent.type(screen.getByTestId('forgot-password-new-password'), VALID_PASSWORD);
    await userEvent.type(screen.getByTestId('forgot-password-confirm-password'), VALID_PASSWORD);
    await userEvent.click(screen.getByTestId('forgot-password-reset-submit'));

    expect(await screen.findByTestId('forgot-password-done')).toBeInTheDocument();
  });

  test('an unknown email shows the backend 404 error inline and does not advance', async () => {
    vi.spyOn(client, 'apiFetch').mockRejectedValue(new client.ApiError(404, 'No account found with that email.', null));
    renderPage();

    await userEvent.type(screen.getByTestId('forgot-password-email'), 'nobody@example.com');
    await userEvent.click(screen.getByTestId('forgot-password-start-submit'));

    expect(await screen.findByText('No account found with that email.')).toBeInTheDocument();
    expect(screen.queryByTestId('forgot-password-answer-q1')).not.toBeInTheDocument();
  });

  test('a wrong-answer verification shows the generic error and stays on the questions step', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/auth/forgot-password/start' && options?.method === 'POST') {
        return Promise.resolve({ challengeToken: 'challenge-abc', questions: CHALLENGE_QUESTIONS });
      }
      if (url === '/auth/forgot-password/verify' && options?.method === 'POST') {
        return Promise.reject(new client.ApiError(401, 'One or more answers were incorrect.', null));
      }
      return Promise.resolve({});
    });

    renderPage();
    await userEvent.type(screen.getByTestId('forgot-password-email'), 'jordan@example.com');
    await userEvent.click(screen.getByTestId('forgot-password-start-submit'));

    for (const q of CHALLENGE_QUESTIONS) {
      await screen.findByTestId(`forgot-password-answer-${q.id}`);
      await userEvent.type(screen.getByTestId(`forgot-password-answer-${q.id}`), 'wronganswer');
    }
    await userEvent.click(screen.getByTestId('forgot-password-verify-submit'));

    expect(await screen.findByText('One or more answers were incorrect.')).toBeInTheDocument();
    expect(screen.getByTestId('forgot-password-answer-q1')).toBeInTheDocument(); // still on the questions step
  });
});
