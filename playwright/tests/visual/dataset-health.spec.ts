import { expect, test } from '@playwright/test';
import {
  getAccessToken,
  getRefreshHistory,
  getPowerBiEndpoints,
  readEnterpriseCredentials,
} from '../../helper-functions/powerbi-enterprise';
import { loadEnterpriseConfigs } from '../../helper-functions/enterprise-config';
import {
  evaluateRefreshHealth,
  extractFailureInfo,
  scanForDataIntegrityErrors,
  isBadRefreshStatus,
} from '../../helper-functions/refresh-health';
import { loadFocus, isInFocus } from '../../helper-functions/focus';

const allConfigs = loadEnterpriseConfigs();
const enterpriseCredentials = readEnterpriseCredentials();
const focus = loadFocus();

const skipReason = !allConfigs
  ? 'No report configs found — run npm run setup first.'
  : !isInFocus(focus, 'rh-002') && !isInFocus(focus, 'rh-003')
    ? `Focus is "${focus}" — dataset health checks are not in scope.`
    : '';

// Deduplicate by datasetId — one set of health checks per dataset, not per page.
const uniqueDatasets = new Map<string, NonNullable<typeof allConfigs>[number]>();
for (const config of allConfigs ?? []) {
  if (!uniqueDatasets.has(config.datasetId)) {
    uniqueDatasets.set(config.datasetId, config);
  }
}

test.describe('Dataset health', () => {
  if (skipReason) {
    test('⚠ suite skipped', () => {
      console.log(`  ↷  Dataset health skipped: ${skipReason}`);
      test.skip(true, skipReason);
    });
    return;
  }

  for (const config of uniqueDatasets.values()) {
    test.describe(config.datasetName, () => {
      async function liveContext() {
        const endpoints = getPowerBiEndpoints(enterpriseCredentials.environment);
        const accessToken = await getAccessToken(enterpriseCredentials, endpoints);
        return { endpoints, accessToken };
      }

      // ── RH-002 ────────────────────────────────────────────────────────────
      test('RH-002 latest refresh completed — visuals are not rendering stale or empty data', async ({}, testInfo) => {
        if (!isInFocus(focus, 'rh-002')) {
          const reason = `Focus is "${focus}" — select refresh-failures or refresh-health to run this check.`;
          console.log(`  ↷  ${config.datasetName} / RH-002: ${reason}`);
          test.skip(true, reason);
        }

        testInfo.annotations.push(
          { type: 'dataset',    description: config.datasetName },
          { type: 'workspace',  description: config.workspaceName },
          { type: 'dataset-id', description: config.datasetId },
        );

        const { endpoints, accessToken } = await liveContext();
        const history = await getRefreshHistory(
          accessToken, config.workspaceId, config.datasetId, endpoints, 20,
        );

        if (history.length === 0) {
          console.log(`  ↷  ${config.datasetName} / RH-002: No refresh history found`);
          test.skip(true, 'No refresh history found for this dataset.');
          return;
        }

        const health = evaluateRefreshHealth(history, 7, new Date().toISOString());

        testInfo.annotations.push(
          { type: 'latest-status',  description: health.latestStatus },
          { type: 'latest-refresh', description: health.latestRefreshTime || 'unknown' },
          { type: 'last-success',   description: health.lastSuccessTime  || 'never' },
        );

        if (health.latestStatus === 'Failed') {
          const { code, message } = extractFailureInfo(history);
          testInfo.annotations.push({
            type: '⚠️ REFRESH FAILED',
            description: [code, message].filter(Boolean).join(': ') || 'no error detail available',
          });
        }

        expect(
          isBadRefreshStatus(health.latestStatus),
          `Latest refresh status "${health.latestStatus}" means visuals are rendering stale or empty data.  ` +
          `Last refresh attempt: ${health.latestRefreshTime || 'unknown'}.  ` +
          `Last success: ${health.lastSuccessTime || 'never'}.`,
        ).toBe(false);
      });

      // ── RH-003 ────────────────────────────────────────────────────────────
      test('RH-003 no data-integrity or credential errors in refresh history', async ({}, testInfo) => {
        if (!isInFocus(focus, 'rh-003')) {
          const reason = `Focus is "${focus}" — select credential-errors or refresh-health to run this check.`;
          console.log(`  ↷  ${config.datasetName} / RH-003: ${reason}`);
          test.skip(true, reason);
        }

        testInfo.annotations.push({ type: 'dataset', description: config.datasetName });

        const { endpoints, accessToken } = await liveContext();
        const history = await getRefreshHistory(
          accessToken, config.workspaceId, config.datasetId, endpoints, 50,
        );

        if (history.length === 0) {
          console.log(`  ↷  ${config.datasetName} / RH-003: No refresh history found`);
          test.skip(true, 'No refresh history found for this dataset.');
          return;
        }

        const hits = scanForDataIntegrityErrors(history);

        for (const hit of hits) {
          testInfo.annotations.push({
            type: '⚠️ DATA INTEGRITY / CREDENTIAL ERROR',
            description: `${hit.time} | ${hit.code}: ${hit.message || '(no message)'} — matched: ${hit.matchedPattern}`,
          });
        }

        expect(
          hits.length,
          `${hits.length} refresh failure(s) contain data-integrity or credential errors ` +
          `that cause visuals to render incorrect or empty data.  See annotations for details.`,
        ).toBe(0);
      });
    });
  }
});
