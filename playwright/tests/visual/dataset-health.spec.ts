/**
 * Live dataset health checks — enterprise project.
 *
 * Each test independently fails on a concrete signal that prevents Power BI
 * report visuals from rendering correctly.  No thresholds — every broken state
 * is a hard failure.
 *
 * Tests are deduplicated per dataset — if 4 pages share one dataset only one
 * set of checks runs, not four.
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
  evaluateRefreshHealth,
  extractFailureInfo,
  scanForDataIntegrityErrors,
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

// ─────────────────────────────────────────────────────────────────────────────

test.describe('Dataset health', () => {
  test.skip(Boolean(skipReason), skipReason);

  for (const config of uniqueDatasets.values()) {
    test.describe(config.datasetName, () => {
      async function liveContext() {
        const endpoints = getPowerBiEndpoints(enterpriseCredentials!.environment);
        const accessToken = await getAccessToken(enterpriseCredentials!, endpoints);
        return { endpoints, accessToken };
      }

      // ── RH-001 ────────────────────────────────────────────────────────────
      test('RH-001 refresh history is available and non-empty', async ({}, testInfo) => {
        testInfo.annotations.push(
          { type: 'dataset',    description: config.datasetName },
          { type: 'workspace',  description: config.workspaceName },
          { type: 'dataset-id', description: config.datasetId },
        );

        const { endpoints, accessToken } = await liveContext();
        const history = await getRefreshHistory(
          accessToken, config.workspaceId, config.datasetId, endpoints, 20,
        );

        expect(
          history.length,
          'No refresh history — dataset may never have been refreshed or the service ' +
          'account lacks Contributor access to the workspace.',
        ).toBeGreaterThan(0);
      });

      // ── RH-002 ────────────────────────────────────────────────────────────
      test('RH-002 latest refresh completed — visuals are not rendering stale or empty data', async ({}, testInfo) => {
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
          { type: 'last-success',   description: health.lastSuccessTime  || 'never' },
        );

        if (health.latestStatus === 'Failed') {
          const { code, message } = extractFailureInfo(history);
          testInfo.annotations.push({
            type: '⚠️ REFRESH FAILED',
            description: [code, message].filter(Boolean).join(': ') || 'no error detail available',
          });
        }

        const BAD_STATUSES = new Set(['Failed', 'Disabled', 'Cancelled', 'Unknown']);
        expect(
          BAD_STATUSES.has(health.latestStatus),
          `Latest refresh status "${health.latestStatus}" means visuals are rendering stale or empty data.  ` +
          `Last refresh attempt: ${health.latestRefreshTime || 'unknown'}.  ` +
          `Last success: ${health.lastSuccessTime || 'never'}.`,
        ).toBe(false);
      });

      // ── RH-003 ────────────────────────────────────────────────────────────
      test('RH-003 no data-integrity or credential errors in refresh history', async ({}, testInfo) => {
        testInfo.annotations.push({ type: 'dataset', description: config.datasetName });

        const { endpoints, accessToken } = await liveContext();
        const history = await getRefreshHistory(
          accessToken, config.workspaceId, config.datasetId, endpoints, 50,
        );

        if (history.length === 0) {
          test.skip(true, 'No refresh history — RH-001 covers the empty case.');
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

      // ── DS-001 ────────────────────────────────────────────────────────────
      test('DS-001 all data source connections are bound — credentials exist for every source', async ({}, testInfo) => {
        testInfo.annotations.push({ type: 'dataset', description: config.datasetName });

        const { endpoints, accessToken } = await liveContext();

        let sources;
        try {
          sources = await getDataSources(
            accessToken, config.workspaceId, config.datasetId, endpoints,
          );
        } catch (err: unknown) {
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

        const unbound = sources.filter(
          (s) => Object.keys(s.connectionDetails).length === 0,
        );

        for (const s of unbound) {
          testInfo.annotations.push({
            type: '⚠️ UNBOUND DATASOURCE',
            description:
              `${s.datasourceType || 'Unknown'} source has no connection details — ` +
              `refresh cannot run, all visuals reading this source will show stale data.`,
          });
        }

        expect(
          unbound.length,
          `${unbound.length} data source(s) have no connection details bound.  ` +
          `Open dataset settings in Power BI Service and bind credentials for each source.`,
        ).toBe(0);
      });
    });
  }
});
