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

loadEnvFile();

// ── colours ───────────────────────────────────────────────────────────────────

const bold    = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim     = (s: string) => `\x1b[2m${s}\x1b[0m`;
const cyan    = (s: string) => `\x1b[36m${s}\x1b[0m`;
const green   = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow  = (s: string) => `\x1b[33m${s}\x1b[0m`;
const red     = (s: string) => `\x1b[31m${s}\x1b[0m`;
const magenta = (s: string) => `\x1b[35m${s}\x1b[0m`;

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

// ── main ─────────────────────────────────────────────────────────────────────

async function runCi(credentials: ReturnType<typeof readEnterpriseCredentialsFromEnv> & object): Promise<void> {
  const workspaceName   = process.env.PBI_WORKSPACE_NAME!;
  const reportName      = process.env.PBI_REPORT_NAME!;
  const datasetName     = process.env.PBI_DATASET_NAME ?? reportName;
  const pageDisplayName = process.env.PBI_PAGE_NAME;

  console.log(`\n${bold(magenta('⚡ Power BI Test Setup'))} ${dim('(CI mode)')}\n`);

  const endpoints  = getPowerBiEndpoints(credentials.environment);
  console.log(dim('Authenticating…'));
  const accessToken = await getAccessToken(credentials, endpoints);
  console.log(green('✓ Authenticated\n'));

  const workspace = await findWorkspaceByName(accessToken, workspaceName, endpoints);
  if (!workspace) throw new Error(`Workspace '${workspaceName}' not found.`);

  const dataset = await findDatasetByName(accessToken, workspace.id, datasetName, endpoints);
  if (!dataset) throw new Error(`Dataset '${datasetName}' not found in '${workspaceName}'.`);

  const report = await findReportByName(accessToken, workspace.id, reportName, endpoints);
  if (!report) throw new Error(`Report '${reportName}' not found in '${workspaceName}'.`);

  const pages = await listReportPages(accessToken, workspace.id, report.id, endpoints);
  if (pages.length === 0) throw new Error(`Report '${reportName}' has no pages.`);

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

  const endpoints = getPowerBiEndpoints(credentials.environment);
  console.log(dim('Authenticating…'));
  const accessToken = await getAccessToken(credentials, endpoints);
  console.log(green('✓ Authenticated\n'));

  const rl = readline.createInterface({ input, output });

  try {
    // 1. Pick workspace
    const workspaces = await listWorkspaces(accessToken, endpoints);
    if (workspaces.length === 0) throw new Error('No workspaces found.');
    const workspace: PowerBiWorkspace = await pickOne(rl, workspaces, 'Workspaces');
    console.log(`\n  ${green('✓')} Workspace: ${bold(workspace.name)}`);

    // 2. Pick reports (multi-select)
    const allReports = await listReports(accessToken, workspace.id, endpoints);
    if (allReports.length === 0) throw new Error(`No reports in workspace "${workspace.name}".`);
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
    const datasets = await listDatasets(accessToken, workspace.id, endpoints);

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

      const pages = await listReportPages(accessToken, workspace.id, report.id, endpoints);
      if (pages.length === 0) {
        console.log(yellow(`  ⚠  No pages found for "${report.name}" — skipping.`));
        continue;
      }

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

    console.log(`\n${bold(green('✅ Discovery complete'))} — ${configs.length} test(s) queued:\n`);
    configs.forEach((c) =>
      console.log(`    ${dim('▸')} ${c.reportName} ${dim('›')} ${cyan(c.pageDisplayName)}`),
    );
    console.log();

    // 6. Offer to run tests immediately
    const runNow = (await rl.question(`${bold('Run tests now?')} [Y/n]: `)).trim().toLowerCase();
    rl.close();

    if (runNow !== 'n' && runNow !== 'no') {
      console.log(`\n${magenta('🎯 Launching full test suite (metadata + visual)…')}\n${'─'.repeat(60)}\n`);
      const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      // Stamp a run ID so all artifact paths for this run share one folder.
      const runId = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
      process.env.PBI_RUN_ID = runId;
      console.log(dim(`  Run ID: ${runId}  →  test-archive/${runId}/\n`));
      spawn(npm, ['run', 'test:full'], { stdio: 'inherit' }).on('exit', (code) => {
        process.exit(code ?? 0);
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

