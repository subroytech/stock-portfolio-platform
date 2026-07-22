import path from 'path';
import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';
import { test } from '../fixtures/bddFixtures';

const { When, Then } = createBdd(test);

When('they import the sample holdings CSV', async ({ page }) => {
  const filePath = path.join(__dirname, '../fixtures/sample-holdings.csv');
  await page.getByTestId('import-file-input').setInputFiles(filePath);
});

Then('the import succeeds', async ({ page }) => {
  await expect(page.getByTestId('import-success')).toBeVisible();
});

Then('the dashboard shows the imported holdings', async ({ page }) => {
  await expect(page.getByTestId('holdings-row-AAPL')).toBeVisible();
  await expect(page.getByTestId('holdings-row-MSFT')).toBeVisible();
});

Then('the dashboard KPIs reflect a non-zero total value', async ({ page }) => {
  const totalValue = page.getByTestId('kpi-total-value');
  await expect(totalValue).toBeVisible();
  await expect(totalValue).not.toHaveText(/\$0\.00/);
});
