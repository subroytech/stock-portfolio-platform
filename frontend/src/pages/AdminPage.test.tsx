import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { describe, expect, test, vi } from 'vitest';
import * as client from '../api/client';
import AdminPage from './AdminPage';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route path="/" element={<div>Home Page</div>} />
          <Route path="/admin" element={<AdminPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function mockAdminSession() {
  vi.spyOn(client, 'apiFetch').mockImplementation((url: string) => {
    if (url === '/auth/me') return Promise.resolve({ id: '1', email: 'admin@b.com', roles: ['admin'], permissions: ['api_keys:manage_own', 'users:manage_roles'] });
    if (url === '/subscriptions') return Promise.resolve({ subscriptions: [] });
    if (url === '/users') return Promise.resolve({ users: [] });
    if (url === '/roles') return Promise.resolve({ roles: [] });
    if (url === '/functions' || url === '/functions?all=true') return Promise.resolve({ functions: [] });
    return Promise.resolve({});
  });
}

describe('AdminPage', () => {
  test('defaults to the My API(s) tab, with all 5 tabs and a Back to Home link visible', async () => {
    mockAdminSession();
    renderPage();
    expect(await screen.findByText('FMP (Financial Modeling Prep)')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '← Back to Home' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('button', { name: 'My API(s)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Manage Users' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Manage Functions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Manage Permission' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Manage Role' })).toBeInTheDocument();
  });

  test('switching tabs renders the corresponding panel', async () => {
    mockAdminSession();
    renderPage();
    await screen.findByText('FMP (Financial Modeling Prep)');

    await userEvent.click(screen.getByRole('button', { name: 'Manage Users' }));
    expect(await screen.findByLabelText('New user email')).toBeInTheDocument();
    expect(screen.queryByText('FMP (Financial Modeling Prep)')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Manage Functions' }));
    expect(await screen.findByLabelText('permission_key')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Manage Permission' }));
    expect(await screen.findByLabelText('Role')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Manage Role' }));
    expect(await screen.findByLabelText('New role name')).toBeInTheDocument();
  });

  test('the Back to Home link navigates to /', async () => {
    mockAdminSession();
    renderPage();
    await screen.findByText('FMP (Financial Modeling Prep)');

    await userEvent.click(screen.getByRole('link', { name: '← Back to Home' }));
    expect(await screen.findByText('Home Page')).toBeInTheDocument();
  });

  test('a non-admin session is redirected to /', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string) => {
      if (url === '/auth/me') return Promise.resolve({ id: '1', email: 'a@b.com', roles: ['user'] });
      return Promise.resolve({});
    });
    renderPage();
    expect(await screen.findByText('Home Page')).toBeInTheDocument();
  });

  test('an admin-ish session missing api_keys:manage_own does not see the "My API(s)" tab at all', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string) => {
      // Has an admin-console permission (so it's not redirected away) but not
      // api_keys:manage_own specifically - that's the one being tested here.
      if (url === '/auth/me') return Promise.resolve({ id: '1', email: 'admin@b.com', roles: ['admin'], permissions: ['users:manage_roles'] });
      if (url === '/users') return Promise.resolve({ users: [] });
      if (url === '/roles') return Promise.resolve({ roles: [] });
      return Promise.resolve({});
    });
    renderPage();
    await screen.findByRole('button', { name: 'Manage Users' }); // wait for session to resolve
    expect(screen.queryByRole('button', { name: 'My API(s)' })).not.toBeInTheDocument();
    expect(screen.queryByText('FMP (Financial Modeling Prep)')).not.toBeInTheDocument();

    // The other tabs still work fine.
    await userEvent.click(screen.getByRole('button', { name: 'Manage Users' }));
    expect(await screen.findByLabelText('New user email')).toBeInTheDocument();
  });

  test('a session with contrarian_finder:scan sees the "Master Data" tab and can switch to it', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string) => {
      if (url === '/auth/me') return Promise.resolve({ id: '1', email: 'admin@b.com', roles: ['admin'], permissions: ['api_keys:manage_own', 'users:manage_roles', 'contrarian_finder:scan'] });
      if (url === '/subscriptions') return Promise.resolve({ subscriptions: [] });
      return Promise.resolve({});
    });
    renderPage();
    await screen.findByText('FMP (Financial Modeling Prep)'); // wait for session to resolve

    await userEvent.click(screen.getByRole('button', { name: 'Master Data' }));
    expect(await screen.findByRole('button', { name: 'Run Delta Update' })).toBeInTheDocument();
  });

  test('a session without contrarian_finder:scan does not see the "Master Data" tab', async () => {
    mockAdminSession(); // default helper - no contrarian_finder:scan
    renderPage();
    await screen.findByText('FMP (Financial Modeling Prep)');
    expect(screen.queryByRole('button', { name: 'Master Data' })).not.toBeInTheDocument();
  });

  test('a session with portfolio_template:manage_status sees the "Portfolio Templates" tab and can switch to it', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string) => {
      if (url === '/auth/me') return Promise.resolve({ id: '1', email: 'admin@b.com', roles: ['admin'], permissions: ['api_keys:manage_own', 'users:manage_roles', 'portfolio_template:manage_status'] });
      if (url === '/subscriptions') return Promise.resolve({ subscriptions: [] });
      if (url === '/portfolio-templates/admin/all') return Promise.resolve({ templates: [] });
      return Promise.resolve({});
    });
    renderPage();
    await screen.findByText('FMP (Financial Modeling Prep)');

    await userEvent.click(screen.getByRole('button', { name: 'Portfolio Templates' }));
    expect(await screen.findByText('No portfolio templates have been created yet.')).toBeInTheDocument();
  });

  test('a session without portfolio_template:manage_status does not see the "Portfolio Templates" tab', async () => {
    mockAdminSession(); // default helper - no portfolio_template:manage_status
    renderPage();
    await screen.findByText('FMP (Financial Modeling Prep)');
    expect(screen.queryByRole('button', { name: 'Portfolio Templates' })).not.toBeInTheDocument();
  });
});
