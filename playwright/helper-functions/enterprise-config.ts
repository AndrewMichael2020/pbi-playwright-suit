import fs from 'node:fs';
import path from 'node:path';

export interface EnterpriseReportConfig {
  workspaceId: string;
  workspaceName: string;
  datasetId: string;
  datasetName: string;
  reportId: string;
  reportName: string;
  pageId: string;
  pageName: string;
  pageDisplayName: string;
  embedUrl: string;
  reportUrl: string;
  discoveredAt: string;
}

export const enterpriseConfigPath = path.join(
  process.cwd(),
  'playwright',
  'config',
  'enterprise.generated.json',
);

/** Returns all discovered report+page entries, or null if discovery has not been run. */
export function loadEnterpriseConfigs(): EnterpriseReportConfig[] | null {
  if (!fs.existsSync(enterpriseConfigPath)) return null;
  const raw = JSON.parse(fs.readFileSync(enterpriseConfigPath, 'utf8')) as unknown;
  // Accept both legacy single-object format and current array format.
  return Array.isArray(raw) ? (raw as EnterpriseReportConfig[]) : [raw as EnterpriseReportConfig];
}

export function saveEnterpriseConfigs(configs: EnterpriseReportConfig[]): void {
  fs.mkdirSync(path.dirname(enterpriseConfigPath), { recursive: true });
  fs.writeFileSync(enterpriseConfigPath, `${JSON.stringify(configs, null, 2)}\n`);
}

export function saveEnterpriseConfig(config: EnterpriseReportConfig): void {
  saveEnterpriseConfigs([config]);
}

