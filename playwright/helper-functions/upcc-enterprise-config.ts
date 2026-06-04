import fs from 'node:fs';
import path from 'node:path';

export interface UpccEnterpriseConfig {
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

export const upccEnterpriseConfigPath = path.join(
  process.cwd(),
  'playwright',
  'config',
  'upcc-enterprise.generated.json',
);

/** Returns all discovered report+page entries, or null if not discovered yet. */
export function loadUpccEnterpriseConfigs(): UpccEnterpriseConfig[] | null {
  if (!fs.existsSync(upccEnterpriseConfigPath)) return null;
  const raw = JSON.parse(fs.readFileSync(upccEnterpriseConfigPath, 'utf8')) as unknown;
  // Accept both legacy single-object format and current array format.
  return Array.isArray(raw) ? (raw as UpccEnterpriseConfig[]) : [raw as UpccEnterpriseConfig];
}

export function saveUpccEnterpriseConfigs(configs: UpccEnterpriseConfig[]): void {
  fs.mkdirSync(path.dirname(upccEnterpriseConfigPath), { recursive: true });
  fs.writeFileSync(upccEnterpriseConfigPath, `${JSON.stringify(configs, null, 2)}\n`);
}

// Kept for non-interactive script backward compat.
export function saveUpccEnterpriseConfig(config: UpccEnterpriseConfig): void {
  saveUpccEnterpriseConfigs([config]);
}
