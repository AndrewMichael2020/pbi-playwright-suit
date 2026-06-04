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
      name: 'metadata',
      testMatch: /.*metadata\/.*\.spec\.ts/,
      timeout: 60_000,
    },
    {
      name: 'visual',
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
