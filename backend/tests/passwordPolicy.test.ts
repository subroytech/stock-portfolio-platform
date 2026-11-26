import { validatePasswordPolicy, MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from '../src/utils/passwordPolicy';

const VALID = 'Str0ng!PasswordXYZ'; // 18 chars, upper+number+special, no name/email overlap

describe('validatePasswordPolicy', () => {
  test('accepts a password meeting every rule', () => {
    expect(validatePasswordPolicy(VALID, { firstName: 'Jordan', lastName: 'Rivera', emailLocalPart: 'new' })).toEqual([]);
  });

  test('rejects a password shorter than the minimum', () => {
    const errors = validatePasswordPolicy('Ab1!'.padEnd(MIN_PASSWORD_LENGTH - 1, 'x'), {});
    expect(errors.some((e) => e.includes(`${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH}`))).toBe(true);
  });

  test('rejects a password longer than the maximum', () => {
    const errors = validatePasswordPolicy('Ab1!'.padEnd(MAX_PASSWORD_LENGTH + 1, 'x'), {});
    expect(errors.some((e) => e.includes(`${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH}`))).toBe(true);
  });

  test('rejects a password with no uppercase letter', () => {
    const errors = validatePasswordPolicy('str0ng!passwordxyz', {});
    expect(errors.some((e) => e.includes('uppercase'))).toBe(true);
  });

  test('rejects a password with no number', () => {
    const errors = validatePasswordPolicy('StrOngPassword!Xyz', {});
    expect(errors.some((e) => e.includes('number'))).toBe(true);
  });

  test('rejects a password with no special character', () => {
    const errors = validatePasswordPolicy('Str0ngPasswordXyzAbc', {});
    expect(errors.some((e) => e.includes('special character'))).toBe(true);
  });

  test('accepts every character in the allowed special set', () => {
    for (const ch of '!@#$%^&*()_-+=?.'.split('')) {
      const pw = `Str0ngPassword${ch}Xy`;
      expect(validatePasswordPolicy(pw, {})).toEqual([]);
    }
  });

  test('rejects a password containing the first name, case-insensitive', () => {
    const errors = validatePasswordPolicy('MyJORDANPassw0rd!', { firstName: 'Jordan' });
    expect(errors.some((e) => e.includes('first name'))).toBe(true);
  });

  test('rejects a password containing the last name', () => {
    const errors = validatePasswordPolicy('MyRiveraPassw0rd!', { lastName: 'Rivera' });
    expect(errors.some((e) => e.includes('last name'))).toBe(true);
  });

  test('rejects a password with a 5+ character overlap with the email local-part', () => {
    // local-part "jordan99" shares "jorda"/"ordan" (5+ chars) with the password below.
    const errors = validatePasswordPolicy('MyJordanPassw0rd!Ex', { emailLocalPart: 'jordan99' });
    expect(errors.some((e) => e.includes('email address'))).toBe(true);
  });

  test('a 4-character overlap with the email local-part is allowed (5+ is the floor)', () => {
    // Shares only "abcd" (4 chars) with local-part "abcdxyz" - below the 5-char floor.
    const errors = validatePasswordPolicy('MyAbcdPassw0rd!Extra', { emailLocalPart: 'abcdxyz' });
    expect(errors.some((e) => e.includes('email address'))).toBe(false);
  });

  test('a short email local-part (under 5 chars) never triggers the overlap rule', () => {
    const errors = validatePasswordPolicy(VALID, { emailLocalPart: 'ab' });
    expect(errors.some((e) => e.includes('email address'))).toBe(false);
  });

  test('missing firstName/lastName/emailLocalPart never crashes and skips those checks', () => {
    expect(() => validatePasswordPolicy(VALID, {})).not.toThrow();
  });
});
