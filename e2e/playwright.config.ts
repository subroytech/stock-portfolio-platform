import path from 'path';
import { defineConfig, devices } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';
import dotenv from 'dotenv';

// Loads e2e/.env.e2e for local runs; a no-op if the file doesn't exist (CI
// injects DATABASE_URL/JWT_SECRET/API_KEY_ENCRYPTION_KEY directly as env vars).
dotenv.config({ path: path.join(__dirname, '.env.e2e') });

const testDir = defineBddConfig({
  features: 'features/**/*.feature',
  steps: ['steps/**/*.ts', 'fixtures/bddFixtures.ts'],
});

export default defineConfig({
  testDir,
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: [['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: devices['Desktop Chrome'] }],
  webServer: [
    {
      command: 'npm run dev',
      cwd: '../backend',
      port: 4000,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        DATABASE_URL: process.env.DATABASE_URL ?? '',
        JWT_SECRET: process.env.JWT_SECRET ?? '',
        API_KEY_ENCRYPTION_KEY: process.env.API_KEY_ENCRYPTION_KEY ?? '',
        FRONTEND_ORIGIN: 'http://localhost:3000',
        PORT: '4000',
        NODE_ENV: 'development',
      },
    },
    {
      command: 'npm run dev',
      cwd: '../frontend',
      port: 3000,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
