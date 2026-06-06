import fs   from 'node:fs';
import path from 'node:path';
import type { FullConfig } from '@playwright/test';

const green  = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const red    = (s: string) => `\x1b[31m${s}\x1b[0m`;
const dim    = (s: string) => `\x1b[2m${s}\x1b[0m`;

function ts(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `[${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}]`;
}

async function globalSetup(_config: FullConfig): Promise<void> {
  process.env.TZ = 'UTC';

  const configPath = path.join(process.cwd(), 'playwright', 'config', 'enterprise.generated.json');
  const focusPath  = path.join(process.cwd(), 'playwright', 'config', 'enterprise.focus.json');

  if (!fs.existsSync(configPath)) {
    console.log(red(`${ts()} [global-setup] enterprise.generated.json not found — run npm run setup first`));
  } else {
    try {
      const count = (JSON.parse(fs.readFileSync(configPath, 'utf8')) as unknown[]).length;
      console.log(green(`${ts()} [global-setup] enterprise.generated.json OK — ${count} config(s) loaded`));
    } catch (err) {
      console.log(red(`${ts()} [global-setup] enterprise.generated.json parse error — ${String(err)}`));
    }
  }

  const focus = fs.existsSync(focusPath)
    ? (() => { try { return (JSON.parse(fs.readFileSync(focusPath, 'utf8')) as { focus?: string }).focus ?? 'all'; } catch { return 'all'; } })()
    : 'all';
  console.log(dim(`${ts()} [global-setup] focus: "${focus}"`));
}

export default globalSetup;
