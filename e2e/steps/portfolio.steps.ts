import { createBdd } from 'playwright-bdd';
import { test } from '../fixtures/bddFixtures';

const { When } = createBdd(test);

When('they create a portfolio named {string}', async ({ page }, name: string) => {
  await page.getByTestId('new-portfolio-button').click();
  await page.getByTestId('new-portfolio-name-input').fill(name);
  await page.getByTestId('new-portfolio-submit').click();
});
