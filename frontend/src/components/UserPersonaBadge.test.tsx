import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import UserPersonaBadge from './UserPersonaBadge';
import type { User } from '../api/auth';

function user(overrides: Partial<User> = {}): User {
  return { id: '1', email: 'demo-user@example.test', roles: ['user'], permissions: [], impersonating: false, ...overrides };
}

describe('UserPersonaBadge', () => {
  test('shows the first two letters of the email\'s local-part, uppercased', () => {
    render(<UserPersonaBadge user={user({ email: 'jsmith@example.com' })} />);
    expect(screen.getByTestId('user-persona-badge')).toHaveTextContent('JS');
  });

  test('the tooltip contains the full email and role(s)', () => {
    render(<UserPersonaBadge user={user({ email: 'demo-user@example.test', roles: ['user-premium'] })} />);
    expect(screen.getByTestId('user-persona-badge')).toHaveAttribute('title', 'demo-user@example.test\nRole: user-premium');
  });

  test('multiple roles are joined in the tooltip', () => {
    render(<UserPersonaBadge user={user({ roles: ['admin', 'admin-master'] })} />);
    expect(screen.getByTestId('user-persona-badge')).toHaveAttribute('title', expect.stringContaining('Role: admin, admin-master'));
  });

  test('no roles at all falls back to "none" rather than an empty string', () => {
    render(<UserPersonaBadge user={user({ roles: [] })} />);
    expect(screen.getByTestId('user-persona-badge')).toHaveAttribute('title', expect.stringContaining('Role: none'));
  });
});
