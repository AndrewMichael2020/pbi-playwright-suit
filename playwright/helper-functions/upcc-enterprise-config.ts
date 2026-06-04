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

export function loadUpccEnterpriseConfig(): UpccEnterpriseConfig | null {
  if (!fs.existsSync(upccEnterpriseConfigPath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(upccEnterpriseConfigPath, 'utf8')) as UpccEnterpriseConfig;
}

export function saveUpccEnterpriseConfig(config: UpccEnterpriseConfig): void {
  fs.mkdirSync(path.dirname(upccEnterpriseConfigPath), { recursive: true });
  fs.writeFileSync(upccEnterpriseConfigPath, `${JSON.stringify(config, null, 2)}\n`);
}
