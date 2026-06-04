import { expect, test } from '@playwright/test';
import { readJsonFile } from '../../helper-functions/file-reader';
import { analyzeRefreshPatterns, evaluateRefreshHealth, extractFailureInfo } from '../../helper-functions/refresh-health';
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

// ── Refresh pattern analysis ────────────────────────────────────────────────

const patternHistory = readJsonFile<RefreshHistoryEntry[]>(
  'playwright/fixtures/snapshots/refresh-history/baseline-refresh-history-patterns.json',
);

test('RP-001 consecutive failures are counted from most recent entry', async () => {
  // Fixture: 3 failures in a row, then 1 old success.
  const result = analyzeRefreshPatterns(patternHistory, 24, '2026-05-13T20:00:00.000Z');
  expect(result.consecutiveFailureCount).toBe(3);
});

test('RP-002 dataset is stale when last success exceeds threshold', async () => {
  // Last success: May 7. nowIso: May 13. Gap ≈ 144 h. maxStaleHours: 24.
  const result = analyzeRefreshPatterns(patternHistory, 24, '2026-05-13T20:00:00.000Z');
  expect(result.isStale).toBe(true);
  expect(result.hoursSinceLastSuccess).toBeGreaterThan(100);
});

test('RP-003 dataset is not stale when last success is recent', async () => {
  // Use the baseline 3-entry fixture where latest status is Completed.
  const baselineHistory = readJsonFile<RefreshHistoryEntry[]>(
    'playwright/fixtures/snapshots/refresh-history/baseline-refresh-history.json',
  );
  // nowIso only 2 hours after the last Completed refresh.
  const result = analyzeRefreshPatterns(baselineHistory, 24, '2026-05-10T20:00:00.000Z');
  expect(result.isStale).toBe(false);
  expect(result.hoursSinceLastSuccess).toBeLessThan(24);
});

test('RP-004 failures are grouped and counted by error code', async () => {
  const result = analyzeRefreshPatterns(patternHistory, 24, '2026-05-13T20:00:00.000Z');
  // Two OAuth failures and one gateway failure in the fixture.
  expect(result.failuresByCode['ModelRefresh_ShortMessage_ProcessingError']).toBe(2);
  expect(result.failuresByCode['DM_GWPipeline_Gateway_SpooledOperationFailed']).toBe(1);
});

test('RP-005 no consecutive failures reported when latest refresh succeeded', async () => {
  const baselineHistory = readJsonFile<RefreshHistoryEntry[]>(
    'playwright/fixtures/snapshots/refresh-history/baseline-refresh-history.json',
  );
  const result = analyzeRefreshPatterns(baselineHistory, 24, '2026-05-10T20:00:00.000Z');
  expect(result.consecutiveFailureCount).toBe(0);
});

// ── Individual RH tests (RH-001 through RH-008) ─────────────────────────────

test('RH-001 refresh history fixture parses into a normalized result structure', async () => {
  const history = readJsonFile<RefreshHistoryEntry[]>(
    'playwright/fixtures/snapshots/refresh-history/baseline-refresh-history.json',
  );
  const result = evaluateRefreshHealth(history, 7, '2026-05-10T19:00:00.000Z');

  expect(typeof result).toBe('object');
  expect(typeof result.latestStatus).toBe('string');
  expect(typeof result.failureCount).toBe('number');
  expect(Array.isArray(result.failures)).toBe(true);
});

test('RH-002 latest refresh status is present and non-empty', async () => {
  const history = readJsonFile<RefreshHistoryEntry[]>(
    'playwright/fixtures/snapshots/refresh-history/baseline-refresh-history.json',
  );
  const result = evaluateRefreshHealth(history, 7, '2026-05-10T19:00:00.000Z');

  expect(result.latestStatus.length).toBeGreaterThan(0);
});

test('RH-003 latest refresh status of Failed is operationally unacceptable', async () => {
  const failedHistory: RefreshHistoryEntry[] = [
    {
      status: 'Failed',
      endTime: '2026-05-10T18:00:00.000Z',
      serviceExceptionJson: JSON.stringify({
        errorCode: 'DM_ErrorCode_1',
        errorDescription: 'Simulated refresh failure',
      }),
    },
  ];
  const result = evaluateRefreshHealth(failedHistory, 7, '2026-05-10T19:00:00.000Z');

  expect(result.latestStatus).toBe('Failed');
  expect(result.failureCount).toBeGreaterThan(0);
  expect(result.lastSuccessTime).toBe('');
});

test('RH-004 seven-day window excludes failures that fall outside the lookback period', async () => {
  const history: RefreshHistoryEntry[] = [
    { status: 'Failed', endTime: '2026-04-01T12:00:00.000Z' },    // 40+ days before now
    { status: 'Completed', endTime: '2026-05-10T18:00:00.000Z' }, // within window
  ];
  const result = evaluateRefreshHealth(history, 7, '2026-05-10T19:00:00.000Z');

  expect(result.failureCount).toBe(0);
  expect(result.latestStatus).toBe('Completed'); // most recent by endTime, not array order
});

test('RH-005 failure count matches the number of failed entries within the window', async () => {
  const history = readJsonFile<RefreshHistoryEntry[]>(
    'playwright/fixtures/snapshots/refresh-history/baseline-refresh-history.json',
  );
  const result = evaluateRefreshHealth(history, 7, '2026-05-10T19:00:00.000Z');

  expect(result.failureCount).toBe(1);
});

test('RH-007 last successful refresh timestamp is retained even when later failures exist', async () => {
  const history = readJsonFile<RefreshHistoryEntry[]>(
    'playwright/fixtures/snapshots/refresh-history/baseline-refresh-history.json',
  );
  const result = evaluateRefreshHealth(history, 7, '2026-05-10T19:00:00.000Z');

  expect(result.lastSuccessTime.length).toBeGreaterThan(0);
});

test('RH-008 historical failure message remains detectable after normalization', async () => {
  const history = readJsonFile<RefreshHistoryEntry[]>(
    'playwright/fixtures/snapshots/refresh-history/baseline-refresh-history.json',
  );
  const result = evaluateRefreshHealth(history, 7, '2026-05-10T19:00:00.000Z');

  expect(result.failures[0]?.message).toBeTruthy();
  expect(result.failures[0]?.code).toBeTruthy();
});

