// Self-Registration & Password Policy - client-side mirror of backend/src/utils/passwordPolicy
// .ts's rules 1-6, for instant live feedback while typing. The backend is the sole enforcement
// authority (this file is UX only) - same "two hand-maintained copies" precedent already used
// elsewhere in this codebase (no shared-schema mechanism between frontend/backend here).

export const MIN_PASSWORD_LENGTH = 15;
export const MAX_PASSWORD_LENGTH = 25;
// Must match backend/src/utils/passwordPolicy.ts's SPECIAL_CHARS exactly.
export const SPECIAL_CHARS = '!@#$%^&*()_-+=?.';
const SPECIAL_CHAR_RE = new RegExp(`[${SPECIAL_CHARS.replace(/[-.*+?^${}()|[\]\\]/g, '\\$&')}]`);
const EMAIL_OVERLAP_MIN_LENGTH = 5;

export interface PasswordRuleContext {
  firstName?: string;
  lastName?: string;
  emailLocalPart?: string;
}

export interface PasswordRuleCheck {
  key: string;
  label: string;
  passed: boolean;
}

function hasSubstringOverlap(a: string, b: string, minLength: number): boolean {
  if (b.length < minLength) return false;
  for (let i = 0; i <= b.length - minLength; i++) {
    if (a.includes(b.slice(i, i + minLength))) return true;
  }
  return false;
}

// Returns the 6 live-checkable rules in fixed display order - each with its own pass/fail, so
// the checklist UI can render a per-rule ✓ rather than one all-or-nothing verdict.
export function checkPasswordRules(password: string, ctx: PasswordRuleContext): PasswordRuleCheck[] {
  const lower = password.toLowerCase();
  const firstName = ctx.firstName?.trim().toLowerCase();
  const lastName = ctx.lastName?.trim().toLowerCase();
  const emailLocalPart = ctx.emailLocalPart?.trim().toLowerCase();

  return [
    { key: 'length', label: `${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters`, passed: password.length >= MIN_PASSWORD_LENGTH && password.length <= MAX_PASSWORD_LENGTH },
    { key: 'upper', label: 'At least 1 uppercase letter (A-Z)', passed: /[A-Z]/.test(password) },
    { key: 'number', label: 'At least 1 number (0-9)', passed: /[0-9]/.test(password) },
    { key: 'special', label: `At least 1 special character (${SPECIAL_CHARS.split('').join(' ')})`, passed: SPECIAL_CHAR_RE.test(password) },
    { key: 'name', label: "Doesn't contain your first or last name", passed: !(firstName && lower.includes(firstName)) && !(lastName && lower.includes(lastName)) },
    { key: 'email', label: "Doesn't contain 5+ consecutive characters from your email address", passed: !(emailLocalPart && hasSubstringOverlap(lower, emailLocalPart, EMAIL_OVERLAP_MIN_LENGTH)) },
  ];
}

export function allPasswordRulesPass(password: string, ctx: PasswordRuleContext): boolean {
  return checkPasswordRules(password, ctx).every((r) => r.passed);
}
