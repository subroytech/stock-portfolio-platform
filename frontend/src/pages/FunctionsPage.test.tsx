import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, test, vi } from 'vitest';
import * as client from '../api/client';
import FunctionsPage from './FunctionsPage';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <FunctionsPage />
    </QueryClientProvider>,
  );
}

const FN_ROW = { id: '1', permissionKey: 'roles:manage', name: 'Manage Roles', description: 'Create a new role.', status: 'active' };
const FN_ROW_WIP = { id: '3', permissionKey: 'reports:export', name: 'Export Reports', description: null, status: 'Dev-WIP' };

function mockFetch() {
  vi.spyOn(client, 'apiFetch').mockImplementation((path: string, init?: RequestInit) => {
    if (path === '/functions?all=true' && !init) return Promise.resolve({ functions: [FN_ROW, FN_ROW_WIP] });
    if (path === '/functions' && init?.method === 'POST') {
      return Promise.resolve({ function: { id: '2', permissionKey: 'reports:export', name: 'Export Reports', description: null, status: 'Dev-WIP' } });
    }
    if (path === '/functions/1' && init?.method === 'PUT') {
      return Promise.resolve({ function: { ...FN_ROW, status: 'inactive' } });
    }
    return Promise.reject(new Error(`unexpected call ${path}`));
  });
}

function findRow(name: string) {
  return screen.getByText(name).closest('div.flex.flex-wrap') as HTMLElement;
}

describe('FunctionsPage', () => {
  test('lists every function regardless of status (uses ?all=true)', async () => {
    mockFetch();
    renderPage();
    expect(await screen.findByText('Manage Roles')).toBeInTheDocument();
    expect(screen.getByText('Export Reports')).toBeInTheDocument();
    expect(screen.getByText('roles:manage')).toBeInTheDocument();
    expect(client.apiFetch).toHaveBeenCalledWith('/functions?all=true');
  });

  test('the status filter narrows the visible list without refetching', async () => {
    mockFetch();
    renderPage();
    await screen.findByText('Manage Roles');
    const callsBeforeFilter = (client.apiFetch as ReturnType<typeof vi.fn>).mock.calls.length;

    await userEvent.selectOptions(screen.getByLabelText('Filter by status'), 'Dev-WIP');

    expect(screen.queryByText('Manage Roles')).not.toBeInTheDocument();
    expect(screen.getByText('Export Reports')).toBeInTheDocument();
    expect(client.apiFetch).toHaveBeenCalledTimes(callsBeforeFilter); // no new fetch, purely client-side

    await userEvent.selectOptions(screen.getByLabelText('Filter by status'), 'all');
    expect(screen.getByText('Manage Roles')).toBeInTheDocument();
    expect(screen.getByText('Export Reports')).toBeInTheDocument();
  });

  test('creating a function POSTs the form fields and clears them', async () => {
    mockFetch();
    renderPage();
    await screen.findByText('Manage Roles');

    await userEvent.type(screen.getByLabelText('permission_key'), 'reports:export');
    await userEvent.type(screen.getByLabelText('Function name'), 'Export Reports');
    await userEvent.selectOptions(screen.getByLabelText('Initial status'), 'Dev-WIP');
    await userEvent.click(screen.getByRole('button', { name: 'Create function' }));

    await waitFor(() => expect(client.apiFetch).toHaveBeenCalledWith('/functions', {
      method: 'POST',
      body: JSON.stringify({ permissionKey: 'reports:export', name: 'Export Reports', description: null, status: 'Dev-WIP' }),
    }));
    await waitFor(() => expect(screen.getByLabelText('permission_key')).toHaveValue(''));
  });

  test("changing a row's status select only stages locally - Save commits via PUT /functions/:id", async () => {
    mockFetch();
    renderPage();
    await screen.findByText('Manage Roles');
    const row = findRow('Manage Roles');
    const saveButton = within(row).getByRole('button', { name: 'Save' });
    expect(saveButton).toBeDisabled();

    await userEvent.selectOptions(within(row).getByLabelText('Status for Manage Roles'), 'inactive');
    expect(client.apiFetch).not.toHaveBeenCalledWith('/functions/1', expect.anything());
    expect(saveButton).not.toBeDisabled();

    await userEvent.click(saveButton);
    await waitFor(() => expect(client.apiFetch).toHaveBeenCalledWith('/functions/1', {
      method: 'PUT',
      body: JSON.stringify({ status: 'inactive' }),
    }));
  });
});
