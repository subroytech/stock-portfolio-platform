// Self-Registration & Password Policy (CLAUDE.md's section of the same name) - the single
// source of truth for password rules 1-6 (rule 7, "not a repeat of the last 5," lives in
// passwordHistory.service.ts instead, since it needs a DB round-trip this pure function can't
// do). Every password-accepting endpoint (register, change-password, forgot-password/reset)
// calls this - never duplicated inline.

export const MIN_PASSWORD_LENGTH = 15;
export const MAX_PASSWORD_LENGTH = 25;
// Matches frontend/src/components/PasswordRequirementsChecklist.tsx's SPECIAL_CHARS exactly -
// two independent copies (no shared-schema mechanism between frontend/backend in this repo),
// kept in sync by hand.
const SPECIAL_CHARS = '!@#$%^&*()_-+=?.';
// Escapes every regex-meaningful character including `-` (unescaped, it creates a range like
// `_-+` = "everything from _ to +", which is either invalid or silently wrong - caught live via
// the test suite, not tsc, since this is a runtime RegExp construction error).
const SPECIAL_CHAR_RE = new RegExp(`[${SPECIAL_CHARS.replace(/[-.*+?^${}()|[\]\\]/g, '\\$&')}]`);
// A password must not contain 5+ consecutive characters that also appear consecutively in the
// email's local-part (before @) - confirmed with the user as "local-part only, 5+ character
// overlap," not the full email/domain.
const EMAIL_OVERLAP_MIN_LENGTH = 5;

export interface PasswordPolicyContext {
  firstName?: string | null;
  lastName?: string | null;
  emailLocalPart?: string | null;
}

// Returns every violated rule's message, in a fixed order matching the checklist's own display
// order - empty array means the password is valid. Never throws; the caller decides how to
// respond (400 with these messages, e.g.).
export function validatePasswordPolicy(password: string, ctx: PasswordPolicyContext): string[] {
  const errors: string[] = [];

  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    errors.push(`Password must be ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters.`);
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least 1 uppercase letter.');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least 1 number.');
  }
  if (!SPECIAL_CHAR_RE.test(password)) {
    errors.push(`Password must contain at least 1 special character (${SPECIAL_CHARS.split('').join(' ')}).`);
  }

  const lowerPassword = password.toLowerCase();
  const firstName = ctx.firstName?.trim();
  const lastName = ctx.lastName?.trim();
  if (firstName && lowerPassword.includes(firstName.toLowerCase())) {
    errors.push("Password must not contain your first name.");
  }
  if (lastName && lowerPassword.includes(lastName.toLowerCase())) {
    errors.push("Password must not contain your last name.");
  }

  const emailLocalPart = ctx.emailLocalPart?.trim().toLowerCase();
  if (emailLocalPart && hasSubstringOverlap(lowerPassword, emailLocalPart, EMAIL_OVERLAP_MIN_LENGTH)) {
    errors.push(`Password must not contain ${EMAIL_OVERLAP_MIN_LENGTH}+ consecutive characters from your email address.`);
  }

  return errors;
}

// True if `a` and `b` share any run of `minLength`+ identical consecutive characters -
// implemented as "does any minLength-sized window of b appear in a," which is sufficient since
// any longer overlap necessarily contains a minLength-sized one too.
function hasSubstringOverlap(a: string, b: string, minLength: number): boolean {
  if (b.length < minLength) return false;
  for (let i = 0; i <= b.length - minLength; i++) {
    if (a.includes(b.slice(i, i + minLength))) return true;
  }
  return false;
}
