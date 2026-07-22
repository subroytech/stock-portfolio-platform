// Generates a unique throwaway user per test run, following this repo's
// existing demo-user@example.test / *.test TLD convention for accounts that
// are safe to create and delete against a real database.

import { randomUUID } from 'crypto';

export function generateTestUser() {
  const email = `e2e-${Date.now()}-${randomUUID()}@example.test`;
  const password = 'E2ePilotPassw0rd!';
  return { email, password };
}
