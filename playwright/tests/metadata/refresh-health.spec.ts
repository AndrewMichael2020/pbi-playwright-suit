import { expect, test } from '@playwright/test';
import { readJsonFile } from '../../helper-functions/file-reader';
import { evaluateRefreshHealth, extractFailureInfo } from '../../helper-functions/refresh-health';
import { RefreshHealthResult, RefreshHistoryEntry } from '../../helper-functions/types';

test('RH-001 through RH-008 refresh history is normalized and evaluated', async () => {
  const refreshHistory = readJsonFile<RefreshHistoryEntry[]>(
    'playwright/fixtures/snapshots/refresh-history/baseline-refresh-history.json',
  );
  const result = evaluateRefreshHealth(refreshHistory, 7, '2026-05-10T19:00:00.000Z');

  expect(result.latestStatus).toBe('Completed');
  expect(result.latestRefreshTime).toBe('2026-05-10T18:06:34.967Z');
  expect(result.failureCount).toBe(1);
  expect(result.failures[0]).toMatchObject({
    code: 'ModelRefresh_ShortMessage_ProcessingError',
    message: 'Failed to get OAuth resource id, please make sure the OAuth is supported',
    withinWindow: true,
  });
  expect(result.lastSuccessTime).toBe('2026-05-10T18:06:34.967Z');
});

test('RH-006 nested failure payload extracts code and message', async () => {
  const refreshHistory = readJsonFile<RefreshHistoryEntry[]>(
    'playwright/fixtures/snapshots/refresh-history/baseline-refresh-history.json',
  );
  const failure = extractFailureInfo(refreshHistory);

  expect(failure).toEqual({
    code: 'ModelRefresh_ShortMessage_ProcessingError',
    message: 'Failed to get OAuth resource id, please make sure the OAuth is supported',
  });
});

test('FX-004 committed refresh health summary stays aligned', async () => {
  const summary = readJsonFile<RefreshHealthResult>(
    'playwright/fixtures/snapshots/refresh-history/baseline-refresh-health.json',
  );

  expect(summary.failureCount).toBe(1);
  expect(summary.lastKnownFailure?.code).toBe('ModelRefresh_ShortMessage_ProcessingError');
});
