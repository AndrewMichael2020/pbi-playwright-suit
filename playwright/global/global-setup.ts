import fs   from 'node:fs';
import path from 'node:path';
import type { FullConfig } from '@playwright/test';

const dim    = (s: string) => `\x1b[2m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const red    = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green  = (s: string) => `\x1b[32m${s}\x1b[0m`;

function ts(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `[${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}]`;
}

async function globalSetup(_config: FullConfig): Promise<void> {
  process.env.TZ = 'UTC';

  const cwd        = process.cwd();
  const configPath = path.join(cwd, 'playwright', 'config', 'enterprise.generated.json');
  const focusPath  = path.join(cwd, 'playwright', 'config', 'enterprise.focus.json');

  console.log(dim(`${ts()} [global-setup] cwd:         ${cwd}`));
  console.log(dim(`${ts()} [global-setup] config path: ${configPath}`));

  // ── enterprise.generated.json ──────────────────────────────────────────────
  if (!fs.existsSync(configPath)) {
    console.log(red(`${ts()} [global-setup] ERROR: enterprise.generated.json NOT FOUND — run npm run setup first`));
  } else {
    try {
      const raw   = fs.readFileSync(configPath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      const count  = Array.isArray(parsed) ? parsed.length : 1;
      console.log(green(`${ts()} [global-setup] enterprise.generated.json OK — ${count} config(s) loaded`));
    } catch (err) {
      console.log(red(`${ts()} [global-setup] ERROR: failed to parse enterprise.generated.json — ${String(err)}`));
    }
  }

  // ── enterprise.focus.json ──────────────────────────────────────────────────
  if (!fs.existsSync(focusPath)) {
    console.log(yellow(`${ts()} [global-setup] WARN:  enterprise.focus.json not found — defaulting to "all"`));
  } else {
    try {
      const raw   = fs.readFileSync(focusPath, 'utf8');
      const parsed = JSON.parse(raw) as { focus?: string };
      console.log(dim(`${ts()} [global-setup] focus: "${parsed.focus ?? 'all'}"`));
    } catch (err) {
      console.log(yellow(`${ts()} [global-setup] WARN:  failed to parse enterprise.focus.json — ${String(err)}`));
    }
  }

  console.log(dim(`${ts()} [global-setup] Power BI suite bootstrap complete`));
}

export default globalSetup;
