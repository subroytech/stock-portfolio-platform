import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import PasswordRequirementsChecklist from './PasswordRequirementsChecklist';

describe('PasswordRequirementsChecklist', () => {
  test('every rule shows unmet for an empty password', () => {
    render(<PasswordRequirementsChecklist password="" />);
    expect(screen.getByTestId('password-rule-length')).toHaveAttribute('data-passed', 'false');
    expect(screen.getByTestId('password-rule-upper')).toHaveAttribute('data-passed', 'false');
    expect(screen.getByTestId('password-rule-number')).toHaveAttribute('data-passed', 'false');
    expect(screen.getByTestId('password-rule-special')).toHaveAttribute('data-passed', 'false');
  });

  test('all 6 live rules pass for a fully valid password with no name/email overlap', () => {
    render(<PasswordRequirementsChecklist password="Str0ng!PasswordXYZ" firstName="Jordan" lastName="Rivera" emailLocalPart="new" />);
    for (const key of ['length', 'upper', 'number', 'special', 'name', 'email']) {
      expect(screen.getByTestId(`password-rule-${key}`)).toHaveAttribute('data-passed', 'true');
    }
  });

  test('the name rule fails when the password contains the first name', () => {
    render(<PasswordRequirementsChecklist password="MyJordanPassw0rd!" firstName="Jordan" />);
    expect(screen.getByTestId('password-rule-name')).toHaveAttribute('data-passed', 'false');
  });

  test('the email rule fails on a 5+ character overlap with the local-part', () => {
    render(<PasswordRequirementsChecklist password="MyJordanPassw0rd!Ex" emailLocalPart="jordan99" />);
    expect(screen.getByTestId('password-rule-email')).toHaveAttribute('data-passed', 'false');
  });

  test('always shows the static last-5-passwords note', () => {
    render(<PasswordRequirementsChecklist password="" />);
    expect(screen.getByText(/last 5 passwords/i)).toBeInTheDocument();
  });
});
