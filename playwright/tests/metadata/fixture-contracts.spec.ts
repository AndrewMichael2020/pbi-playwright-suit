import { expect, test } from '@playwright/test';
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
