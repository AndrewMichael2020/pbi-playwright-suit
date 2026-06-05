/**
 * Power BI test-suite setup — selects which reports and pages to test.
 *
 * Interactive mode (default):
 *   Run "npm run setup" with no env vars. A coloured menu lets you browse
 *   workspaces and reports, pick individual pages, then optionally launch
 *   tests immediately.
 *
 * CI / env-driven mode (non-interactive):
 *   Set PBI_WORKSPACE_NAME + PBI_REPORT_NAME (and optionally PBI_DATASET_NAME,
 *   PBI_PAGE_NAME) in your .env file.  The script resolves the report without
 *   prompting and writes the config file, then exits.
 *
 * Both modes write playwright/config/enterprise.generated.json which the
 * visual test suite reads automatically.
 */

import { spawn } from 'node:child_process';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  findDatasetByName,
  findReportByName,
  findWorkspaceByName,
  getAccessToken,
  getPowerBiEndpoints,
  listDatasets,
  listReports,
  listWorkspaces,
  listReportPages,
  readEnterpriseCredentialsFromEnv,
  type PowerBiReport,
  type PowerBiWorkspace,
} from '../playwright/helper-functions/powerbi-enterprise';
import { loadEnvFile } from '../playwright/helper-functions/env-loader';
import {
  saveEnterpriseConfig,
  saveEnterpriseConfigs,
  type EnterpriseReportConfig,
} from '../playwright/helper-functions/enterprise-config';
import { FOCUS_MENU, saveFocus, type CheckFocus } from '../playwright/helper-functions/focus';

loadEnvFile();

// ── colours ───────────────────────────────────────────────────────────────────

const bold    = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim     = (s: string) => `\x1b[2m${s}\x1b[0m`;
const cyan    = (s: string) => `\x1b[36m${s}\x1b[0m`;
const green   = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow  = (s: string) => `\x1b[33m${s}\x1b[0m`;
const red     = (s: string) => `\x1b[31m${s}\x1b[0m`;
const magenta = (s: string) => `\x1b[35m${s}\x1b[0m`;

// ── timing helpers ────────────────────────────────────────────────────────────

/** Wall-clock timestamp prefix: dim [HH:MM:SS] */
function ts(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return dim(`[${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}]`);
}

/** Elapsed since a reference Date.now() snapshot: dim +X.Xs */
function elapsed(startMs: number): string {
  return dim(`+${((Date.now() - startMs) / 1000).toFixed(1)}s`);
}

// ── list helpers ──────────────────────────────────────────────────────────────

const TOP_N = 20;

function sortByName<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name));
}

function filterBySearch<T extends { name: string }>(items: T[], query: string): T[] {
  const q = query.toLowerCase();
  return items.filter((i) => i.name.toLowerCase().includes(q));
}

function printList<T extends { name: string }>(
  items: T[],
  label: string,
  totalInPool?: number,
): void {
  const pool = totalInPool ?? items.length;
  const suffix =
    pool > items.length
      ? dim(` — showing ${items.length} of ${pool}`)
      : dim(` — ${items.length} total`);
  console.log(`\n  ${bold(label)}${suffix}`);
  items.forEach((item, i) =>
    console.log(`    ${dim(`[${String(i + 1).padStart(3)}]`)}  ${item.name}`),
  );
}

/**
 * pickOne: shows top 20, then loops until the user selects one item.
 * /keyword → search · Enter → show all · number → pick
 */
async function pickOne<T extends { name: string }>(
  rl: readline.Interface,
  items: T[],
  label: string,
): Promise<T> {
  const sorted = sortByName(items);
  let visible = sorted.slice(0, Math.min(TOP_N, sorted.length));
  printList(visible, label, sorted.length);

  while (true) {
    const canExpand = sorted.length > visible.length;
    const hint = canExpand
      ? dim(`  type to search · Enter to show all ${sorted.length} · `)
      : dim(`  type to search · `);
    const answer = (await rl.question(`${hint}Enter number (1–${visible.length}): `)).trim();

    if (!answer && canExpand) {
      visible = sorted;
      printList(visible, label);
      continue;
    }
    // Number selection
    const idx = parseInt(answer, 10) - 1;
    if (!isNaN(idx) && idx >= 0 && idx < visible.length) return visible[idx]!;
    // Non-numeric, non-empty → treat as search
    if (answer) {
      const filtered = filterBySearch(sorted, answer);
      if (filtered.length === 0) {
        console.log(yellow(`  No matches for "${answer}" — showing full list.`));
        visible = sorted;
      } else {
        visible = filtered;
      }
      printList(visible, label, sorted.length);
      continue;
    }
    console.log(red(`  Please enter a number between 1 and ${visible.length}.`));
  }
}

/**
 * pickMany: like pickOne but accepts multi-select syntax.
 * single: 1 · comma: 1,3,5 · range: 2-6 · all
 */
async function pickMany<T extends { name: string }>(
  rl: readline.Interface,
  items: T[],
  label: string,
): Promise<T[]> {
  const sorted = sortByName(items);
  let visible = sorted.slice(0, Math.min(TOP_N, sorted.length));
  printList(visible, label, sorted.length);

  while (true) {
    const canExpand = sorted.length > visible.length;
    const refineHint = canExpand
      ? `  ${dim(`type to search · Enter to show all ${sorted.length}`)}\n`
      : `  ${dim('type to search')}\n`;
    const answer = (
      await rl.question(
        `${refineHint}  Enter number(s) — ${dim('1')}  ${dim('1,3,5')}  ${dim('2-6')}  ${dim('all')}\n  > `,
      )
    ).trim().toLowerCase();

    if (!answer && canExpand) {
      visible = sorted;
      printList(visible, label);
      continue;
    }
    if (answer === 'all') return visible;

    // If answer looks like numbers/ranges, try to parse as selection
    if (/^[\d,\-\s]+$/.test(answer)) {
      const indices = new Set<number>();
      let valid = true;
      for (const token of answer.split(',').map((t) => t.trim())) {
        const range = token.match(/^(\d+)-(\d+)$/);
        if (range) {
          const lo = parseInt(range[1]!, 10);
          const hi = parseInt(range[2]!, 10);
          if (lo < 1 || hi > visible.length || lo > hi) { valid = false; break; }
          for (let n = lo; n <= hi; n++) indices.add(n - 1);
        } else {
          const n = parseInt(token, 10);
          if (isNaN(n) || n < 1 || n > visible.length) { valid = false; break; }
          indices.add(n - 1);
        }
      }
      if (valid && indices.size > 0) {
        return [...indices].sort((a, b) => a - b).map((i) => visible[i]!);
      }
    }

    // Non-numeric → treat as search
    if (answer) {
      const filtered = filterBySearch(sorted, answer);
      if (filtered.length === 0) {
        console.log(yellow(`  No matches for "${answer}" — showing full list.`));
        visible = sorted;
      } else {
        visible = filtered;
      }
      printList(visible, label, sorted.length);
      continue;
    }
    console.log(red(`  Invalid. Use numbers 1–${visible.length}, commas, ranges, or "all".`));
  }
}

// ── focus menu ────────────────────────────────────────────────────────────────

async function pickFocus(rl: readline.Interface, reportCount: number): Promise<CheckFocus> {
  console.log(
    `\n${bold(cyan('What do you want to check?'))}` +
    dim(`  (${reportCount} test config(s) queued)\n`) +
    dim('  Pick a focus to skip unrelated tests — saves time on large workspaces.\n'),
  );

  const OTHER_LABEL = 'Other (enter custom Playwright grep filter)';
  const OTHER_VALUE = '__other__' as const;

  const liveItems = FOCUS_MENU.filter((m) => !m.tbd);
  const tbdItems  = FOCUS_MENU.filter((m) => m.tbd);

  // Selectable items: live options + Other
  type SelectableItem = { value: CheckFocus | typeof OTHER_VALUE; label: string; description: string };
  const selectable: SelectableItem[] = [
    ...liveItems,
    { value: OTHER_VALUE, label: OTHER_LABEL, description: '' },
  ];

  const SEP = `\n  ${dim('─'.repeat(72))}\n`;

  // ── Live (numbered) ────────────────────────────────────────────────────────
  process.stdout.write(SEP);
  liveItems.forEach((item, i) => {
    const num  = dim(`[${String(i + 1).padStart(2)}]`);
    const desc = dim(`  — ${item.description}`);
    process.stdout.write(`  ${num}  ${item.label.padEnd(30)}${desc}\n`);
  });

  // ── TBD (non-selectable, dimmed) ───────────────────────────────────────────
  if (tbdItems.length > 0) {
    process.stdout.write(SEP);
    tbdItems.forEach((item) => {
      const marker = dim('[TBD]');
      const note   = dim(`  — ${item.description}  `) + yellow('(requires model baselines — coming soon)');
      process.stdout.write(`  ${marker}  ${dim(item.label.padEnd(30))}${note}\n`);
    });
  }

  // ── Other (numbered, last) ─────────────────────────────────────────────────
  process.stdout.write(SEP);
  const otherNum = String(selectable.length).padStart(2);
  process.stdout.write(`  ${dim(`[${otherNum}]`)}  ${OTHER_LABEL}\n`);
  process.stdout.write(SEP + '\n');

  while (true) {
    const ans = (await rl.question(dim(`  Enter number (1–${selectable.length}): `))).trim();
    const idx = parseInt(ans, 10) - 1;
    if (!isNaN(idx) && idx >= 0 && idx < selectable.length) {
      const chosen = selectable[idx]!;
      if (chosen.value === OTHER_VALUE) {
        const grep = (await rl.question(dim('  Playwright grep pattern: '))).trim();
        if (grep) process.env.PBI_GREP = grep;
        return 'all';
      }
      return chosen.value as CheckFocus;
    }
    console.log(red(`  Please enter a number between 1 and ${selectable.length}.`));
  }
}



async function runCi(credentials: ReturnType<typeof readEnterpriseCredentialsFromEnv> & object): Promise<void> {
  const workspaceName   = process.env.PBI_WORKSPACE_NAME!;
  const reportName      = process.env.PBI_REPORT_NAME!;
  const datasetName     = process.env.PBI_DATASET_NAME ?? reportName;
  const pageDisplayName = process.env.PBI_PAGE_NAME;

  console.log(`\n${bold(magenta('⚡ Power BI Test Setup'))} ${dim('(CI mode)')}\n`);

  const endpoints  = getPowerBiEndpoints(credentials.environment);
  let t = Date.now();
  console.log(`${ts()} ${dim('Authenticating…')}`);
  const accessToken = await getAccessToken(credentials, endpoints);
  console.log(`${ts()} ${green('✓ Authenticated')} ${elapsed(t)}\n`);

  t = Date.now();
  const workspace = await findWorkspaceByName(accessToken, workspaceName, endpoints);
  if (!workspace) throw new Error(`Workspace '${workspaceName}' not found.`);

  const dataset = await findDatasetByName(accessToken, workspace.id, datasetName, endpoints);
  if (!dataset) throw new Error(`Dataset '${datasetName}' not found in '${workspaceName}'.`);

  const report = await findReportByName(accessToken, workspace.id, reportName, endpoints);
  if (!report) throw new Error(`Report '${reportName}' not found in '${workspaceName}'.`);

  const pages = await listReportPages(accessToken, workspace.id, report.id, endpoints);
  if (pages.length === 0) throw new Error(`Report '${reportName}' has no pages.`);
  console.log(`${ts()} ${dim('Resolved workspace / report / dataset / pages')} ${elapsed(t)}`);

  const page =
    (pageDisplayName ? pages.find((p) => p.displayName === pageDisplayName) : undefined) ?? pages[0];

  if (pageDisplayName && page!.displayName !== pageDisplayName)
    throw new Error(`PBI_PAGE_NAME '${pageDisplayName}' not found in '${reportName}'.`);

  saveEnterpriseConfig({
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    datasetId: dataset.id,
    datasetName: dataset.name,
    reportId: report.id,
    reportName: report.name,
    pageId: page!.name,
    pageName: page!.name,
    pageDisplayName: page!.displayName,
    embedUrl: report.embedUrl ?? '',
    reportUrl: `${endpoints.webPrefix}/groups/${workspace.id}/reports/${report.id}/${page!.name}`,
    discoveredAt: new Date().toISOString(),
  });

  console.log(
    `${bold(green('✅ Setup complete'))}\n` +
    `    workspace: ${workspace.name}\n` +
    `    report:    ${report.name}\n` +
    `    page:      ${page!.displayName}\n` +
    `    output:    playwright/config/enterprise.generated.json`,
  );
}

async function main(): Promise<void> {
  const credentials = readEnterpriseCredentialsFromEnv();
  if (!credentials) throw new Error('Unable to build enterprise auth settings.');

  // CI short-circuit: if the required env vars are set, skip the interactive menu.
  if (process.env.PBI_WORKSPACE_NAME && process.env.PBI_REPORT_NAME) {
    await runCi(credentials);
    return;
  }

  console.log(`\n${bold(magenta('⚡ Power BI Test Setup'))}\n`);
  const setupStart = Date.now();

  const endpoints = getPowerBiEndpoints(credentials.environment);
  let t = Date.now();
  console.log(`${ts()} ${dim('Authenticating…')}`);
  const accessToken = await getAccessToken(credentials, endpoints);
  console.log(`${ts()} ${green('✓ Authenticated')} ${elapsed(t)}\n`);

  const rl = readline.createInterface({ input, output });

  try {
    // 1. Pick workspace
    t = Date.now();
    const workspaces = await listWorkspaces(accessToken, endpoints);
    if (workspaces.length === 0) throw new Error('No workspaces found.');
    console.log(dim(`  ${ts()} Loaded ${workspaces.length} workspace(s) ${elapsed(t)}`));
    const workspace: PowerBiWorkspace = await pickOne(rl, workspaces, 'Workspaces');
    console.log(`\n  ${green('✓')} Workspace: ${bold(workspace.name)}`);

    // 2. Pick reports (multi-select)
    t = Date.now();
    const allReports = await listReports(accessToken, workspace.id, endpoints);
    if (allReports.length === 0) throw new Error(`No reports in workspace "${workspace.name}".`);
    console.log(dim(`  ${ts()} Loaded ${allReports.length} report(s) ${elapsed(t)}`));
    const selectedReports: PowerBiReport[] = await pickMany(rl, allReports, 'Reports');
    console.log(`\n  ${green('✓')} Selected ${bold(String(selectedReports.length))} report(s).`);

    // 3. Page selection strategy
    let pageStrategy: 'first' | 'all' | 'pick' = 'first';
    if (selectedReports.length === 1) {
      pageStrategy = 'pick';
    } else {
      console.log(`\n  ${cyan('Pages per report')} — ${bold('first')} / ${bold('all')} / ${bold('pick')}`);
      while (true) {
        const ans = (await rl.question('  > ')).trim().toLowerCase();
        if (ans === 'first' || ans === 'all' || ans === 'pick') {
          pageStrategy = ans as 'first' | 'all' | 'pick';
          break;
        }
        console.log(red('  Enter: first, all, or pick'));
      }
    }

    // 4. Resolve datasets once
    t = Date.now();
    const datasets = await listDatasets(accessToken, workspace.id, endpoints);
    console.log(dim(`  ${ts()} Loaded ${datasets.length} dataset(s) ${elapsed(t)}`))

    // 5. Build config entries
    const configs: EnterpriseReportConfig[] = [];

    for (const report of selectedReports) {
      const dataset =
        (report.datasetId ? datasets.find((d) => d.id === report.datasetId) : undefined) ??
        datasets.find((d) => d.name === report.name) ??
        datasets[0];

      if (!dataset) {
        console.log(yellow(`  ⚠  No dataset resolved for "${report.name}" — skipping.`));
        continue;
      }

      const tp = Date.now();
      const pages = await listReportPages(accessToken, workspace.id, report.id, endpoints);
      if (pages.length === 0) {
        console.log(yellow(`  ⚠  No pages found for "${report.name}" — skipping.`));
        continue;
      }
      console.log(dim(`    ${ts()} ${report.name}: ${pages.length} page(s) ${elapsed(tp)}`));

      let chosenPages = pages;
      if (pageStrategy === 'first') {
        chosenPages = [pages[0]!];
      } else if (pageStrategy === 'pick') {
        const pagesAsNamed = pages.map((p) => ({ ...p, name: p.displayName }));
        const picked = await pickMany(rl, pagesAsNamed, `Pages — ${report.name}`);
        chosenPages = pages.filter((p) => picked.some((q) => q.name === p.displayName));
      }

      for (const page of chosenPages) {
        configs.push({
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          datasetId: dataset.id,
          datasetName: dataset.name,
          reportId: report.id,
          reportName: report.name,
          pageId: page.name,
          pageName: page.name,
          pageDisplayName: page.displayName,
          embedUrl: report.embedUrl ?? '',
          reportUrl: `${endpoints.webPrefix}/groups/${workspace.id}/reports/${report.id}/${page.name}`,
          discoveredAt: new Date().toISOString(),
        });
      }
    }

    if (configs.length === 0) throw new Error('No valid report+page combinations selected.');

    saveEnterpriseConfigs(configs);

    console.log(`\n${bold(green('✅ Discovery complete'))} — ${configs.length} test(s) queued ${elapsed(setupStart)}:\n`);
    configs.forEach((c) =>
      console.log(`    ${dim('▸')} ${c.reportName} ${dim('›')} ${cyan(c.pageDisplayName)}`),
    );
    console.log();

    // 6. Pick focus area
    const focus = await pickFocus(rl, configs.length);
    saveFocus(focus);
    const focusLabel = FOCUS_MENU.find((m) => m.value === focus)?.label ?? focus;
    console.log(`\n  ${green('✓')} Focus: ${bold(focusLabel)}\n`);

    // 7. Offer to run tests immediately
    const runNow = (await rl.question(`${bold('Run tests now?')} [Y/n]: `)).trim().toLowerCase();
    rl.close();

    if (runNow !== 'n' && runNow !== 'no') {
      console.log(`\n${ts()} ${magenta('🎯 Launching enterprise quality checks…')}\n${'─'.repeat(60)}\n`);
      const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      // Stamp a run ID so all artifact paths for this run share one folder.
      const runId = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
      process.env.PBI_RUN_ID = runId;
      console.log(dim(`  Run ID: ${runId}  →  test-archive/${runId}/\n`));
      const testStart = Date.now();
      spawn(npm, ['run', 'test:enterprise'], { stdio: 'inherit' }).on('exit', (code) => {
        const reportPath = `test-archive/${runId}/html-report`;
        console.log(`\n${ts()} ${dim(`Tests finished ${elapsed(testStart)}`)}`);
        // Ask user to open the report rather than printing a raw command.
        const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl2.question(`\n${bold('Open HTML report?')} [Y/n]: `).then((answer) => {
          rl2.close();
          if (answer.trim().toLowerCase() !== 'n') {
            console.log(dim(`  Opening ${reportPath}…`));
            spawn('npx', ['playwright', 'show-report', reportPath], { stdio: 'inherit', shell: true })
              .on('exit', () => process.exit(code ?? 0));
          } else {
            process.exit(code ?? 0);
          }
        }).catch(() => process.exit(code ?? 0));
      });
    }
  } finally {
    if (!rl.terminal) rl.close();
  }
}

void main().catch((error: unknown) => {
  console.error(red('\n✖ Discovery failed:'), error instanceof Error ? error.message : String(error));
  process.exit(1);
});

