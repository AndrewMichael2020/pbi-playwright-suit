import type { FullConfig } from '@playwright/test';

async function globalSetup(_config: FullConfig): Promise<void> {
  process.env.TZ = 'UTC';
  console.log('[global-setup] Power BI suite bootstrap complete');
}

export default globalSetup;
