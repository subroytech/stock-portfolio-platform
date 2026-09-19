import { describe, expect, test } from 'vitest';
import { checkPasswordRules, allPasswordRulesPass } from './passwordPolicy';

function passedMap(password: string, ctx: Parameters<typeof checkPasswordRules>[1] = {}) {
  return Object.fromEntries(checkPasswordRules(password, ctx).map((r) => [r.key, r.passed]));
}

describe('checkPasswordRules - the under-4-characters gating floor', () => {
  test('an empty password shows every rule as not-passed, including name/email (negated logic that would otherwise read as trivially satisfied)', () => {
    const passed = passedMap('', { firstName: 'Jordan', lastName: 'Rivera', emailLocalPart: 'jordan99' });
    expect(Object.values(passed).every((p) => p === false)).toBe(true);
  });

  test('1-3 characters still shows every rule as not-passed', () => {
    for (const password of ['A', 'A1', 'A1!']) {
      const passed = passedMap(password, { firstName: 'Jordan' });
      expect(Object.values(passed).every((p) => p === false)).toBe(true);
    }
  });

  test('at exactly 4 characters, rules are evaluated for real again (name/email can show passed once there\'s actually enough to judge)', () => {
    const passed = passedMap('A1!x', { firstName: 'Jordan', emailLocalPart: 'zzzz' });
    expect(passed.name).toBe(true); // doesn't contain "jordan"
    expect(passed.email).toBe(true); // no 5+ char overlap with "zzzz"
  });

  test('a valid full password still passes every rule normally (the floor never blocks a real valid password)', () => {
    const passed = passedMap('Str0ng!PasswordXYZ', { firstName: 'Jordan', lastName: 'Rivera', emailLocalPart: 'new' });
    expect(Object.values(passed).every((p) => p === true)).toBe(true);
  });

  test('allPasswordRulesPass is unaffected by the floor for a real submission (still requires all 6, gating floor is a display-only concern)', () => {
    expect(allPasswordRulesPass('', {})).toBe(false);
    expect(allPasswordRulesPass('Str0ng!PasswordXYZ', {})).toBe(true);
  });
});
