import {
  findDatasetByName,
  findReportByName,
  findWorkspaceByName,
  getAccessToken,
  getPowerBiEndpoints,
  listReportPages,
  readEnterpriseCredentialsFromEnv,
} from '../playwright/helper-functions/powerbi-enterprise';
import { saveUpccEnterpriseConfig } from '../playwright/helper-functions/upcc-enterprise-config';

async function main(): Promise<void> {
  const credentials = readEnterpriseCredentialsFromEnv();
  if (!credentials) {
    throw new Error('Missing CLIENT_ID, CLIENT_SECRET, or TENANT_ID. Set them before running enterprise discovery.');
  }

  const workspaceName = process.env.UPCC_WORKSPACE_NAME ?? 'FHA-ADAR-BI-UAT';
  const reportName = process.env.UPCC_REPORT_NAME ?? 'UPCC Dashboard';
  const datasetName = process.env.UPCC_DATASET_NAME ?? 'UPCC Dashboard';
  const pageDisplayName = process.env.UPCC_PAGE_NAME;
  const endpoints = getPowerBiEndpoints(credentials.environment);
  const accessToken = await getAccessToken(credentials, endpoints);

  const workspace = await findWorkspaceByName(accessToken, workspaceName, endpoints);
  if (!workspace) {
    throw new Error(`Workspace '${workspaceName}' was not found. Confirm the service principal is a workspace member and can list groups.`);
  }

  const dataset = await findDatasetByName(accessToken, workspace.id, datasetName, endpoints);
  if (!dataset) {
    throw new Error(`Dataset '${datasetName}' was not found in workspace '${workspaceName}'.`);
  }

  const report = await findReportByName(accessToken, workspace.id, reportName, endpoints);
  if (!report) {
    throw new Error(`Report '${reportName}' was not found in workspace '${workspaceName}'.`);
  }

  const pages = await listReportPages(accessToken, workspace.id, report.id, endpoints);
  if (pages.length === 0) {
    throw new Error(`Report '${reportName}' returned no pages.`);
  }

  const page =
    (pageDisplayName ? pages.find((candidate) => candidate.displayName === pageDisplayName) : undefined) ?? pages[0];

  if (pageDisplayName && page.displayName !== pageDisplayName) {
    throw new Error(`Configured UPCC_PAGE_NAME '${pageDisplayName}' was not found in report '${reportName}'.`);
  }

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
    pageDisplayName: page.displayName,
    embedUrl: report.embedUrl ?? '',
    reportUrl,
    discoveredAt: new Date().toISOString(),
  });

  console.log(`Discovered UPCC enterprise config:
- workspace: ${workspace.name} (${workspace.id})
- dataset: ${dataset.name} (${dataset.id})
- report: ${report.name} (${report.id})
- page: ${page.displayName} (${page.name})
- output: playwright/config/upcc-enterprise.generated.json`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
