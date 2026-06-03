import { expect, test } from '@playwright/test';
import { readCsv, readJsonFile } from '../../helper-functions/file-reader';
import { ModelSignature, RefreshHealthResult, RefreshHistoryEntry } from '../../helper-functions/types';

test('FX-001 report case file is parseable', async () => {
  const records = readCsv('playwright/test-cases/reports.csv');

  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({
    workspace_name: 'FHA-ADAR-BI-UAT',
    report_name: 'UPCC Dashboard',
    dataset_name: 'UPCC Dashboard',
  });
});

test('FX-002 refresh history fixture matches contract', async () => {
  const refreshHistory = readJsonFile<RefreshHistoryEntry[]>('playwright/fixtures/snapshots/refresh-history/upcc-refresh-history.json');

  expect(refreshHistory.length).toBeGreaterThan(0);
  expect(refreshHistory[0]).toHaveProperty('status');
});

test('FX-003 model signature snapshot matches contract', async () => {
  const modelSignature = readJsonFile<ModelSignature>('playwright/fixtures/snapshots/model-signatures/upcc-model-signature.json');

  expect(modelSignature.datasetName).toBe('UPCC Dashboard');
  expect(modelSignature.tableCount).toBeGreaterThan(0);
  expect(modelSignature.tables.length).toBe(modelSignature.tableCount);
});

test('FX-004 refresh health summary matches contract', async () => {
  const refreshSummary = readJsonFile<RefreshHealthResult>('playwright/fixtures/snapshots/refresh-history/upcc-refresh-health.json');

  expect(refreshSummary.windowDays).toBe(7);
  expect(refreshSummary.latestStatus).not.toBe('');
});
