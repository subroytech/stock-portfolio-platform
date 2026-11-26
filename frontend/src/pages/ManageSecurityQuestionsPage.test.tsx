import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import * as client from '../api/client';
import ManageSecurityQuestionsPage from './ManageSecurityQuestionsPage';

const ALL_15 = Array.from({ length: 15 }, (_, i) => ({ id: `q${i + 1}`, questionText: `Question ${i + 1}` }));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ManageSecurityQuestionsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function pickAndAnswerFiveSlots() {
  for (let i = 0; i < 5; i++) {
    const questionId = `q${i + 1}`;
    await userEvent.selectOptions(screen.getByTestId(`security-question-slot-${i}`), questionId);
    await userEvent.type(screen.getByTestId(`security-question-answer-${questionId}`), 'answer');
  }
}

describe('ManageSecurityQuestionsPage', () => {
  beforeEach(() => vi.restoreAllMocks());

  test('pre-fills the account\'s existing questions into the first slots once loaded', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string) => {
      if (url === '/auth/security-questions') return Promise.resolve({ questions: ALL_15 });
      if (url === '/auth/security-questions/mine') return Promise.resolve({ questions: [ALL_15[2], ALL_15[5]] });
      return Promise.resolve({});
    });

    renderPage();
    expect(await screen.findByTestId('security-question-slot-0')).toHaveValue('q3');
    expect(screen.getByTestId('security-question-slot-1')).toHaveValue('q6');
    expect(screen.getByTestId('security-question-slot-2')).toHaveValue('');
    expect(screen.getByTestId('security-question-count')).toHaveTextContent('0 of 5 answered'); // pre-filled but not yet re-answered
  });

  test('shows a warning banner for an account with no questions set up yet (e.g. admin-created)', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string) => {
      if (url === '/auth/security-questions') return Promise.resolve({ questions: ALL_15 });
      if (url === '/auth/security-questions/mine') return Promise.resolve({ questions: [] });
      return Promise.resolve({});
    });

    renderPage();
    expect(await screen.findByTestId('security-questions-none-set')).toBeInTheDocument();
    expect(screen.getByTestId('security-question-slot-0')).toHaveValue('');
  });

  test('submit is disabled until current password + all 5 slots picked+re-answered', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string) => {
      if (url === '/auth/security-questions') return Promise.resolve({ questions: ALL_15 });
      if (url === '/auth/security-questions/mine') return Promise.resolve({ questions: [] });
      return Promise.resolve({});
    });

    renderPage();
    await screen.findByTestId('security-questions-none-set');
    expect(screen.getByTestId('security-questions-submit')).toBeDisabled();

    await pickAndAnswerFiveSlots();
    expect(screen.getByTestId('security-questions-submit')).toBeDisabled(); // still no current password

    await userEvent.type(screen.getByTestId('security-questions-current-password'), 'CorrectCurrent1!Xyz');
    expect(screen.getByTestId('security-questions-submit')).not.toBeDisabled();
  }, 15000);

  test('submits current password + the 7 chosen answers, shows success on completion', async () => {
    const apiFetch = vi.spyOn(client, 'apiFetch').mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/auth/security-questions' && !options) return Promise.resolve({ questions: ALL_15 });
      if (url === '/auth/security-questions/mine') return Promise.resolve({ questions: [] });
      if (url === '/auth/security-questions' && options?.method === 'PUT') {
        const body = JSON.parse(options.body as string);
        expect(body.currentPassword).toBe('CorrectCurrent1!Xyz');
        expect(body.securityAnswers).toHaveLength(5);
        return Promise.resolve({ success: true });
      }
      return Promise.resolve({});
    });

    renderPage();
    await screen.findByTestId('security-questions-none-set');
    await pickAndAnswerFiveSlots();
    await userEvent.type(screen.getByTestId('security-questions-current-password'), 'CorrectCurrent1!Xyz');
    await userEvent.click(screen.getByTestId('security-questions-submit'));

    expect(await screen.findByTestId('security-questions-success')).toBeInTheDocument();
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/auth/security-questions', expect.objectContaining({ method: 'PUT' })));
  }, 15000);

  test('a wrong current password shows the backend error inline', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/auth/security-questions' && !options) return Promise.resolve({ questions: ALL_15 });
      if (url === '/auth/security-questions/mine') return Promise.resolve({ questions: [] });
      if (url === '/auth/security-questions' && options?.method === 'PUT') {
        return Promise.reject(new client.ApiError(400, 'Current password is incorrect.', null));
      }
      return Promise.resolve({});
    });

    renderPage();
    await screen.findByTestId('security-questions-none-set');
    await pickAndAnswerFiveSlots();
    await userEvent.type(screen.getByTestId('security-questions-current-password'), 'WrongOne1!Xyz');
    await userEvent.click(screen.getByTestId('security-questions-submit'));

    expect(await screen.findByText('Current password is incorrect.')).toBeInTheDocument();
  }, 15000);
});
