import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, test } from 'vitest';
import UserPersonaBadge from './UserPersonaBadge';
import type { User } from '../api/auth';

function user(overrides: Partial<User> = {}): User {
  return { id: '1', email: 'demo-user@example.test', roles: ['user'], permissions: [], impersonating: false, status: 'active', firstName: null, lastName: null, ...overrides };
}

function renderBadge(overrides: Partial<User> = {}) {
  return render(
    <MemoryRouter>
      <UserPersonaBadge user={user(overrides)} />
    </MemoryRouter>,
  );
}

describe('UserPersonaBadge', () => {
  test('shows the first two letters of the email\'s local-part, uppercased', () => {
    renderBadge({ email: 'jsmith@example.com' });
    expect(screen.getByTestId('user-persona-badge')).toHaveTextContent('JS');
  });

  test('the tooltip contains the full email and role(s)', () => {
    renderBadge({ email: 'demo-user@example.test', roles: ['user-premium'] });
    expect(screen.getByTestId('user-persona-badge')).toHaveAttribute('title', 'demo-user@example.test\nRole: user-premium');
  });

  test('multiple roles are joined in the tooltip', () => {
    renderBadge({ roles: ['admin', 'admin-master'] });
    expect(screen.getByTestId('user-persona-badge')).toHaveAttribute('title', expect.stringContaining('Role: admin, admin-master'));
  });

  test('no roles at all falls back to "none" rather than an empty string', () => {
    renderBadge({ roles: [] });
    expect(screen.getByTestId('user-persona-badge')).toHaveAttribute('title', expect.stringContaining('Role: none'));
  });

  test('the menu is closed by default', () => {
    renderBadge();
    expect(screen.queryByTestId('user-persona-menu')).not.toBeInTheDocument();
  });

  test('clicking the badge opens a menu with Change Password and Manage Security Questions', async () => {
    renderBadge();
    await userEvent.click(screen.getByTestId('user-persona-badge'));

    expect(screen.getByTestId('user-persona-menu')).toBeInTheDocument();
    expect(screen.getByTestId('user-menu-change-password')).toHaveAttribute('href', '/change-password');
    expect(screen.getByTestId('user-menu-security-questions')).toHaveAttribute('href', '/security-questions');
  });

  test('clicking the badge again closes the menu', async () => {
    renderBadge();
    await userEvent.click(screen.getByTestId('user-persona-badge'));
    expect(screen.getByTestId('user-persona-menu')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('user-persona-badge'));
    expect(screen.queryByTestId('user-persona-menu')).not.toBeInTheDocument();
  });

  test('clicking the backdrop (anywhere outside the menu) closes it', async () => {
    renderBadge();
    await userEvent.click(screen.getByTestId('user-persona-badge'));
    expect(screen.getByTestId('user-persona-menu')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('user-persona-menu-backdrop'));
    expect(screen.queryByTestId('user-persona-menu')).not.toBeInTheDocument();
  });

  test('clicking a menu item closes the menu', async () => {
    renderBadge();
    await userEvent.click(screen.getByTestId('user-persona-badge'));
    await userEvent.click(screen.getByTestId('user-menu-change-password'));
    expect(screen.queryByTestId('user-persona-menu')).not.toBeInTheDocument();
  });
});
