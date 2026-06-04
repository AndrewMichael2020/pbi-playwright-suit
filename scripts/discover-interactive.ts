/**
 * Interactive Power BI discovery — sorted, searchable, multi-select.
 *
 * Supports:
 *   - Single report:           enter one number
 *   - Several reports:         enter comma-separated numbers  e.g. 1,3,5
 *   - All reports in workspace: enter "all"
 *
 * For each selected report you choose which pages to include:
 *   first  — first page only (default for bulk selection)
 *   all    — every page
 *   pick   — numbered menu per report
 *
 * Writes playwright/config/upcc-enterprise.generated.json as an array.
 * Each array entry becomes one Playwright visual smoke test.
 */

import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
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
  saveUpccEnterpriseConfigs,
  type UpccEnterpriseConfig,
} from '../playwright/helper-functions/upcc-enterprise-config';

loadEnvFile();

// ── helpers ──────────────────────────────────────────────────────────────────

function sortByName<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name));
}

function filterBySearch<T extends { name: string }>(items: T[], query: string): T[] {
  if (!query) return items;
  const q = query.toLowerCase();
  return items.filter((i) => i.name.toLowerCase().includes(q));
}

function printList<T extends { name: string }>(items: T[], label: string): void {
  console.log(`\nAvailable ${label} (${items.length}):`);
  items.forEach((item, i) => console.log(`  [${String(i + 1).padStart(3)}] ${item.name}`));
}

async function searchAndFilter<T extends { name: string }>(
  rl: readline.Interface,
  items: T[],
  label: string,
): Promise<T[]> {
  const query = (await rl.question(`\nSearch ${label} (press Enter to show all): `)).trim();
  const filtered = filterBySearch(sortByName(items), query);
  if (filtered.length === 0) {
    console.log('  No matches. Showing full list.');
    return sortByName(items);
  }
  return filtered;
}

async function pickOne<T extends { name: string }>(
  rl: readline.Interface,
  items: T[],
  label: string,
): Promise<T> {
  const filtered = await searchAndFilter(rl, items, label);
  printList(filtered, label);
  while (true) {
    const answer = (await rl.question(`\nEnter number (1–${filtered.length}): `)).trim();
    const idx = parseInt(answer, 10) - 1;
    if (idx >= 0 && idx < filtered.length) return filtered[idx]!;
    console.log(`  Enter a number between 1 and ${filtered.length}.`);
  }
}

async function pickMany<T extends { name: string }>(
  rl: readline.Interface,
  items: T[],
  label: string,
): Promise<T[]> {
  const filtered = await searchAndFilter(rl, items, label);
  printList(filtered, label);
  while (true) {
    const answer = (
      await rl.question(`\nEnter number(s) — single: 1  comma list: 1,3,5  range: 2-6  all: all\n> `)
    ).trim().toLowerCase();

    if (answer === 'all') return filtered;

    // Parse comma-separated tokens, each of which may be a range "a-b" or a number
    const indices = new Set<number>();
    let valid = true;
    for (const token of answer.split(',').map((t) => t.trim())) {
      const range = token.match(/^(\d+)-(\d+)$/);
      if (range) {
        const lo = parseInt(range[1]!, 10);
        const hi = parseInt(range[2]!, 10);
        if (lo < 1 || hi > filtered.length || lo > hi) { valid = false; break; }
        for (let n = lo; n <= hi; n++) indices.add(n - 1);
      } else {
        const n = parseInt(token, 10);
        if (isNaN(n) || n < 1 || n > filtered.length) { valid = false; break; }
        indices.add(n - 1);
      }
    }

    if (valid && indices.size > 0) {
      return [...indices].sort((a, b) => a - b).map((i) => filtered[i]!);
    }
    console.log(`  Invalid input. Use numbers 1–${filtered.length}, commas, ranges, or "all".`);
  }
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const credentials = readEnterpriseCredentialsFromEnv();
  if (!credentials) throw new Error('Unable to build enterprise auth settings.');

  const endpoints = getPowerBiEndpoints(credentials.environment);
  console.log('Authenticating…');
  const accessToken = await getAccessToken(credentials, endpoints);

  const rl = readline.createInterface({ input, output });

  try {
    // 1. Pick workspace
    const workspaces = await listWorkspaces(accessToken, endpoints);
    if (workspaces.length === 0) throw new Error('No workspaces found.');
    const workspace: PowerBiWorkspace = await pickOne(rl, workspaces, 'workspaces');
    console.log(`\nWorkspace: ${workspace.name} (${workspace.id})`);

    // 2. Pick reports (multi-select)
    const allReports = await listReports(accessToken, workspace.id, endpoints);
    if (allReports.length === 0) throw new Error(`No reports in workspace '${workspace.name}'.`);
    const selectedReports: PowerBiReport[] = await pickMany(rl, allReports, 'reports');
    console.log(`\nSelected ${selectedReports.length} report(s).`);

    // 3. Page selection strategy
    let pageStrategy: 'first' | 'all' | 'pick' = 'first';
    if (selectedReports.length > 1) {
      while (true) {
        const ans = (
          await rl.question('\nPages per report — first / all / pick: ')
        ).trim().toLowerCase();
        if (ans === 'first' || ans === 'all' || ans === 'pick') {
          pageStrategy = ans as 'first' | 'all' | 'pick';
          break;
        }
        console.log('  Enter: first, all, or pick');
      }
    } else {
      pageStrategy = 'pick';
    }

    // 4. Resolve datasets once
    const datasets = await listDatasets(accessToken, workspace.id, endpoints);

    // 5. Build config entries
    const configs: UpccEnterpriseConfig[] = [];

    for (const report of selectedReports) {
      const dataset =
        (report.datasetId ? datasets.find((d) => d.id === report.datasetId) : undefined) ??
        datasets.find((d) => d.name === report.name) ??
        datasets[0];

      if (!dataset) {
        console.warn(`  ⚠ No dataset resolved for "${report.name}" — skipping.`);
        continue;
      }

      const pages = await listReportPages(accessToken, workspace.id, report.id, endpoints);
      if (pages.length === 0) {
        console.warn(`  ⚠ No pages found for "${report.name}" — skipping.`);
        continue;
      }

      let chosenPages = pages;
      if (pageStrategy === 'first') {
        chosenPages = [pages[0]!];
      } else if (pageStrategy === 'pick') {
        const pagesAsNamed = pages.map((p) => ({ ...p, name: p.displayName }));
        const picked = await pickMany(rl, pagesAsNamed, `pages for "${report.name}"`);
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

    saveUpccEnterpriseConfigs(configs);

    console.log(`\nDiscovery complete — ${configs.length} test(s) written:`);
    configs.forEach((c) => console.log(`  ${c.reportName} › ${c.pageDisplayName}`));
    console.log('\nOutput: playwright/config/upcc-enterprise.generated.json');
    console.log('Run:    npm run test:visual\n');
  } finally {
    rl.close();
  }
}

void main().catch((error: unknown) => {
  console.error('Discovery failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
