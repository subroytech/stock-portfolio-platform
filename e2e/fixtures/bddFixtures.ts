import { test as base } from 'playwright-bdd';
import { generateTestUser } from './testUser';

interface TestUser {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

export const test = base.extend<{ testUser: TestUser }>({
  testUser: async ({}, use) => {
    await use(generateTestUser());
  },
});
