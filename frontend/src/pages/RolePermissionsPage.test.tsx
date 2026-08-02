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

function mockFetch(rolePermissions: string[]) {
  vi.spyOn(client, 'apiFetch').mockImplementation((path: string, init?: RequestInit) => {
    if (path === '/roles') return Promise.resolve({ roles: [{ id: '2', name: 'admin', userCount: 1 }] });
    if (path === '/functions') return Promise.resolve({ functions: FUNCTIONS });
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
});
