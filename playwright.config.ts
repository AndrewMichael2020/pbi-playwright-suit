import { defineConfig } from '@playwright/test';
import { loadEnvFile } from './playwright/helper-functions/env-loader';

loadEnvFile();

// Each run gets its own timestamped folder under test-archive/ so results
// accumulate rather than overwrite. PBI_RUN_ID can be set externally (CI,
// setup.ts) for a consistent ID across stages; falls back to current time.
const runId =
  process.env.PBI_RUN_ID ??
  new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
const archiveDir = `test-archive/${runId}`;

export default defineConfig({
  testDir: './playwright/tests',
  timeout: 60_000,
  outputDir: `${archiveDir}/artifacts`,
  expect: {
    timeout: 10_000,
  },
  reporter: [
    ['html', { open: 'never', outputFolder: `${archiveDir}/html-report` }],
    ['junit', { outputFile: `${archiveDir}/results.xml` }],
    ['./playwright/reporter'],
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
