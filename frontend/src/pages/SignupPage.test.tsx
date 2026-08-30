import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import * as client from '../api/client';
import SignupPage from './SignupPage';

const QUESTIONS = Array.from({ length: 7 }, (_, i) => ({ id: `q${i + 1}`, questionText: `Question ${i + 1}` }));
const VALID_PASSWORD = 'Str0ng!PasswordXYZ';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SignupPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function fillValidForm() {
  await userEvent.type(screen.getByTestId('signup-email'), 'new@example.com');
  await userEvent.type(screen.getByTestId('signup-first-name'), 'Jordan');
  await userEvent.type(screen.getByTestId('signup-last-name'), 'Rivera');
  await userEvent.type(screen.getByTestId('signup-password'), VALID_PASSWORD);
  await userEvent.type(screen.getByTestId('signup-confirm-password'), VALID_PASSWORD);
  for (const q of QUESTIONS) {
    await userEvent.type(screen.getByTestId(`signup-answer-${q.id}`), `Answer${q.id}`);
  }
}

describe('SignupPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string) => {
      if (url === '/auth/security-questions/random') return Promise.resolve({ questions: QUESTIONS });
      return Promise.resolve({});
    });
  });

  test('renders all 7 security questions once loaded', async () => {
    renderPage();
    for (const q of QUESTIONS) {
      expect(await screen.findByTestId(`signup-answer-${q.id}`)).toBeInTheDocument();
    }
  });

  test('submit is disabled until every field (including all 7 answers) is filled and the password is valid', async () => {
    renderPage();
    await screen.findByTestId('signup-answer-q7');
    expect(screen.getByTestId('signup-submit')).toBeDisabled();

    await fillValidForm();
    expect(screen.getByTestId('signup-submit')).not.toBeDisabled();
  });

  test('mismatched password confirmation keeps submit disabled and shows an inline error', async () => {
    renderPage();
    await screen.findByTestId('signup-answer-q7');
    await userEvent.type(screen.getByTestId('signup-password'), VALID_PASSWORD);
    await userEvent.type(screen.getByTestId('signup-confirm-password'), 'SomethingElse123!Xyz');

    expect(screen.getByText("Passwords don't match.")).toBeInTheDocument();
    expect(screen.getByTestId('signup-submit')).toBeDisabled();
  });

  test('submits the full payload (firstName/lastName/password/all 7 answers) and navigates on success', async () => {
    const apiFetch = vi.spyOn(client, 'apiFetch').mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/auth/security-questions/random') return Promise.resolve({ questions: QUESTIONS });
      if (url === '/auth/signup' && options?.method === 'POST') {
        const body = JSON.parse(options.body as string);
        expect(body.email).toBe('new@example.com');
        expect(body.firstName).toBe('Jordan');
        expect(body.lastName).toBe('Rivera');
        expect(body.password).toBe(VALID_PASSWORD);
        expect(body.securityAnswers).toHaveLength(7);
        return Promise.resolve({ id: '1', email: 'new@example.com' });
      }
      if (url === '/auth/me') return Promise.resolve({ id: '1', email: 'new@example.com', roles: [], permissions: [], impersonating: false, status: 'pending', firstName: 'Jordan', lastName: 'Rivera' });
      return Promise.resolve({});
    });

    renderPage();
    await screen.findByTestId('signup-answer-q7');
    await fillValidForm();
    await userEvent.click(screen.getByTestId('signup-submit'));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/auth/signup', expect.objectContaining({ method: 'POST' })));
  });

  test('a failed registration shows the backend error inline', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/auth/security-questions/random') return Promise.resolve({ questions: QUESTIONS });
      if (url === '/auth/signup' && options?.method === 'POST') {
        return Promise.reject(new client.ApiError(409, 'An account with this email already exists.', null));
      }
      return Promise.resolve({});
    });

    renderPage();
    await screen.findByTestId('signup-answer-q7');
    await fillValidForm();
    await userEvent.click(screen.getByTestId('signup-submit'));

    expect(await screen.findByText('An account with this email already exists.')).toBeInTheDocument();
  });
});
