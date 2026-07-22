import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';
import { test } from '../fixtures/bddFixtures';
import { cleanupUser } from '../scripts/cleanup-user';

const { Given, When, Then, After } = createBdd(test);

Given('a new user visits the signup page', async ({ page }) => {
  await page.goto('/signup');
});

When('they sign up with a fresh email and a valid password', async ({ page, testUser }) => {
  await page.getByTestId('signup-email').fill(testUser.email);
  await page.getByTestId('signup-password').fill(testUser.password);
  await page.getByTestId('signup-submit').click();
});

Then('they land on the dashboard, logged in', async ({ page }) => {
  await expect(page).toHaveURL('http://localhost:3000/');
});

// Cleanup runs even if an earlier step fails partway through the scenario.
After(async ({ testUser }) => {
  await cleanupUser(testUser.email);
});
