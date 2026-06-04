import { expect, test } from '@playwright/test';
import { EnterpriseReportConfig } from '../../helper-functions/enterprise-config';
import { readJsonFile } from '../../helper-functions/file-reader';
import { ModelSignature, RefreshHealthResult, RefreshHistoryEntry } from '../../helper-functions/types';

test('FX-002 refresh history fixture matches contract', async () => {
  const refreshHistory = readJsonFile<RefreshHistoryEntry[]>(
    'playwright/fixtures/snapshots/refresh-history/baseline-refresh-history.json',
  );

  expect(refreshHistory.length).toBeGreaterThan(0);
  expect(refreshHistory[0]).toHaveProperty('status');
});

test('FX-003 model signature snapshot matches contract', async () => {
  const modelSignature = readJsonFile<ModelSignature>(
    'playwright/fixtures/snapshots/model-signatures/baseline-model-signature.json',
  );

  expect(typeof modelSignature.datasetName).toBe('string');
  expect(modelSignature.datasetName.length).toBeGreaterThan(0);
  expect(modelSignature.tableCount).toBeGreaterThan(0);
  expect(modelSignature.tables.length).toBe(modelSignature.tableCount);
});

test('FX-004 refresh health summary matches contract', async () => {
  const refreshSummary = readJsonFile<RefreshHealthResult>(
    'playwright/fixtures/snapshots/refresh-history/baseline-refresh-health.json',
  );

  expect(refreshSummary.windowDays).toBe(7);
  expect(refreshSummary.latestStatus).not.toBe('');
});

// ── Enterprise config fixture contracts (VS-001, VS-002) ────────────────────

test('VS-001 sample enterprise config fixture resolves to at least one entry', async () => {
  const configs = readJsonFile<EnterpriseReportConfig[]>(
    'playwright/fixtures/snapshots/enterprise-config/sample-enterprise-config.json',
  );

  expect(Array.isArray(configs)).toBe(true);
  expect(configs.length).toBeGreaterThan(0);
  expect(configs[0]!.reportId.length).toBeGreaterThan(0);
  expect(configs[0]!.pageId.length).toBeGreaterThan(0);
});

test('VS-002 every entry in the sample enterprise config has all required string fields non-empty', async () => {
  const configs = readJsonFile<EnterpriseReportConfig[]>(
    'playwright/fixtures/snapshots/enterprise-config/sample-enterprise-config.json',
  );

  const requiredFields: (keyof EnterpriseReportConfig)[] = [
    'workspaceId', 'workspaceName', 'datasetId', 'datasetName',
    'reportId', 'reportName', 'pageId', 'pageName', 'pageDisplayName',
    'embedUrl', 'reportUrl', 'discoveredAt',
  ];

  for (const config of configs) {
    for (const field of requiredFields) {
      expect(
        typeof config[field] === 'string' && config[field].length > 0,
        `field "${field}" must be a non-empty string`,
      ).toBe(true);
    }
  }
});
