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

import path from 'node:path';
import fs   from 'node:fs';
import { expect, test } from '@playwright/test';
import {
  getAccessToken,
  getRefreshHistory,
  getPowerBiEndpoints,
  readEnterpriseCredentialsFromEnv,
} from '../../helper-functions/powerbi-enterprise';
import { loadEnterpriseConfigs, enterpriseConfigPath } from '../../helper-functions/enterprise-config';
import {
  evaluateRefreshHealth,
  extractFailureInfo,
  scanForDataIntegrityErrors,
  isBadRefreshStatus,
} from '../../helper-functions/refresh-health';
import { loadFocus, isInFocus } from '../../helper-functions/focus';

// ── DIAG: module-scope diagnostics (remove after bug is found) ───────────────
const _diagCwd        = process.cwd();
const _diagConfigPath = enterpriseConfigPath;
const _diagFileExists = fs.existsSync(_diagConfigPath);
console.log(`[DIAG dataset-health] cwd:          ${_diagCwd}`);
console.log(`[DIAG dataset-health] configPath:   ${_diagConfigPath}`);
console.log(`[DIAG dataset-health] fileExists:   ${_diagFileExists}`);
if (_diagFileExists) {
  try {
    const _raw    = fs.readFileSync(_diagConfigPath, 'utf8');
    const _parsed = JSON.parse(_raw) as unknown;
    const _count  = Array.isArray(_parsed) ? _parsed.length : 1;
    console.log(`[DIAG dataset-health] configCount:  ${_count}`);
  } catch (e) { console.log(`[DIAG dataset-health] PARSE ERROR:  ${String(e)}`); }
}
// ─────────────────────────────────────────────────────────────────────────────

const allConfigs = loadEnterpriseConfigs();
const enterpriseCredentials = readEnterpriseCredentialsFromEnv();
const focus = loadFocus();

console.log(`[DIAG dataset-health] allConfigs:   ${allConfigs === null ? 'NULL' : `${allConfigs.length} entries`}`);
console.log(`[DIAG dataset-health] credentials:  ${enterpriseCredentials === null ? 'NULL' : 'present'}`);
console.log(`[DIAG dataset-health] focus:        "${focus}"`);

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

console.log(`[DIAG dataset-health] uniqueDatasets: ${uniqueDatasets.size}, skipReason: "${skipReason}"`);

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

      // ── RH-002 ────────────────────────────────────────────────────────────
      test('RH-002 latest refresh completed — visuals are not rendering stale or empty data', async ({}, testInfo) => {
        test.skip(!isInFocus(focus, 'rh-002'), `Focus is "${focus}" — skipping refresh-failure check.`);

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
        test.skip(!isInFocus(focus, 'rh-003'), `Focus is "${focus}" — skipping data-integrity / credential check.`);

        testInfo.annotations.push({ type: 'dataset', description: config.datasetName });

        const { endpoints, accessToken } = await liveContext();
        const history = await getRefreshHistory(
          accessToken, config.workspaceId, config.datasetId, endpoints, 50,
        );

        if (history.length === 0) {
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
