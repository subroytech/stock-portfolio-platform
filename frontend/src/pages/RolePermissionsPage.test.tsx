import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, test, vi } from 'vitest';
import * as client from '../api/client';
import RolePermissionsPage from './RolePermissionsPage';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <RolePermissionsPage />
    </QueryClientProvider>,
  );
}

const FUNCTIONS = [
  { id: '1', permissionKey: 'roles:manage', name: 'Manage Roles', description: 'Create a new role.', status: 'active' },
  { id: '2', permissionKey: 'functions:manage', name: 'Manage Functions', description: null, status: 'active' },
];

// Deliberately in the same alphabetical-by-name order GET /functions actually returns
// (ORDER BY name) - "Contrarian Finder Scan History" sorts well before "Run Contrarian
// Finder Scan" alphabetically, so this fixture genuinely exercises the reordering logic
// rather than happening to already be in the expected display order.
const NESTED_FUNCTIONS = [
  { id: '3', permissionKey: 'contrarian_finder:scan_history', name: 'Contrarian Finder Scan History', description: 'History tier.', status: 'active' },
  { id: '4', permissionKey: 'functions:manage', name: 'Manage Functions', description: null, status: 'active' },
  { id: '5', permissionKey: 'contrarian_finder:scan', name: 'Run Contrarian Finder Scan', description: 'Run a scan.', status: 'active' },
];

function mockFetch(rolePermissions: string[], functions = FUNCTIONS) {
  vi.spyOn(client, 'apiFetch').mockImplementation((path: string, init?: RequestInit) => {
    if (path === '/roles') return Promise.resolve({ roles: [{ id: '2', name: 'admin', userCount: 1 }] });
    if (path === '/functions') return Promise.resolve({ functions });
    if (path === '/roles/2/permissions' && !init) return Promise.resolve({ permissions: rolePermissions });
    if (path === '/roles/2/permissions' && init?.method === 'POST') return Promise.resolve({ permissions: [...rolePermissions, 'functions:manage'] });
    if (path === '/roles/2/permissions/roles:manage' && init?.method === 'DELETE') return Promise.resolve({ permissions: rolePermissions.filter((p) => p !== 'roles:manage') });
    return Promise.reject(new Error(`unexpected call ${path}`));
  });
}

async function selectAdminRole() {
  await screen.findByRole('option', { name: 'admin' });
  await userEvent.selectOptions(screen.getByLabelText('Role'), 'admin');
  await screen.findByText('Manage Roles');
}

describe('RolePermissionsPage', () => {
  test('selecting a role shows the function checklist with its current grants checked', async () => {
    mockFetch(['roles:manage']);
    renderPage();
    await selectAdminRole();

    expect(screen.getByText('Manage Functions')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Manage Roles/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Manage Functions/ })).not.toBeChecked();
  });

  test('Save is disabled until a checkbox is toggled', async () => {
    mockFetch(['roles:manage']);
    renderPage();
    await selectAdminRole();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  test('checking a box only stages locally - no network call until Save is clicked', async () => {
    mockFetch(['roles:manage']);
    renderPage();
    await selectAdminRole();
    const callsBeforeToggle = (client.apiFetch as ReturnType<typeof vi.fn>).mock.calls.length;

    await userEvent.click(screen.getByRole('checkbox', { name: /Manage Functions/ }));
    expect(client.apiFetch).toHaveBeenCalledTimes(callsBeforeToggle); // still no new call
    expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(client.apiFetch).toHaveBeenCalledWith('/roles/2/permissions', {
      method: 'POST',
      body: JSON.stringify({ permissionKey: 'functions:manage' }),
    }));
  });

  test('unchecking a box and saving revokes the permission', async () => {
    mockFetch(['roles:manage']);
    renderPage();
    await selectAdminRole();

    await userEvent.click(screen.getByRole('checkbox', { name: /Manage Roles/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(client.apiFetch).toHaveBeenCalledWith('/roles/2/permissions/roles:manage', { method: 'DELETE' }));
  });

  test('contrarian_finder:scan_history renders immediately under contrarian_finder:scan (its parent), indented - not in its own alphabetical position', async () => {
    mockFetch(['contrarian_finder:scan'], NESTED_FUNCTIONS);
    renderPage();
    await screen.findByRole('option', { name: 'admin' });
    await userEvent.selectOptions(screen.getByLabelText('Role'), 'admin');
    await screen.findByText('Run Contrarian Finder Scan');

    const labels = screen.getAllByText(/Manage Functions|Run Contrarian Finder Scan|Contrarian Finder Scan History/);
    const names = labels.map((el) => el.textContent?.replace('↳', '').trim());
    // The parent-child pair stays adjacent (child right after parent), even though
    // "Contrarian Finder Scan History" would otherwise sort well before both other rows.
    expect(names).toEqual(['Manage Functions', 'Run Contrarian Finder Scan', 'Contrarian Finder Scan History']);

    const historyRow = screen.getByText('Contrarian Finder Scan History').closest('label');
    const scanRow = screen.getByText('Run Contrarian Finder Scan').closest('label');
    expect(historyRow).toHaveStyle({ marginLeft: '1.75rem' });
    expect(scanRow).not.toHaveAttribute('style');
  });
});
