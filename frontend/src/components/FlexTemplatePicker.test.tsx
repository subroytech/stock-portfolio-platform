import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import * as client from '../api/client';
import FlexTemplatePicker from './FlexTemplatePicker';

function renderPicker(onSelectExisting = vi.fn(), onCreateNew = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <FlexTemplatePicker onSelectExisting={onSelectExisting} onCreateNew={onCreateNew} />
    </QueryClientProvider>,
  );
  return { onSelectExisting, onCreateNew };
}

describe('FlexTemplatePicker', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test('lists Approved templates and calls onSelectExisting when one is clicked', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string) => {
      if (url === '/portfolio-templates') return Promise.resolve({ templates: [{ id: 't1', templateName: 'Schwab Export', status: 'Approved', createdBy: 'u1', createdAt: 't1' }] });
      if (url === '/portfolio-templates/mine/pending') return Promise.resolve({ templates: [] });
      return Promise.resolve({});
    });
    const { onSelectExisting } = renderPicker();

    const option = await screen.findByTestId('flex-template-option-t1');
    await userEvent.click(option);
    expect(onSelectExisting).toHaveBeenCalledWith({ id: 't1', templateName: 'Schwab Export', status: 'Approved', createdBy: 'u1', createdAt: 't1' });
  });

  test('shows the Pending Approval dropdown only when the caller has a pending template', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string) => {
      if (url === '/portfolio-templates') return Promise.resolve({ templates: [] });
      if (url === '/portfolio-templates/mine/pending') return Promise.resolve({ templates: [{ id: 'p1', templateName: 'My Draft', status: 'Pending Approval', createdBy: 'u1', createdAt: 't1' }] });
      return Promise.resolve({});
    });
    renderPicker();

    expect(await screen.findByTestId('flex-template-pending-select')).toBeInTheDocument();
  });

  test('hides the Pending Approval dropdown when there are none', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string) => {
      if (url === '/portfolio-templates') return Promise.resolve({ templates: [] });
      if (url === '/portfolio-templates/mine/pending') return Promise.resolve({ templates: [] });
      return Promise.resolve({});
    });
    renderPicker();

    await screen.findByText(/no approved templates found/i);
    expect(screen.queryByTestId('flex-template-pending-select')).not.toBeInTheDocument();
  });

  test('search input re-fetches the approved list with a query string', async () => {
    const calls: string[] = [];
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string) => {
      calls.push(url);
      if (url.startsWith('/portfolio-templates') && !url.includes('mine')) return Promise.resolve({ templates: [] });
      if (url === '/portfolio-templates/mine/pending') return Promise.resolve({ templates: [] });
      return Promise.resolve({});
    });
    renderPicker();
    await screen.findByText(/no approved templates found/i);

    await userEvent.type(screen.getByTestId('flex-template-search'), 'Schwab');
    await screen.findByText(/no approved templates found matching that search/i);

    expect(calls.some((u) => u.includes('search=Schwab'))).toBe(true);
  });

  test('renders howToUseDescription as a hover tooltip on an Approved-list item', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string) => {
      if (url === '/portfolio-templates') return Promise.resolve({ templates: [{ id: 't1', templateName: 'Schwab Export', status: 'Approved', createdBy: 'u1', createdAt: 't1', howToUseDescription: 'Headers on row 5' }] });
      if (url === '/portfolio-templates/mine/pending') return Promise.resolve({ templates: [] });
      return Promise.resolve({});
    });
    renderPicker();

    const option = await screen.findByTestId('flex-template-option-t1');
    expect(option).toHaveAttribute('title', 'Headers on row 5');
  });

  test('"+ Create New Template" calls onCreateNew', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string) => {
      if (url === '/portfolio-templates') return Promise.resolve({ templates: [] });
      if (url === '/portfolio-templates/mine/pending') return Promise.resolve({ templates: [] });
      return Promise.resolve({});
    });
    const { onCreateNew } = renderPicker();

    await userEvent.click(screen.getByTestId('flex-create-new-template'));
    expect(onCreateNew).toHaveBeenCalled();
  });
});
