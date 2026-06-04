import type { FullConfig } from '@playwright/test';

function ts(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `[${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}]`;
}

async function globalSetup(_config: FullConfig): Promise<void> {
  process.env.TZ = 'UTC';
  console.log(`\x1b[2m${ts()} [global-setup] Power BI suite bootstrap complete\x1b[0m`);
}

export default globalSetup;
