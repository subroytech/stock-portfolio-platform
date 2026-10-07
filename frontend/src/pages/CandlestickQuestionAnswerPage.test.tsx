import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import * as client from '../api/client';
import { ApiError } from '../api/client';
import CandlestickQuestionAnswerPage from './CandlestickQuestionAnswerPage';

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

const ENTRIES = [
  { id: 'e1', patternId: 'p1', patternName: 'Doji', complexityTier: 'Simple', category: 'Definition', tier: 101, questionText: 'What is a Doji?', answerText: 'A Doji signals indecision.', status: 'Approved', createdBy: null, reviewedBy: null, reviewedAt: null, createdAt: 't1', updatedAt: 't1' },
  { id: 'e2', patternId: 'p2', patternName: 'Hammer', complexityTier: 'Simple', category: 'Definition', tier: 101, questionText: 'What is a Hammer?', answerText: 'A Hammer signals a possible reversal.', status: 'Approved', createdBy: null, reviewedBy: null, reviewedAt: null, createdAt: 't1', updatedAt: 't1' },
];

const TOP_QUESTIONS = [
  { questionText: 'Is Doji bullish or bearish?', answerText: 'Doji is neutral.', matchedPatternNames: ['Doji'], questionAskedCount: 12, lastAskedAt: 't1' },
  { questionText: 'Is Hammer bullish or bearish?', answerText: 'Hammer is bullish.', matchedPatternNames: ['Hammer'], questionAskedCount: 5, lastAskedAt: 't1' },
];

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <CandlestickQuestionAnswerPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CandlestickQuestionAnswerPage', () => {
  beforeEach(() => {
    // vi.spyOn reuses the same underlying spy across tests if not restored, so its .mock.calls
    // history persists between tests too - real breakage found live: adding the Back-link test
    // above (which also spies on apiFetch) inflated a later test's own call-count assertion.
    vi.restoreAllMocks();
    mockNavigate.mockClear();
  });

  test('without stock_analysis:view, the Back link reads "← Back" and navigates to the previous page in history', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({ entries: [] });
    renderPage();

    const back = await screen.findByTestId('candlestick-qa-back');
    expect(back).toHaveTextContent('← Back');
    await userEvent.click(back);

    expect(mockNavigate).toHaveBeenCalledWith(-1);
  });

  test('with stock_analysis:view, the Back link reads "← Charts" and navigates directly to /stock-analysis', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((path: string) => {
      if (path === '/auth/me') return Promise.resolve({ id: '1', email: 'a@b.com', roles: ['user'], permissions: ['stock_analysis:view'] });
      if (path.startsWith('/candlestick-question-answer/entries')) return Promise.resolve({ entries: [] });
      if (path === '/candlestick-question-answer/top-questions') return Promise.resolve({ questions: [] });
      return Promise.resolve({});
    });
    renderPage();

    // The session's own permissions resolve asynchronously (a separate query from the ones the
    // page's own data depends on), so the label can briefly render as the "← Back" default
    // before settling - wait for it to reflect the resolved session instead of asserting
    // immediately on the first (pre-session) render.
    const back = screen.getByTestId('candlestick-qa-back');
    await waitFor(() => expect(back).toHaveTextContent('← Charts'));
    await userEvent.click(back);

    expect(mockNavigate).toHaveBeenCalledWith('/stock-analysis');
  });

  test('browsing a curated question shows its answer inline, with no extra network call beyond the initial list fetch', async () => {
    const apiFetch = vi.spyOn(client, 'apiFetch').mockImplementation((path: string) => {
      if (path.startsWith('/candlestick-question-answer/entries')) return Promise.resolve({ entries: ENTRIES });
      return Promise.resolve({});
    });
    renderPage();

    const questionButton = await screen.findByTestId('candlestick-qa-entry-e1');
    expect(within(questionButton).getByText('Doji')).toBeInTheDocument();
    expect(within(questionButton).getByText('What is a Doji?')).toBeInTheDocument();
    expect(within(questionButton).getByTestId('category-badge')).toHaveAttribute('title', 'Definition');

    await userEvent.click(questionButton);

    expect(screen.getByTestId('candlestick-qa-selected-answer')).toHaveTextContent('A Doji signals indecision.');
    const diagram = screen.getByTestId('candlestick-pattern-diagram');
    expect(diagram).toBeInTheDocument();
    // The diagram's own column takes 25% of the answer row's width, per explicit direction that
    // it must be prominent rather than a tiny, easy-to-miss icon.
    expect(diagram.parentElement).toHaveClass('w-1/4');
    // Only the initial browse-list fetch fired - selecting an entry is a pure client-side
    // reveal, never a second round-trip (the picker's whole point is zero LLM cost).
    const entryCalls = apiFetch.mock.calls.filter(([p]) => (p as string).startsWith('/candlestick-question-answer/entries'));
    expect(entryCalls).toHaveLength(1);
  });

  test('the answer renders directly under its own question, not in a separate block at the bottom', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((path: string) => {
      if (path.startsWith('/candlestick-question-answer/entries')) return Promise.resolve({ entries: ENTRIES });
      return Promise.resolve({});
    });
    renderPage();

    await userEvent.click(await screen.findByTestId('candlestick-qa-entry-e1'));

    const answer = screen.getByTestId('candlestick-qa-selected-answer');
    const question = screen.getByTestId('candlestick-qa-entry-e1');
    // The answer's row is the very next row after the question it belongs to, not appended
    // after the whole table.
    expect(question.nextElementSibling).toBe(answer.closest('tr'));
  });

  test('clicking a different question switches which one is expanded - only one open at a time', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((path: string) => {
      if (path.startsWith('/candlestick-question-answer/entries')) return Promise.resolve({ entries: ENTRIES });
      return Promise.resolve({});
    });
    renderPage();

    await userEvent.click(await screen.findByTestId('candlestick-qa-entry-e1'));
    expect(screen.getByTestId('candlestick-qa-entry-e1').nextElementSibling).toContainElement(screen.getByTestId('candlestick-qa-selected-answer'));

    await userEvent.click(screen.getByTestId('candlestick-qa-entry-e2'));
    expect(screen.getAllByTestId('candlestick-qa-selected-answer')).toHaveLength(1);
    expect(screen.getByTestId('candlestick-qa-entry-e2').nextElementSibling).toContainElement(screen.getByTestId('candlestick-qa-selected-answer'));
  });

  test('clicking an already-expanded question collapses it back', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((path: string) => {
      if (path.startsWith('/candlestick-question-answer/entries')) return Promise.resolve({ entries: ENTRIES });
      return Promise.resolve({});
    });
    renderPage();

    const question = await screen.findByTestId('candlestick-qa-entry-e1');
    await userEvent.click(question);
    expect(screen.getByTestId('candlestick-qa-selected-answer')).toBeInTheDocument();

    await userEvent.click(question);
    expect(screen.queryByTestId('candlestick-qa-selected-answer')).not.toBeInTheDocument();
  });

  test('the Pattern column filter narrows the table to just that pattern', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((path: string) => {
      if (path.startsWith('/candlestick-question-answer/entries')) return Promise.resolve({ entries: ENTRIES });
      return Promise.resolve({});
    });
    renderPage();
    await screen.findByTestId('candlestick-qa-entry-e1');
    expect(screen.getByTestId('candlestick-qa-entry-e2')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('candlestick-qa-pattern-filter'));
    await userEvent.click(within(screen.getByTestId('candlestick-qa-pattern-filter-menu')).getByText('Doji'));

    expect(screen.getByTestId('candlestick-qa-entry-e1')).toBeInTheDocument();
    expect(screen.queryByTestId('candlestick-qa-entry-e2')).not.toBeInTheDocument();
  });

  test('the Category column filter narrows the table to just that category', async () => {
    const entries = [
      ...ENTRIES,
      { id: 'e3', patternId: 'p1', patternName: 'Doji', complexityTier: 'Simple', category: 'Reliability', tier: 201, questionText: 'How reliable is a Doji?', answerText: 'Moderately reliable.', status: 'Approved', createdBy: null, reviewedBy: null, reviewedAt: null, createdAt: 't1', updatedAt: 't1' },
    ];
    vi.spyOn(client, 'apiFetch').mockImplementation((path: string) => {
      if (path.startsWith('/candlestick-question-answer/entries')) return Promise.resolve({ entries });
      return Promise.resolve({});
    });
    renderPage();
    await screen.findByTestId('candlestick-qa-entry-e1');

    await userEvent.click(screen.getByTestId('candlestick-qa-category-filter'));
    await userEvent.click(within(screen.getByTestId('candlestick-qa-category-filter-menu')).getByText('Reliability'));

    expect(screen.getByTestId('candlestick-qa-entry-e3')).toBeInTheDocument();
    expect(screen.queryByTestId('candlestick-qa-entry-e1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('candlestick-qa-entry-e2')).not.toBeInTheDocument();
  });

  test('the Complexity column filter narrows the table to just that tier', async () => {
    const entries = [
      ...ENTRIES, // both Simple (Doji, Hammer)
      { id: 'e4', patternId: 'p3', patternName: 'Morning Star', complexityTier: 'Advanced', category: 'Definition', tier: 101, questionText: 'What is a Morning Star?', answerText: 'A three-candle bullish reversal.', status: 'Approved', createdBy: null, reviewedBy: null, reviewedAt: null, createdAt: 't1', updatedAt: 't1' },
    ];
    vi.spyOn(client, 'apiFetch').mockImplementation((path: string) => {
      if (path.startsWith('/candlestick-question-answer/entries')) return Promise.resolve({ entries });
      return Promise.resolve({});
    });
    renderPage();
    await screen.findByTestId('candlestick-qa-entry-e1');

    await userEvent.click(screen.getByTestId('candlestick-qa-complexity-filter'));
    await userEvent.click(within(screen.getByTestId('candlestick-qa-complexity-filter-menu')).getByText('Advanced'));

    expect(screen.getByTestId('candlestick-qa-entry-e4')).toBeInTheDocument();
    expect(screen.queryByTestId('candlestick-qa-entry-e1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('candlestick-qa-entry-e2')).not.toBeInTheDocument();
  });

  test('the Complexity filter only offers tiers actually present in the loaded data', async () => {
    // Every fixture entry is a Simple-tier pattern, so Composite/Advanced would be dead-end picks.
    vi.spyOn(client, 'apiFetch').mockImplementation((path: string) => {
      if (path.startsWith('/candlestick-question-answer/entries')) return Promise.resolve({ entries: ENTRIES });
      return Promise.resolve({});
    });
    renderPage();
    await screen.findByTestId('candlestick-qa-entry-e1');

    await userEvent.click(screen.getByTestId('candlestick-qa-complexity-filter'));
    const menu = within(screen.getByTestId('candlestick-qa-complexity-filter-menu'));
    expect(menu.getByText('Simple')).toBeInTheDocument();
    expect(menu.queryByText('Composite')).not.toBeInTheDocument();
    expect(menu.queryByText('Advanced')).not.toBeInTheDocument();
  });

  test('Complexity and Category filters combine rather than replacing each other', async () => {
    const entries = [
      ...ENTRIES,
      { id: 'e5', patternId: 'p3', patternName: 'Morning Star', complexityTier: 'Advanced', category: 'Definition', tier: 101, questionText: 'What is a Morning Star?', answerText: 'A three-candle bullish reversal.', status: 'Approved', createdBy: null, reviewedBy: null, reviewedAt: null, createdAt: 't1', updatedAt: 't1' },
      { id: 'e6', patternId: 'p3', patternName: 'Morning Star', complexityTier: 'Advanced', category: 'Reliability', tier: 201, questionText: 'How reliable is a Morning Star?', answerText: 'More reliable than a single candle.', status: 'Approved', createdBy: null, reviewedBy: null, reviewedAt: null, createdAt: 't1', updatedAt: 't1' },
    ];
    vi.spyOn(client, 'apiFetch').mockImplementation((path: string) => {
      if (path.startsWith('/candlestick-question-answer/entries')) return Promise.resolve({ entries });
      return Promise.resolve({});
    });
    renderPage();
    await screen.findByTestId('candlestick-qa-entry-e1');

    await userEvent.click(screen.getByTestId('candlestick-qa-complexity-filter'));
    await userEvent.click(within(screen.getByTestId('candlestick-qa-complexity-filter-menu')).getByText('Advanced'));
    await userEvent.click(screen.getByTestId('candlestick-qa-category-filter'));
    await userEvent.click(within(screen.getByTestId('candlestick-qa-category-filter-menu')).getByText('Reliability'));

    // Only the entry matching BOTH filters survives.
    expect(screen.getByTestId('candlestick-qa-entry-e6')).toBeInTheDocument();
    expect(screen.queryByTestId('candlestick-qa-entry-e5')).not.toBeInTheDocument();
    expect(screen.queryByTestId('candlestick-qa-entry-e1')).not.toBeInTheDocument();
  });

  test('typing in the browse search re-queries the curated list', async () => {
    const apiFetch = vi.spyOn(client, 'apiFetch').mockResolvedValue({ entries: [] });
    renderPage();
    await screen.findByTestId('candlestick-qa-browse-search');

    await userEvent.type(screen.getByTestId('candlestick-qa-browse-search'), 'hammer');

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining('query=hammer')));
  });

  test('asking a question that resolves from the curated DB renders the answer alongside a pattern diagram', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((path: string, init?: RequestInit) => {
      if (path.startsWith('/candlestick-question-answer/entries')) return Promise.resolve({ entries: [] });
      if (path === '/candlestick-question-answer/ask' && init?.method === 'POST') {
        return Promise.resolve({ outcome: 'answered_from_kb', answer: 'A Doji signals indecision.', matchedEntryIds: ['e1'], matchedPatterns: ['Doji'], reason: null });
      }
      return Promise.resolve({});
    });
    renderPage();

    await userEvent.type(await screen.findByTestId('candlestick-qa-question-input'), 'What is a Doji?');
    await userEvent.click(screen.getByTestId('candlestick-qa-ask-button'));

    const answer = await screen.findByTestId('candlestick-qa-answer');
    expect(answer).toHaveTextContent('A Doji signals indecision.');
    expect(screen.queryByTestId('candlestick-qa-unable-to-answer')).not.toBeInTheDocument();
    expect(screen.getByTestId('candlestick-pattern-diagram')).toBeInTheDocument();
  });

  test('an unable_to_answer outcome shows the honest fallback message, not a fabricated answer', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((path: string, init?: RequestInit) => {
      if (path.startsWith('/candlestick-question-answer/entries')) return Promise.resolve({ entries: [] });
      if (path === '/candlestick-question-answer/ask' && init?.method === 'POST') {
        return Promise.resolve({ outcome: 'unable_to_answer', answer: null, matchedEntryIds: [], reason: 'Not covered yet.' });
      }
      return Promise.resolve({});
    });
    renderPage();

    await userEvent.type(await screen.findByTestId('candlestick-qa-question-input'), 'What is the meaning of life?');
    await userEvent.click(screen.getByTestId('candlestick-qa-ask-button'));

    expect(await screen.findByTestId('candlestick-qa-unable-to-answer')).toHaveTextContent('Not covered yet.');
    expect(screen.queryByTestId('candlestick-qa-answer')).not.toBeInTheDocument();
  });

  test('a 429 rate-limit error surfaces the backend\'s own message', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((path: string, init?: RequestInit) => {
      if (path.startsWith('/candlestick-question-answer/entries')) return Promise.resolve({ entries: [] });
      if (path === '/candlestick-question-answer/ask' && init?.method === 'POST') {
        return Promise.reject(new ApiError(429, "You've reached the limit of 10 questions per 10 minutes. Please try again shortly.", null));
      }
      return Promise.resolve({});
    });
    renderPage();

    await userEvent.type(await screen.findByTestId('candlestick-qa-question-input'), 'What is a Doji?');
    await userEvent.click(screen.getByTestId('candlestick-qa-ask-button'));

    expect(await screen.findByTestId('candlestick-qa-ask-error')).toHaveTextContent(/reached the limit of 10 questions/);
  });

  test('the Ask button is disabled while the question field is empty', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({ entries: [] });
    renderPage();
    await screen.findByTestId('candlestick-qa-question-input');

    expect(screen.getByTestId('candlestick-qa-ask-button')).toBeDisabled();
  });

  test('lays out as two columns - Browse Curated Questions on its own, and Ask Your Own Question above Popular Questions (2026-10-07, explicit direction)', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({ entries: [] });
    renderPage();
    await screen.findByTestId('candlestick-qa-question-input');

    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['Browse Curated Questions', 'Ask Your Own Question', 'Popular Questions']);
  });

  describe('Popular Questions', () => {
    test('lists cached questions with their ask count, with no answer shown until clicked', async () => {
      vi.spyOn(client, 'apiFetch').mockImplementation((path: string) => {
        if (path.startsWith('/candlestick-question-answer/entries')) return Promise.resolve({ entries: [] });
        if (path === '/candlestick-question-answer/top-questions') return Promise.resolve({ questions: TOP_QUESTIONS });
        return Promise.resolve({});
      });
      renderPage();

      const row = await screen.findByTestId('candlestick-qa-top-question-0');
      expect(row).toHaveTextContent('Is Doji bullish or bearish?');
      expect(row).toHaveTextContent('12×');
      expect(screen.queryByTestId('candlestick-qa-top-question-answer-0')).not.toBeInTheDocument();
    });

    test('clicking a question expands its already-fetched answer, with no extra network call', async () => {
      const apiFetch = vi.spyOn(client, 'apiFetch').mockImplementation((path: string) => {
        if (path.startsWith('/candlestick-question-answer/entries')) return Promise.resolve({ entries: [] });
        if (path === '/candlestick-question-answer/top-questions') return Promise.resolve({ questions: TOP_QUESTIONS });
        return Promise.resolve({});
      });
      renderPage();
      const row = await screen.findByTestId('candlestick-qa-top-question-0');

      await userEvent.click(row);

      expect(screen.getByTestId('candlestick-qa-top-question-answer-0')).toHaveTextContent('Doji is neutral.');
      const topQuestionCalls = apiFetch.mock.calls.filter(([p]) => (p as string) === '/candlestick-question-answer/top-questions');
      expect(topQuestionCalls).toHaveLength(1);
    });

    test('clicking an already-expanded question collapses it back', async () => {
      vi.spyOn(client, 'apiFetch').mockImplementation((path: string) => {
        if (path.startsWith('/candlestick-question-answer/entries')) return Promise.resolve({ entries: [] });
        if (path === '/candlestick-question-answer/top-questions') return Promise.resolve({ questions: TOP_QUESTIONS });
        return Promise.resolve({});
      });
      renderPage();
      const row = await screen.findByTestId('candlestick-qa-top-question-0');

      await userEvent.click(row);
      expect(screen.getByTestId('candlestick-qa-top-question-answer-0')).toBeInTheDocument();

      await userEvent.click(row);
      expect(screen.queryByTestId('candlestick-qa-top-question-answer-0')).not.toBeInTheDocument();
    });

    test('shows a friendly empty state when no questions have been asked yet', async () => {
      vi.spyOn(client, 'apiFetch').mockImplementation((path: string) => {
        if (path.startsWith('/candlestick-question-answer/entries')) return Promise.resolve({ entries: [] });
        if (path === '/candlestick-question-answer/top-questions') return Promise.resolve({ questions: [] });
        return Promise.resolve({});
      });
      renderPage();

      expect(await screen.findByText('No questions asked yet.')).toBeInTheDocument();
    });
  });
});
