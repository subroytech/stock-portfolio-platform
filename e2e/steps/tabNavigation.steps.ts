import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';
import { test } from '../fixtures/bddFixtures';
import { grantPermission } from '../scripts/grant-role';

const { Given, When, Then } = createBdd(test);

// A brand-new signup is a plain 'user' role, which deliberately does NOT get
// api_keys:manage_own by default (Admin Console Phase 8 decision) - so the
// "API Keys" button never renders for one. Grants it via a dedicated
// E2E-only role rather than any admin-console-capable role (which would
// swap in an "Admin" link instead of the plain "API Keys" button - see
// hasAdminConsoleAccess() in api/auth.ts). Reloads afterward since
// useSession() has staleTime: Infinity and won't otherwise notice the
// DB-side permission change.
Given('they have been granted the {string} permission', async ({ page, testUser }, permissionKey: string) => {
  await grantPermission(testUser.email, 'e2e-permission-tester', permissionKey);
  await page.reload();
});

// Scoped via tab-panel-momentum (already added for the Vitest TabShell suite) -
// every tab stays mounted in the real DOM too, so an unscoped getByLabel('Ticker')
// would match Long-Term Analysis's/Contrarian Comeback's hidden panels as well.
When('they type {string} into the Momentum ticker input', async ({ page }, ticker: string) => {
  await page.getByRole('link', { name: 'Momentum Analysis' }).click();
  await page.getByTestId('tab-panel-momentum').getByLabel('Ticker').fill(ticker);
});

When('they switch to the {string} tab', async ({ page }, tabName: string) => {
  await page.getByRole('link', { name: tabName }).click();
});

Then('the Momentum ticker input still shows {string}', async ({ page }, ticker: string) => {
  await expect(page.getByTestId('tab-panel-momentum').getByLabel('Ticker')).toHaveValue(ticker);
});

When('they open the API Keys modal', async ({ page }) => {
  await page.getByRole('button', { name: 'API Keys' }).click();
});

Then('the API Keys modal is visible', async ({ page }) => {
  await expect(page.getByText('FMP (Financial Modeling Prep)')).toBeVisible();
});

When('they close the API Keys modal', async ({ page }) => {
  await page.getByRole('button', { name: 'Close' }).click();
});

Then('the API Keys modal is not visible', async ({ page }) => {
  await expect(page.getByText('FMP (Financial Modeling Prep)')).not.toBeVisible();
});
