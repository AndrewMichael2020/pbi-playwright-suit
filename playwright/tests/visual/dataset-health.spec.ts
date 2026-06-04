/**
 * Live dataset health checks — enterprise project.
 *
 * These tests run against the real Power BI REST API using the same
 * enterprise.generated.json written by `npm run setup`.  They independently
 * FAIL when a dataset is in a broken state so the HTML report clearly shows
 * which health dimension failed, separate from the visual render tests.
 *
 * Tests are deduplicated per dataset — if 4 pages share one dataset only one
 * set of health checks runs, not four.
 *
 * Thresholds (all overridable via .env):
 *   PBI_MAX_REFRESH_FAILURES     default 2   (failures in 7-day window)
 *   PBI_MAX_CONSECUTIVE_FAILURES default 2   (failures in a row)
 *   PBI_MAX_STALE_HOURS          default 48  (hours since last success)
 */

import { expect, test } from '@playwright/test';
import {
  getAccessToken,
  getDataSources,
  getRefreshHistory,
  getPowerBiEndpoints,
  readEnterpriseCredentialsFromEnv,
} from '../../helper-functions/powerbi-enterprise';
import { loadEnterpriseConfigs } from '../../helper-functions/enterprise-config';
import {
  analyzeRefreshPatterns,
  evaluateRefreshHealth,
  extractFailureInfo,
} from '../../helper-functions/refresh-health';

const allConfigs = loadEnterpriseConfigs();
const enterpriseCredentials = readEnterpriseCredentialsFromEnv();

const skipReason = !allConfigs
  ? 'Run npm run setup first.'
  : !enterpriseCredentials
    ? 'Unable to build enterprise auth settings.'
    : '';

// Deduplicate by datasetId — one set of health checks per dataset, not per page.
const uniqueDatasets = new Map<string, NonNullable<typeof allConfigs>[number]>();
for (const config of allConfigs ?? []) {
  if (!uniqueDatasets.has(config.datasetId)) {
    uniqueDatasets.set(config.datasetId, config);
  }
}

const MAX_REFRESH_FAILURES     = parseInt(process.env.PBI_MAX_REFRESH_FAILURES     ?? '2',  10);
const MAX_CONSECUTIVE_FAILURES = parseInt(process.env.PBI_MAX_CONSECUTIVE_FAILURES ?? '2',  10);
const MAX_STALE_HOURS          = parseInt(process.env.PBI_MAX_STALE_HOURS          ?? '48', 10);

// ─────────────────────────────────────────────────────────────────────────────

test.describe('Dataset health', () => {
  test.skip(Boolean(skipReason), skipReason);

  for (const config of uniqueDatasets.values()) {
    test.describe(config.datasetName, () => {
      // Helper — acquires token (uses cache, nearly instant on 2nd call).
      async function liveContext() {
        const endpoints = getPowerBiEndpoints(enterpriseCredentials!.environment);
        const accessToken = await getAccessToken(enterpriseCredentials!, endpoints);
        return { endpoints, accessToken };
      }

      // ── RH-001 ────────────────────────────────────────────────────────────
      test('RH-001 refresh history is available and non-empty', async ({}, testInfo) => {
        testInfo.annotations.push(
          { type: 'dataset',   description: config.datasetName },
          { type: 'workspace', description: config.workspaceName },
          { type: 'dataset-id', description: config.datasetId },
        );

        const { endpoints, accessToken } = await liveContext();
        const history = await getRefreshHistory(
          accessToken, config.workspaceId, config.datasetId, endpoints, 20,
        );

        expect(
          history.length,
          'No refresh history returned — dataset may never have been refreshed, or the ' +
          'service account lacks Contributor access to the workspace.',
        ).toBeGreaterThan(0);
      });

      // ── RH-002 ────────────────────────────────────────────────────────────
      test('RH-002 latest refresh status is operationally acceptable', async ({}, testInfo) => {
        testInfo.annotations.push({ type: 'dataset', description: config.datasetName });

        const { endpoints, accessToken } = await liveContext();
        const history = await getRefreshHistory(
          accessToken, config.workspaceId, config.datasetId, endpoints, 20,
        );

        if (history.length === 0) {
          test.skip(true, 'No refresh history — RH-001 covers the empty case.');
          return;
        }

        const health = evaluateRefreshHealth(history, 7, new Date().toISOString());

        testInfo.annotations.push(
          { type: 'latest-status',  description: health.latestStatus },
          { type: 'latest-refresh', description: health.latestRefreshTime || 'unknown' },
        );

        if (health.latestStatus === 'Failed') {
          const { code, message } = extractFailureInfo(history);
          testInfo.annotations.push({
            type: '⚠️ REFRESH FAILED',
            description: [code, message].filter(Boolean).join(': ') || 'no error detail available',
          });
        }

        const BAD_STATUSES = new Set(['Failed', 'Disabled', 'Cancelled']);
        expect(
          BAD_STATUSES.has(health.latestStatus),
          `Latest refresh status "${health.latestStatus}" is operationally unacceptable.  ` +
          `Last refresh: ${health.latestRefreshTime || 'unknown'}.`,
        ).toBe(false);
      });

      // ── RH-003 ────────────────────────────────────────────────────────────
      test(`RH-003 refresh failures in 7-day window do not exceed threshold (${MAX_REFRESH_FAILURES})`, async ({}, testInfo) => {
        testInfo.annotations.push({ type: 'dataset', description: config.datasetName });

        const { endpoints, accessToken } = await liveContext();
        const history = await getRefreshHistory(
          accessToken, config.workspaceId, config.datasetId, endpoints, 20,
        );

        if (history.length === 0) {
          test.skip(true, 'No refresh history — RH-001 covers the empty case.');
          return;
        }

        const health = evaluateRefreshHealth(history, 7, new Date().toISOString());

        testInfo.annotations.push({
          type: 'failure-count-7d',
          description: String(health.failureCount),
        });

        for (const f of health.failures) {
          testInfo.annotations.push({
            type: 'failure',
            description: `${f.time}: ${f.code} — ${f.message || '(no message)'}`,
          });
        }

        expect(
          health.failureCount,
          `Dataset had ${health.failureCount} refresh failure(s) in the last 7 days ` +
          `(threshold: ${MAX_REFRESH_FAILURES}).  Set PBI_MAX_REFRESH_FAILURES to adjust.`,
        ).toBeLessThanOrEqual(MAX_REFRESH_FAILURES);
      });

      // ── RH-004 ────────────────────────────────────────────────────────────
      test(`RH-004 consecutive failures from most recent refresh do not exceed threshold (${MAX_CONSECUTIVE_FAILURES})`, async ({}, testInfo) => {
        testInfo.annotations.push({ type: 'dataset', description: config.datasetName });

        const { endpoints, accessToken } = await liveContext();
        const history = await getRefreshHistory(
          accessToken, config.workspaceId, config.datasetId, endpoints, 20,
        );

        if (history.length === 0) {
          test.skip(true, 'No refresh history — RH-001 covers the empty case.');
          return;
        }

        const patterns = analyzeRefreshPatterns(history, MAX_STALE_HOURS, new Date().toISOString());

        testInfo.annotations.push({
          type: 'consecutive-failures',
          description: String(patterns.consecutiveFailureCount),
        });

        expect(
          patterns.consecutiveFailureCount,
          `Dataset has ${patterns.consecutiveFailureCount} consecutive refresh failure(s).  ` +
          `Set PBI_MAX_CONSECUTIVE_FAILURES to adjust.`,
        ).toBeLessThanOrEqual(MAX_CONSECUTIVE_FAILURES);
      });

      // ── RH-005 ────────────────────────────────────────────────────────────
      test(`RH-005 dataset is not stale — last successful refresh within ${MAX_STALE_HOURS}h`, async ({}, testInfo) => {
        testInfo.annotations.push({ type: 'dataset', description: config.datasetName });

        const { endpoints, accessToken } = await liveContext();
        const history = await getRefreshHistory(
          accessToken, config.workspaceId, config.datasetId, endpoints, 20,
        );

        if (history.length === 0) {
          test.skip(true, 'No refresh history — RH-001 covers the empty case.');
          return;
        }

        const patterns = analyzeRefreshPatterns(history, MAX_STALE_HOURS, new Date().toISOString());

        testInfo.annotations.push({
          type: 'hours-since-success',
          description:
            patterns.hoursSinceLastSuccess !== null
              ? `${patterns.hoursSinceLastSuccess.toFixed(1)}h`
              : 'never refreshed successfully',
        });

        expect(
          patterns.isStale,
          `Dataset last succeeded ${patterns.hoursSinceLastSuccess?.toFixed(1) ?? 'never'} hours ago.  ` +
          `Threshold is ${MAX_STALE_HOURS}h.  Set PBI_MAX_STALE_HOURS to adjust.`,
        ).toBe(false);
      });

      // ── DS-001 ────────────────────────────────────────────────────────────
      test('DS-001 all data source connections are configured', async ({}, testInfo) => {
        testInfo.annotations.push({ type: 'dataset', description: config.datasetName });

        const { endpoints, accessToken } = await liveContext();

        let sources;
        try {
          sources = await getDataSources(
            accessToken, config.workspaceId, config.datasetId, endpoints,
          );
        } catch (err: unknown) {
          // Some dataset types (streaming, push) do not expose the datasources endpoint.
          // Treat as a non-fatal skip rather than a hard failure.
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes('400') || msg.includes('404') || msg.includes('NotSupported')) {
            test.skip(true, `Datasources endpoint not available for this dataset type: ${msg}`);
            return;
          }
          throw err;
        }

        testInfo.annotations.push({
          type: 'datasource-count',
          description: String(sources.length),
        });

        const missing = sources.filter(
          (s) => Object.keys(s.connectionDetails).length === 0,
        );

        for (const s of missing) {
          testInfo.annotations.push({
            type: '⚠️ MISSING CONNECTION',
            description:
              `${s.datasourceType || 'Unknown'} datasource has no connection details — ` +
              `this causes "unable to access data source" errors at refresh time.`,
          });
        }

        expect(
          missing.length,
          `${missing.length} data source(s) have empty connection details.  ` +
          `Open the dataset settings in Power BI Service and bind the data source.`,
        ).toBe(0);
      });
    });
  }
});
