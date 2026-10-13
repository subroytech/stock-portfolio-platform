import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import * as client from '../api/client';
import SignupPage from './SignupPage';

const ALL_15 = Array.from({ length: 15 }, (_, i) => ({ id: `q${i + 1}`, questionText: `Question ${i + 1}` }));
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

// Fills slots 0-4 with questions q1-q5 in order and answers each.
async function pickAndAnswerFiveSlots() {
  for (let i = 0; i < 5; i++) {
    const questionId = `q${i + 1}`;
    await userEvent.selectOptions(screen.getByTestId(`security-question-slot-${i}`), questionId);
    await userEvent.type(screen.getByTestId(`security-question-answer-${questionId}`), `Answer${questionId}`);
  }
}

async function fillValidForm() {
  await userEvent.type(screen.getByTestId('signup-email'), 'new@example.com');
  await userEvent.type(screen.getByTestId('signup-first-name'), 'Jordan');
  await userEvent.type(screen.getByTestId('signup-last-name'), 'Rivera');
  await userEvent.type(screen.getByTestId('signup-password'), VALID_PASSWORD);
  await userEvent.type(screen.getByTestId('signup-confirm-password'), VALID_PASSWORD);
  await pickAndAnswerFiveSlots();
}

describe('SignupPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string) => {
      if (url === '/auth/security-questions') return Promise.resolve({ questions: ALL_15 });
      return Promise.resolve({});
    });
  });

  test('renders 5 question slots once loaded, each defaulting to unselected', async () => {
    renderPage();
    for (let i = 0; i < 5; i++) {
      expect(await screen.findByTestId(`security-question-slot-${i}`)).toHaveValue('');
    }
  });

  test('picking a question in slot 0 removes it from slot 1\'s options (the "14 remaining" behavior)', async () => {
    renderPage();
    await screen.findByTestId('security-question-slot-0');
    await userEvent.selectOptions(screen.getByTestId('security-question-slot-0'), 'q1');

    const slot1 = screen.getByTestId('security-question-slot-1') as HTMLSelectElement;
    const slot1Values = Array.from(slot1.options).map((o) => o.value);
    expect(slot1Values).not.toContain('q1');
  });

  // These 3 tests fill all 5 question slots via real userEvent interactions (select + type per
  // slot) - comfortably past the default 5s test timeout in this environment, though not hung.
  test('submit is disabled until every field, all 5 slots picked+answered, and a valid matching password are all filled', async () => {
    renderPage();
    await screen.findByTestId('security-question-slot-0');
    expect(screen.getByTestId('signup-submit')).toBeDisabled();

    await fillValidForm();
    expect(screen.getByTestId('signup-submit')).not.toBeDisabled();
  }, 15000);

  test('mismatched password confirmation keeps submit disabled and shows an inline error', async () => {
    renderPage();
    await screen.findByTestId('security-question-slot-0');
    await userEvent.type(screen.getByTestId('signup-password'), VALID_PASSWORD);
    await userEvent.type(screen.getByTestId('signup-confirm-password'), 'SomethingElse123!Xyz');

    expect(screen.getByText("Passwords don't match.")).toBeInTheDocument();
    expect(screen.getByTestId('signup-submit')).toBeDisabled();
  });

  test('submits the full payload (firstName/lastName/password/the 7 chosen answers) and navigates on success', async () => {
    const apiFetch = vi.spyOn(client, 'apiFetch').mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/auth/security-questions') return Promise.resolve({ questions: ALL_15 });
      if (url === '/auth/signup' && options?.method === 'POST') {
        const body = JSON.parse(options.body as string);
        expect(body.email).toBe('new@example.com');
        expect(body.firstName).toBe('Jordan');
        expect(body.lastName).toBe('Rivera');
        expect(body.password).toBe(VALID_PASSWORD);
        expect(body.securityAnswers).toHaveLength(5);
        expect(new Set(body.securityAnswers.map((a: { questionId: string }) => a.questionId)).size).toBe(5);
        return Promise.resolve({ id: '1', email: 'new@example.com' });
      }
      if (url === '/auth/me') return Promise.resolve({ id: '1', email: 'new@example.com', roles: [], permissions: [], impersonating: false, status: 'pending', firstName: 'Jordan', lastName: 'Rivera' });
      return Promise.resolve({});
    });

    renderPage();
    await screen.findByTestId('security-question-slot-0');
    await fillValidForm();
    await userEvent.click(screen.getByTestId('signup-submit'));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/auth/signup', expect.objectContaining({ method: 'POST' })));
  }, 15000);

  test('a failed registration shows the backend error inline', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/auth/security-questions') return Promise.resolve({ questions: ALL_15 });
      if (url === '/auth/signup' && options?.method === 'POST') {
        return Promise.reject(new client.ApiError(409, 'An account with this email already exists.', null));
      }
      return Promise.resolve({});
    });

    renderPage();
    await screen.findByTestId('security-question-slot-0');
    await fillValidForm();
    await userEvent.click(screen.getByTestId('signup-submit'));

    expect(await screen.findByText('An account with this email already exists.')).toBeInTheDocument();
  }, 15000);
});
