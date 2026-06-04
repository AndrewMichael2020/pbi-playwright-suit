import { defineConfig } from '@playwright/test';
import { loadEnvFile } from './playwright/helper-functions/env-loader';

loadEnvFile();

export default defineConfig({
  testDir: './playwright/tests',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [
    ['html', { open: 'never' }],
    ['junit', { outputFile: 'test-results/results.xml' }],
  ],
  globalSetup: require.resolve('./playwright/global/global-setup'),
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    headless: true,
  },
  projects: [
    {
      // Dry run: validates suite logic against committed mock fixtures.
      // No browser, no credentials required. Runs anywhere.
      name: 'dry-run',
      testMatch: /.*metadata\/.*\.spec\.ts/,
      timeout: 60_000,
    },
    {
      // Enterprise run: live Power BI checks — dataset health + visual render.
      // Requires npm run setup first (writes enterprise.generated.json).
      name: 'enterprise',
      testMatch: /.*visual\/.*\.spec\.ts/,
      timeout: 180_000,
      use: {
        channel: (process.env.PBI_BROWSER_CHANNEL as 'msedge' | 'chrome' | undefined) ?? 'chrome',
        launchOptions: { args: ['--disable-web-security'] },
        viewport: { width: 1280, height: 900 },
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
      },
    },
  ],
});
