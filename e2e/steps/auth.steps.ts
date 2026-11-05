import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';
import { test } from '../fixtures/bddFixtures';
import { cleanupUser } from '../scripts/cleanup-user';
import { activateUser } from '../scripts/activate-user';

const { Given, When, Then, After } = createBdd(test);

// Must match SignupPage.tsx's own REQUIRED_QUESTION_COUNT.
const SECURITY_QUESTION_COUNT = 5;

Given('a new user visits the signup page', async ({ page }) => {
  await page.goto('/signup');
});

// The real form (Self-Registration & Password Policy) also requires first/last name and 5
// distinct security-question picks before signup-submit ever enables - fills every mandatory
// field, not just email/password. Each slot's dropdown narrows to exclude questions already
// picked in another slot, so selecting index 1 (the first real option, after the "- select a
// question -" placeholder) in each slot in turn always lands on 5 distinct questions.
When('they sign up with a fresh email and a valid password', async ({ page, testUser }) => {
  await page.getByTestId('signup-email').fill(testUser.email);
  await page.getByTestId('signup-first-name').fill(testUser.firstName);
  await page.getByTestId('signup-last-name').fill(testUser.lastName);
  await page.getByTestId('signup-password').fill(testUser.password);
  await page.getByTestId('signup-confirm-password').fill(testUser.password);

  for (let slot = 0; slot < SECURITY_QUESTION_COUNT; slot++) {
    const select = page.getByTestId(`security-question-slot-${slot}`);
    await select.selectOption({ index: 1 });
    const questionId = await select.inputValue();
    await page.getByTestId(`security-question-answer-${questionId}`).fill(`E2E answer ${slot}`);
  }

  await page.getByTestId('signup-submit').click();
  // click() only waits for the DOM click, not for the signup mutation + navigate('/') that
  // follows it on success - wait for that navigation so the account row is actually committed
  // before querying for it below (otherwise activateUser() can race the real INSERT).
  await page.waitForURL((url) => !url.pathname.includes('/signup'));

  // New accounts land 'pending' with no role (functionally locked out, see
  // PendingReviewPage.tsx) until an admin assigns a role and activates them - mirrors that
  // admin action directly against the DB so the rest of the scenario has a real, working
  // account. useSession() has staleTime: Infinity, so a hard reload (not just a refetch) is
  // what actually picks up the DB-side status/role change.
  await activateUser(testUser.email);
  await page.reload();
});

Then('they land on the dashboard, logged in', async ({ page }) => {
  await expect(page).toHaveURL('http://localhost:3000/');
  await expect(page.getByTestId('pending-review-banner')).not.toBeVisible();
});

// Cleanup runs even if an earlier step fails partway through the scenario.
After(async ({ testUser }) => {
  await cleanupUser(testUser.email);
});
