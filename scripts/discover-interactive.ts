/**
 * Interactive Power BI discovery script.
 *
 * Lists all workspaces and reports accessible to your account and lets you
 * pick which one to write to playwright/config/upcc-enterprise.generated.json.
 *
 * Usage:
 *   npm run discover:interactive
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
} from '../playwright/helper-functions/powerbi-enterprise';
import { loadEnvFile } from '../playwright/helper-functions/env-loader';
import { saveUpccEnterpriseConfig } from '../playwright/helper-functions/upcc-enterprise-config';

loadEnvFile();

function printNumberedMenu<T extends { name: string }>(items: T[], label: string): void {
  console.log(`\nAvailable ${label}:`);
  items.forEach((item, i) => console.log(`  [${i + 1}] ${item.name}`));
}

async function pickFromMenu<T extends { name: string }>(
  rl: readline.Interface,
  items: T[],
  label: string,
): Promise<T> {
  printNumberedMenu(items, label);
  while (true) {
    const answer = await rl.question(`\nEnter number (1–${items.length}): `);
    const index = parseInt(answer.trim(), 10) - 1;
    if (index >= 0 && index < items.length) {
      return items[index]!;
    }
    console.log(`  Please enter a number between 1 and ${items.length}.`);
  }
}

async function main(): Promise<void> {
  const credentials = readEnterpriseCredentialsFromEnv();
  if (!credentials) {
    throw new Error('Unable to build enterprise auth settings.');
  }

  const endpoints = getPowerBiEndpoints(credentials.environment);

  console.log('Authenticating…');
  const accessToken = await getAccessToken(credentials, endpoints);

  const rl = readline.createInterface({ input, output });

  try {
    // 1. Pick workspace
    const workspaces = await listWorkspaces(accessToken, endpoints);
    if (workspaces.length === 0) {
      throw new Error('No workspaces found. Confirm your account has access to at least one Power BI workspace.');
    }
    const workspace = await pickFromMenu(rl, workspaces, 'workspaces');
    console.log(`\nSelected workspace: ${workspace.name} (${workspace.id})`);

    // 2. Pick report
    const reports = await listReports(accessToken, workspace.id, endpoints);
    if (reports.length === 0) {
      throw new Error(`No reports found in workspace '${workspace.name}'.`);
    }
    const report = await pickFromMenu(rl, reports, 'reports');
    console.log(`Selected report:    ${report.name} (${report.id})`);

    // 3. Resolve dataset — prefer the one already linked to the report
    const datasets = await listDatasets(accessToken, workspace.id, endpoints);
    const dataset =
      (report.datasetId ? datasets.find((d) => d.id === report.datasetId) : undefined) ??
      datasets.find((d) => d.name === report.name) ??
      (datasets.length === 1 ? datasets[0] : await pickFromMenu(rl, datasets, 'datasets'));

    if (!dataset) {
      throw new Error(`Could not resolve a dataset for report '${report.name}'.`);
    }
    console.log(`Selected dataset:   ${dataset.name} (${dataset.id})`);

    // 4. Pick page
    const pages = await listReportPages(accessToken, workspace.id, report.id, endpoints);
    if (pages.length === 0) {
      throw new Error(`Report '${report.name}' returned no pages.`);
    }
    const page = pages.length === 1 ? pages[0]! : await pickFromMenu(
      rl,
      pages.map((p) => ({ ...p, name: p.displayName })),
      'pages',
    );
    console.log(`Selected page:      ${page.name} (${page.name})`);

    const reportUrl = `${endpoints.webPrefix}/groups/${workspace.id}/reports/${report.id}/${page.name}`;

    saveUpccEnterpriseConfig({
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      datasetId: dataset.id,
      datasetName: dataset.name,
      reportId: report.id,
      reportName: report.name,
      pageId: page.name,
      pageName: page.name,
      pageDisplayName: page.displayName ?? page.name,
      embedUrl: report.embedUrl ?? '',
      reportUrl,
      discoveredAt: new Date().toISOString(),
    });

    console.log(`
Discovery complete:
  workspace: ${workspace.name} (${workspace.id})
  dataset:   ${dataset.name} (${dataset.id})
  report:    ${report.name} (${report.id})
  page:      ${page.displayName ?? page.name} (${page.name})
  output:    playwright/config/upcc-enterprise.generated.json
`);
  } finally {
    rl.close();
  }
}

void main().catch((error: unknown) => {
  console.error('Discovery failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
