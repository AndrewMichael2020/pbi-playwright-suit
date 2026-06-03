import 'dotenv/config';
import { defineConfig } from '@playwright/test';

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
      timeout: 90_000,
      use: {
        browserName: 'chromium',
      },
    },
  ],
});
