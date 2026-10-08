import { checkPasswordRules, type PasswordRuleContext } from '../lib/passwordPolicy';

interface PasswordRequirementsChecklistProps extends PasswordRuleContext {
  password: string;
}

// Self-Registration & Password Policy - the shared live checklist reused by Registration,
// Change Password, and Reset Password (avoids writing the same policy UI three times). Rules
// 1-6 turn green the moment they're satisfied; rule 7 (no repeat of the last 5 passwords) is
// server-only and shown as static text below, since it can't be verified client-side.
export default function PasswordRequirementsChecklist({ password, firstName, lastName, emailLocalPart }: PasswordRequirementsChecklistProps) {
  const rules = checkPasswordRules(password, { firstName, lastName, emailLocalPart });

  return (
    <div className="mb-4 rounded-btn border border-border bg-bg-primary p-3" data-testid="password-requirements-checklist">
      <p className="mb-1.5 text-xs font-semibold text-text-secondary">Password requirements</p>
      <ul className="space-y-1">
        {rules.map((rule) => (
          <li key={rule.key} className="flex items-center gap-2 text-xs" data-testid={`password-rule-${rule.key}`} data-passed={rule.passed}>
            <span className={rule.passed ? 'text-success' : 'text-text-muted'} aria-hidden="true">{rule.passed ? '✓' : '○'}</span>
            <span className={rule.passed ? 'text-success' : 'text-text-secondary'}>{rule.label}</span>
          </li>
        ))}
        <li className="flex items-center gap-2 text-xs text-text-muted">
          <span aria-hidden="true">·</span>
          <span>Must be different from your last 5 passwords.</span>
        </li>
      </ul>
    </div>
  );
}
