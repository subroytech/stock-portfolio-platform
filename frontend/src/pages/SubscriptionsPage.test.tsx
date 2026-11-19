import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, test, vi } from 'vitest';
import * as client from '../api/client';
import { ApiError } from '../api/client';
import SubscriptionsPage from './SubscriptionsPage';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SubscriptionsPage />
    </QueryClientProvider>,
  );
}

describe('SubscriptionsPage', () => {
  test('lists FMP, Finnhub, Anthropic, and OpenAI, each with its own consuming-feature note', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({ subscriptions: [] });
    renderPage();
    expect(await screen.findByText('FMP (Financial Modeling Prep)')).toBeInTheDocument();
    expect(screen.getByText('Finnhub')).toBeInTheDocument();
    expect(screen.getByText('used by Long-Term Analysis for news')).toBeInTheDocument();
    expect(screen.getByText('Anthropic (Claude)')).toBeInTheDocument();
    expect(screen.getByText("used by Candlestick Pattern Q&A's free-text Ask, when the admin-configured provider is Anthropic")).toBeInTheDocument();
    expect(screen.getByText('OpenAI')).toBeInTheDocument();
    expect(screen.getByText("used by Candlestick Pattern Q&A's free-text Ask, when the admin-configured provider is OpenAI")).toBeInTheDocument();
  });

  test('shows the masked key when a subscription already exists', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({
      subscriptions: [{
        provider: 'fmp', maskedKey: '••••••••wxyz', planTier: null, status: 'active',
        renewalDate: null, createdAt: 't1', updatedAt: 't1',
      }],
    });
    renderPage();
    await waitFor(() => expect(screen.getByText(/Key on file: ••••••••wxyz/)).toBeInTheDocument());
  });

  describe('"Get Allowed Models"', () => {
    test('is shown for Anthropic/OpenAI but not FMP/Finnhub while editing', async () => {
      vi.spyOn(client, 'apiFetch').mockResolvedValue({ subscriptions: [] });
      renderPage();
      await screen.findByText('FMP (Financial Modeling Prep)');

      await userEvent.click(screen.getAllByText('Add key')[0]); // fmp row
      expect(screen.queryByTestId('get-allowed-models-fmp')).not.toBeInTheDocument();

      await userEvent.click(screen.getAllByText('Add key')[2]); // anthropic row
      expect(await screen.findByTestId('get-allowed-models-anthropic')).toBeInTheDocument();
    });

    test('disabled until a key is typed, then calls the endpoint and lists the returned models', async () => {
      const apiFetch = vi.spyOn(client, 'apiFetch').mockImplementation((path: string, init?: RequestInit) => {
        if (path === '/subscriptions') return Promise.resolve({ subscriptions: [] });
        if (path === '/subscriptions/anthropic/models' && init?.method === 'POST') {
          return Promise.resolve({ models: ['claude-haiku-4-5', 'claude-sonnet-5'] });
        }
        return Promise.resolve({});
      });
      renderPage();
      await screen.findByText('FMP (Financial Modeling Prep)');

      await userEvent.click(screen.getAllByText('Add key')[2]); // anthropic row
      const button = await screen.findByTestId('get-allowed-models-anthropic');
      expect(button).toBeDisabled();

      await userEvent.type(screen.getByPlaceholderText('Paste your API key'), 'sk-ant-real-key');
      expect(button).not.toBeDisabled();
      await userEvent.click(button);

      const result = await screen.findByTestId('allowed-models-result-anthropic');
      expect(result).toHaveTextContent('2 models');
      expect(result).toHaveTextContent('claude-haiku-4-5');
      expect(result).toHaveTextContent('claude-sonnet-5');
      expect(apiFetch).toHaveBeenCalledWith('/subscriptions/anthropic/models', {
        method: 'POST', body: JSON.stringify({ apiKey: 'sk-ant-real-key' }),
      });
    });

    test('the result includes a link to the provider\'s own pricing page, since costs aren\'t in the API response', async () => {
      vi.spyOn(client, 'apiFetch').mockImplementation((path: string, init?: RequestInit) => {
        if (path === '/subscriptions') return Promise.resolve({ subscriptions: [] });
        if (path === '/subscriptions/anthropic/models' && init?.method === 'POST') return Promise.resolve({ models: ['claude-sonnet-5'] });
        return Promise.resolve({});
      });
      renderPage();
      await screen.findByText('FMP (Financial Modeling Prep)');

      await userEvent.click(screen.getAllByText('Add key')[2]); // anthropic row
      await userEvent.type(screen.getByPlaceholderText('Paste your API key'), 'sk-ant-real-key');
      await userEvent.click(await screen.findByTestId('get-allowed-models-anthropic'));

      const result = await screen.findByTestId('allowed-models-result-anthropic');
      const link = result.querySelector('a');
      expect(link).toHaveAttribute('href', 'https://www.anthropic.com/pricing');
      expect(link).toHaveAttribute('target', '_blank');
    });

    test('shows the backend\'s own rejection message on a bad key', async () => {
      vi.spyOn(client, 'apiFetch').mockImplementation((path: string, init?: RequestInit) => {
        if (path === '/subscriptions') return Promise.resolve({ subscriptions: [] });
        if (path === '/subscriptions/openai/models' && init?.method === 'POST') {
          return Promise.reject(new ApiError(400, 'The API key was rejected by OpenAI (HTTP 401).', null));
        }
        return Promise.resolve({});
      });
      renderPage();
      await screen.findByText('FMP (Financial Modeling Prep)');

      await userEvent.click(screen.getAllByText('Add key')[3]); // openai row
      await userEvent.type(screen.getByPlaceholderText('Paste your API key'), 'sk-bad-key');
      await userEvent.click(await screen.findByTestId('get-allowed-models-openai'));

      expect(await screen.findByTestId('allowed-models-error-openai')).toHaveTextContent('rejected by OpenAI');
    });

    test('switching to a different provider row clears the previous result', async () => {
      vi.spyOn(client, 'apiFetch').mockImplementation((path: string, init?: RequestInit) => {
        if (path === '/subscriptions') return Promise.resolve({ subscriptions: [] });
        if (path === '/subscriptions/anthropic/models' && init?.method === 'POST') return Promise.resolve({ models: ['claude-sonnet-5'] });
        return Promise.resolve({});
      });
      renderPage();
      await screen.findByText('FMP (Financial Modeling Prep)');

      await userEvent.click(screen.getAllByText('Add key')[2]); // anthropic row
      await userEvent.type(screen.getByPlaceholderText('Paste your API key'), 'sk-ant-real-key');
      await userEvent.click(await screen.findByTestId('get-allowed-models-anthropic'));
      await screen.findByTestId('allowed-models-result-anthropic');

      await userEvent.click(screen.getAllByText('Add key')[3]); // switch to openai row

      expect(screen.queryByTestId('allowed-models-result-anthropic')).not.toBeInTheDocument();
    });
  });

  describe('"Check Saved Key"', () => {
    test('is only shown when a key is already on file for that provider', async () => {
      vi.spyOn(client, 'apiFetch').mockResolvedValue({
        subscriptions: [{ provider: 'anthropic', maskedKey: '••••••••abcd', planTier: null, status: 'active', renewalDate: null, createdAt: 't1', updatedAt: 't1' }],
      });
      renderPage();
      await screen.findByText('FMP (Financial Modeling Prep)');

      await userEvent.click(screen.getAllByText('Add key')[0]); // fmp row - no key on file, not a model-listing provider either
      expect(screen.queryByTestId('check-saved-key-fmp')).not.toBeInTheDocument();

      await userEvent.click(await screen.findByText('Update key')); // anthropic row - a key IS on file
      expect(await screen.findByTestId('check-saved-key-anthropic')).toBeInTheDocument();

      await userEvent.click(screen.getByText('Cancel'));
      // With anthropic showing "Update key" (a sub exists), the remaining "Add key" buttons are
      // fmp(0), finnhub(1), openai(2) in provider order.
      await userEvent.click(screen.getAllByText('Add key')[2]); // openai row - still "Add key", no sub
      expect(screen.queryByTestId('check-saved-key-openai')).not.toBeInTheDocument();
    });

    test('calls the endpoint with useSavedKey: true and no apiKey, without requiring anything typed', async () => {
      const apiFetch = vi.spyOn(client, 'apiFetch').mockImplementation((path: string, init?: RequestInit) => {
        if (path === '/subscriptions') {
          return Promise.resolve({
            subscriptions: [{ provider: 'anthropic', maskedKey: '••••••••abcd', planTier: null, status: 'active', renewalDate: null, createdAt: 't1', updatedAt: 't1' }],
          });
        }
        if (path === '/subscriptions/anthropic/models' && init?.method === 'POST') return Promise.resolve({ models: ['claude-sonnet-5'] });
        return Promise.resolve({});
      });
      renderPage();
      await screen.findByText('FMP (Financial Modeling Prep)');

      await userEvent.click(await screen.findByText('Update key')); // anthropic row, nothing typed into the input
      await userEvent.click(await screen.findByTestId('check-saved-key-anthropic'));

      await screen.findByTestId('allowed-models-result-anthropic');
      expect(apiFetch).toHaveBeenCalledWith('/subscriptions/anthropic/models', {
        method: 'POST', body: JSON.stringify({ useSavedKey: true }),
      });
    });
  });
});
