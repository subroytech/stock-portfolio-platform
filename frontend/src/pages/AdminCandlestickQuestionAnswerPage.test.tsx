import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import * as client from '../api/client';
import AdminCandlestickQuestionAnswerPage from './AdminCandlestickQuestionAnswerPage';

const PATTERNS = [
  { id: 'p1', patternName: 'Doji', formationDescription: 'desc', status: 'active', relevantHorizons: ['dayTrading', 'mediumTerm'], createdAt: 't1', updatedAt: 't1' },
];

const ENTRIES = [
  { id: 'e1', patternId: 'p1', patternName: 'Doji', category: 'Definition', tier: 101, questionText: 'What is a Doji?', answerText: 'A Doji is...', status: 'Approved', createdBy: null, reviewedBy: null, reviewedAt: null, createdAt: 't1', updatedAt: 't1' },
];

const TEMPLATES = [
  {
    id: 't1', templateKey: 'bias_lookup', regexPattern: 'is (.+?) bullish or bearish\\??$',
    responseMode: 'single', filterMapping: { fixedFilters: {}, groupFilters: { '1': 'patternNameOrSynonym' } },
    answerTemplate: '{patternName} is {directionalBias}.', status: 'active', createdAt: 't1', updatedAt: 't1',
  },
];

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AdminCandlestickQuestionAnswerPage />
    </QueryClientProvider>,
  );
}

function mockRoutedFetch(overrides: Record<string, unknown> = {}) {
  return vi.spyOn(client, 'apiFetch').mockImplementation((path: string, init?: RequestInit) => {
    if (path === '/candlestick-question-answer/patterns' && !init) return Promise.resolve({ patterns: overrides.patterns ?? PATTERNS });
    if (path === '/candlestick-question-answer/admin/entries') return Promise.resolve({ entries: overrides.entries ?? ENTRIES });
    if (path === '/candlestick-question-answer/patterns' && init?.method === 'POST') return Promise.resolve({ pattern: { id: 'p2' } });
    if (path === '/candlestick-question-answer/entries' && init?.method === 'POST') return Promise.resolve({ entry: { id: 'e2' } });
    if (path === '/candlestick-question-answer/templates' && !init) return Promise.resolve({ templates: overrides.templates ?? TEMPLATES });
    if (path === '/candlestick-question-answer/templates' && init?.method === 'POST') return Promise.resolve({ template: { id: 't2' } });
    if (path?.endsWith('/status') && init?.method === 'PUT') return Promise.resolve({ success: true });
    return Promise.resolve({});
  });
}

describe('AdminCandlestickQuestionAnswerPage', () => {
  beforeEach(() => vi.restoreAllMocks());

  describe('New Pattern - Relevant Horizons', () => {
    test('Create Pattern is disabled until at least one horizon is checked', async () => {
      mockRoutedFetch();
      renderPage();
      await userEvent.type(screen.getByTestId('candlestick-qa-new-pattern-name'), 'Hanging Man');
      await userEvent.type(screen.getByTestId('candlestick-qa-new-pattern-description'), 'A bearish reversal shape.');

      expect(screen.getByTestId('candlestick-qa-create-pattern-button')).toBeDisabled();

      await userEvent.click(screen.getByTestId('candlestick-qa-new-pattern-horizon-dayTrading'));
      expect(screen.getByTestId('candlestick-qa-create-pattern-button')).not.toBeDisabled();
    });

    test('submits the checked horizons as relevantHorizons', async () => {
      const apiFetch = mockRoutedFetch();
      renderPage();
      await userEvent.type(screen.getByTestId('candlestick-qa-new-pattern-name'), 'Hanging Man');
      await userEvent.type(screen.getByTestId('candlestick-qa-new-pattern-description'), 'A bearish reversal shape.');
      await userEvent.click(screen.getByTestId('candlestick-qa-new-pattern-horizon-dayTrading'));
      await userEvent.click(screen.getByTestId('candlestick-qa-new-pattern-horizon-mediumTerm'));

      await userEvent.click(screen.getByTestId('candlestick-qa-create-pattern-button'));

      expect(apiFetch).toHaveBeenCalledWith('/candlestick-question-answer/patterns', {
        method: 'POST',
        body: JSON.stringify({
          patternName: 'Hanging Man', formationDescription: 'A bearish reversal shape.',
          relevantHorizons: ['dayTrading', 'mediumTerm'], complexityTier: 'Simple',
        }),
      });
    });

    test('submits the selected complexity tier, defaulting to Simple', async () => {
      const apiFetch = mockRoutedFetch();
      renderPage();
      await userEvent.type(screen.getByTestId('candlestick-qa-new-pattern-name'), 'Morning Star');
      await userEvent.type(screen.getByTestId('candlestick-qa-new-pattern-description'), 'A three-candle bullish reversal.');
      await userEvent.click(screen.getByTestId('candlestick-qa-new-pattern-horizon-mediumTerm'));

      // Defaults to Simple (matching the column's own DB default) until explicitly changed.
      expect(screen.getByTestId('candlestick-qa-new-pattern-complexity')).toHaveValue('Simple');
      await userEvent.selectOptions(screen.getByTestId('candlestick-qa-new-pattern-complexity'), 'Advanced');

      await userEvent.click(screen.getByTestId('candlestick-qa-create-pattern-button'));

      expect(apiFetch).toHaveBeenCalledWith('/candlestick-question-answer/patterns', {
        method: 'POST',
        body: JSON.stringify({
          patternName: 'Morning Star', formationDescription: 'A three-candle bullish reversal.',
          relevantHorizons: ['mediumTerm'], complexityTier: 'Advanced',
        }),
      });
    });

    test('unchecking a horizon removes it from the submitted list', async () => {
      const apiFetch = mockRoutedFetch();
      renderPage();
      await userEvent.type(screen.getByTestId('candlestick-qa-new-pattern-name'), 'Hanging Man');
      await userEvent.type(screen.getByTestId('candlestick-qa-new-pattern-description'), 'desc');
      await userEvent.click(screen.getByTestId('candlestick-qa-new-pattern-horizon-dayTrading'));
      await userEvent.click(screen.getByTestId('candlestick-qa-new-pattern-horizon-longTerm'));
      await userEvent.click(screen.getByTestId('candlestick-qa-new-pattern-horizon-longTerm')); // uncheck

      await userEvent.click(screen.getByTestId('candlestick-qa-create-pattern-button'));

      const postCall = apiFetch.mock.calls.find(([p, init]) => p === '/candlestick-question-answer/patterns' && (init as RequestInit)?.method === 'POST');
      expect(postCall).toBeDefined();
      const init = postCall![1] as RequestInit;
      const body = JSON.parse(init.body as string);
      expect(body.relevantHorizons).toEqual(['dayTrading']);
    });
  });

  describe('New Q&A Entry - Category', () => {
    test('offers all 5 categories in the fixed Definition -> ... -> Common Mistakes order', async () => {
      mockRoutedFetch();
      renderPage();
      const select = await screen.findByTestId('candlestick-qa-entry-category-select');
      const options = within(select).getAllByRole('option').map((o) => o.textContent);
      expect(options).toEqual(['Definition', 'Interpretation', 'Reliability', 'How to Use', 'Common Mistakes']);
    });

    test('submits the selected category (not a horizon)', async () => {
      const apiFetch = mockRoutedFetch();
      renderPage();
      await screen.findByRole('option', { name: 'Doji' }); // wait for the pattern list to load
      await userEvent.selectOptions(screen.getByTestId('candlestick-qa-entry-pattern-select'), 'p1');
      await userEvent.selectOptions(screen.getByTestId('candlestick-qa-entry-category-select'), 'Reliability');
      await userEvent.type(screen.getByTestId('candlestick-qa-entry-question'), 'How reliable is a Doji?');
      await userEvent.type(screen.getByTestId('candlestick-qa-entry-answer'), 'It depends on context.');

      await userEvent.click(screen.getByTestId('candlestick-qa-create-entry-button'));

      expect(apiFetch).toHaveBeenCalledWith('/candlestick-question-answer/entries', {
        method: 'POST',
        body: JSON.stringify({
          patternId: 'p1', category: 'Reliability', tier: 101,
          questionText: 'How reliable is a Doji?', answerText: 'It depends on context.',
        }),
      });
    });
  });

  describe('All Entries table', () => {
    test('shows the Category column (as a colored letter badge) instead of Horizon', async () => {
      mockRoutedFetch();
      renderPage();
      const row = await screen.findByTestId('candlestick-qa-admin-row-e1');
      const badge = within(row).getByTestId('category-badge');
      expect(badge).toHaveTextContent('D');
      expect(badge).toHaveAttribute('title', 'Definition');
      expect(screen.getByText('Category')).toBeInTheDocument();
      expect(screen.queryByText('Horizon')).not.toBeInTheDocument();
    });
  });

  describe('Question Templates', () => {
    test('lists the existing templates with their key, mode, and status', async () => {
      mockRoutedFetch();
      renderPage();

      const row = await screen.findByTestId('candlestick-qa-template-row-t1');
      expect(within(row).getByText('bias_lookup')).toBeInTheDocument();
      expect(within(row).getByText('single')).toBeInTheDocument();
      expect(within(row).getByText('active')).toBeInTheDocument();
    });

    test('creates a new template from the form, including the default filterMapping JSON', async () => {
      const apiFetch = mockRoutedFetch();
      renderPage();
      await screen.findByTestId('candlestick-qa-template-row-t1');

      // Leaves the filterMapping textarea at its pre-filled default (already valid JSON,
      // and the same shape mirror_lookup itself needs - a single capture-group lookup) to avoid
      // fighting userEvent.type's own curly-brace escaping syntax for a JSON-content textarea.
      await userEvent.type(screen.getByTestId('candlestick-qa-new-template-key'), 'mirror_lookup');
      await userEvent.type(screen.getByTestId('candlestick-qa-new-template-regex'), 'mirror lookup regex');
      await userEvent.type(screen.getByTestId('candlestick-qa-new-template-answer'), 'The mirror answer.');

      await userEvent.click(screen.getByTestId('candlestick-qa-create-template-button'));

      expect(apiFetch).toHaveBeenCalledWith('/candlestick-question-answer/templates', {
        method: 'POST',
        body: JSON.stringify({
          templateKey: 'mirror_lookup',
          regexPattern: 'mirror lookup regex',
          responseMode: 'single',
          filterMapping: { fixedFilters: {}, groupFilters: { '1': 'patternNameOrSynonym' } },
          answerTemplate: 'The mirror answer.',
        }),
      });
    });

    test('shows a JSON error and does not submit when filterMapping is invalid', async () => {
      const apiFetch = mockRoutedFetch();
      renderPage();
      await screen.findByTestId('candlestick-qa-template-row-t1');

      await userEvent.type(screen.getByTestId('candlestick-qa-new-template-key'), 'broken');
      await userEvent.type(screen.getByTestId('candlestick-qa-new-template-regex'), 'is (.+?)\\??$');
      await userEvent.clear(screen.getByTestId('candlestick-qa-new-template-filter-mapping'));
      await userEvent.type(screen.getByTestId('candlestick-qa-new-template-filter-mapping'), 'not valid json');
      await userEvent.type(screen.getByTestId('candlestick-qa-new-template-answer'), 'Answer text.');
      apiFetch.mockClear();

      await userEvent.click(screen.getByTestId('candlestick-qa-create-template-button'));

      expect(screen.getByText('filterMapping must be valid JSON.')).toBeInTheDocument();
      const postCall = apiFetch.mock.calls.find(([p, init]) => p === '/candlestick-question-answer/templates' && (init as RequestInit)?.method === 'POST');
      expect(postCall).toBeUndefined();
    });

    test('toggling a template\'s status sends the opposite of its current status', async () => {
      const apiFetch = mockRoutedFetch();
      renderPage();
      const row = await screen.findByTestId('candlestick-qa-template-row-t1');

      await userEvent.click(within(row).getByTestId('candlestick-qa-template-toggle-t1'));

      expect(apiFetch).toHaveBeenCalledWith('/candlestick-question-answer/templates/t1/status', {
        method: 'PUT',
        body: JSON.stringify({ status: 'inactive' }),
      });
    });
  });
});
