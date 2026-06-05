import path from 'node:path';
import fs   from 'node:fs';
import { expect, test } from '@playwright/test';
import {
  generateReportEmbedToken,
  getAccessToken,
  getRefreshHistory,
  getPowerBiEndpoints,
  readEnterpriseCredentialsFromEnv,
} from '../../helper-functions/powerbi-enterprise';
import { loadEnterpriseConfigs, enterpriseConfigPath } from '../../helper-functions/enterprise-config';
import { evaluateRefreshHealth } from '../../helper-functions/refresh-health';
import { loadFocus, isInFocus } from '../../helper-functions/focus';

// ── DIAG: module-scope diagnostics (remove after bug is found) ───────────────
const _diagCwd        = process.cwd();
const _diagConfigPath = enterpriseConfigPath;
const _diagFileExists = fs.existsSync(_diagConfigPath);
const _diagFocusPath  = path.join(_diagCwd, 'playwright', 'config', 'enterprise.focus.json');
console.log(`[DIAG report-pages] cwd:          ${_diagCwd}`);
console.log(`[DIAG report-pages] configPath:   ${_diagConfigPath}`);
console.log(`[DIAG report-pages] fileExists:   ${_diagFileExists}`);
if (_diagFileExists) {
  try {
    const _raw     = fs.readFileSync(_diagConfigPath, 'utf8');
    const _parsed  = JSON.parse(_raw) as unknown;
    const _count   = Array.isArray(_parsed) ? _parsed.length : 1;
    console.log(`[DIAG report-pages] configCount:  ${_count}`);
    if (Array.isArray(_parsed) && _parsed.length > 0) {
      const _first = _parsed[0] as Record<string, unknown>;
      console.log(`[DIAG report-pages] firstEntry:   ${JSON.stringify({ reportName: _first['reportName'], pageDisplayName: _first['pageDisplayName'] })}`);
    }
  } catch (e) { console.log(`[DIAG report-pages] PARSE ERROR:  ${String(e)}`); }
}
console.log(`[DIAG report-pages] focusExists:  ${fs.existsSync(_diagFocusPath)}`);
// ─────────────────────────────────────────────────────────────────────────────

const allConfigs = loadEnterpriseConfigs();
const enterpriseCredentials = readEnterpriseCredentialsFromEnv();
const focus = loadFocus();

console.log(`[DIAG report-pages] allConfigs:   ${allConfigs === null ? 'NULL' : `${allConfigs.length} entries`}`);
console.log(`[DIAG report-pages] credentials:  ${enterpriseCredentials === null ? 'NULL' : 'present'}`);
console.log(`[DIAG report-pages] focus:        "${focus}"`);

const skipReason = !allConfigs
  ? 'Run npm run setup first.'
  : !enterpriseCredentials
    ? 'Unable to build enterprise auth settings.'
    : !isInFocus(focus, 'visuals')
      ? `Focus is "${focus}" — visual page tests are not in scope.`
      : '';

console.log(`[DIAG report-pages] skipReason:   "${skipReason}"`);

// Build a stable VS-NNN id per config index, then group by report name
// so the HTML report shows: Report name › Page name (business-readable).
type ConfigEntry = { config: NonNullable<typeof allConfigs>[number]; id: string };
const reportGroups = new Map<string, ConfigEntry[]>();
for (const [i, config] of (allConfigs ?? []).entries()) {
  const id = `VS-${String(i + 1).padStart(3, '0')}`;
  if (!reportGroups.has(config.reportName)) reportGroups.set(config.reportName, []);
  reportGroups.get(config.reportName)!.push({ config, id });
}

console.log(`[DIAG report-pages] reportGroups: ${reportGroups.size} report(s), ${[...reportGroups.values()].reduce((n, v) => n + v.length, 0)} test(s)`);

// DIAG: sentinel flat test — if this shows up in "Running N test(s)" but the
// nested ones don't, the problem is with nested test.describe, not flat tests.
test.describe('DIAG — sentinel (remove after bug found)', () => {
  test('sentinel flat test — confirms test registration works', () => {
    console.log('[DIAG report-pages] sentinel test BODY executed');
  });
});

test.describe('Report page health', () => {
  console.log(`[DIAG report-pages] OUTER describe callback entered, skipReason="${skipReason}", groups=${reportGroups.size}`);
  test.skip(Boolean(skipReason), skipReason);

  for (const [reportName, items] of reportGroups) {
    console.log(`[DIAG report-pages] registering inner describe for: "${reportName}" (${items.length} tests)`);
    test.describe(reportName, () => {
      console.log(`[DIAG report-pages] INNER describe callback entered for: "${reportName}"`);
      for (const { config, id } of items) {
        const title = config.pageDisplayName ?? `[undefined page ${id}]`;
        console.log(`[DIAG report-pages]   registering test: "${title}"`);
        test(title, async ({ page }, testInfo) => {
          testInfo.annotations.push(
            { type: 'id',        description: id },
            { type: 'workspace', description: config.workspaceName ?? '' },
            { type: 'report',    description: config.reportName },
            { type: 'page',      description: config.pageDisplayName },
          );
          const credentials = enterpriseCredentials!;
          const endpoints = getPowerBiEndpoints(credentials.environment);
          const accessToken = await getAccessToken(credentials, endpoints);

          // Acquire embed token (AppOwnsData).  When the user has view access but no
          // GenerateToken permission, fall back to the user's own AAD token (UserOwnsData).
          let tokenForEmbed = '';
          let tokenTypeKey: 'Embed' | 'Aad' = 'Embed';
          try {
            tokenForEmbed = await generateReportEmbedToken({
              accessToken,
              workspaceId: config.workspaceId,
              reportId: config.reportId,
              datasetId: config.datasetId,
              endpoints,
            });
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes('XMLA permissions') || msg.includes('InvalidRequest')) {
              test.skip(
                true,
                `Dataset "${config.datasetName}" requires XMLA endpoint access — enable it in Power BI Admin Portal → Dataset settings.`,
              );
              return;
            }
            if (msg.includes('PowerBINotAuthorizedException')) {
              // User has report-viewer access but not GenerateToken permission.
              // Fall back to UserOwnsData: pass the AAD access token directly.
              tokenForEmbed = accessToken;
              tokenTypeKey = 'Aad';
              testInfo.annotations.push({
                type: 'auth-mode',
                description: 'AAD fallback — GenerateToken not authorized; using user access token (UserOwnsData)',
              });
            } else {
              throw err;
            }
          }

          await page.goto('about:blank');
          await page.addScriptTag({
            // Vendored at playwright/vendor/powerbi.min.js — committed to the repo so it
            // works on every machine without needing 'powerbi-client' installed separately.
            path: require('node:path').join(process.cwd(), 'playwright', 'vendor', 'powerbi.min.js'),
          });

          // Canonical kerski pattern: embed into a full-viewport container, then race
          // 'rendered' vs 'error' DOM events. The SDK fires 'error' the moment any visual breaks.
          // A 90-second inner timeout guards against pages that fire neither event (e.g. slow
          // datasets, large models, gateway warm-up). page.evaluate itself is capped by the
          // project timeout (180s), so 90s inner leaves headroom for the rest of the test.
          const result: string = await page.evaluate(
            async ({ reportId, pageId, embedUrl, tokenForEmbed, tokenTypeKey }) => {
              const container = document.createElement('div');
              container.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;';
              document.body.appendChild(container);

              const pbi = (window as any)['powerbi-client'];
              const models = pbi.models;
              const powerbi = new pbi.service.Service(
                pbi.factories.hpmFactory,
                pbi.factories.wpmpFactory,
                pbi.factories.routerFactory,
              );

              const tokenType = tokenTypeKey === 'Aad' ? models.TokenType.Aad : models.TokenType.Embed;

              powerbi.embed(container, {
                type: 'report',
                id: reportId,
                pageName: pageId,
                embedUrl,
                accessToken: tokenForEmbed,
                tokenType,
                permissions: models.Permissions.Read,
                viewMode: models.ViewMode.View,
              });

              return new Promise<string>((resolve) => {
                const RENDER_TIMEOUT_MS = 90_000;
                const timer = setTimeout(
                  () => resolve('error: render timeout — no rendered or error event fired within 90s'),
                  RENDER_TIMEOUT_MS,
                );
                const done = (value: string): void => { clearTimeout(timer); resolve(value); };

                container.addEventListener('error', (e: any) =>
                  done(`error: ${(e as CustomEvent)?.detail?.message ?? 'unknown'}`), { once: true });
                container.addEventListener('rendered', () => done('rendered'), { once: true });
              });
            },
            { reportId: config.reportId, pageId: config.pageId, embedUrl: config.embedUrl, tokenForEmbed, tokenTypeKey },
          );

          // Fetch refresh health for annotation — only when a refresh-related focus is active.
          // Skipped for broken-visuals focus to avoid unnecessary REST calls.
          if (isInFocus(focus, 'rh-002') || isInFocus(focus, 'rh-003')) {
            try {
              const history = await getRefreshHistory(
                accessToken, config.workspaceId, config.datasetId, endpoints, 10,
              );
              if (history.length > 0) {
                const health = evaluateRefreshHealth(history, 7, new Date().toISOString());
                const summary = [
                  `latest: ${health.latestStatus} @ ${health.latestRefreshTime || 'unknown'}`,
                  `failures in window: ${health.failureCount}`,
                  ...(health.lastKnownFailure ? [`last error: ${health.lastKnownFailure.code}`] : []),
                ].join(' · ');
                testInfo.annotations.push({ type: 'refresh-health', description: summary });

                if (health.latestStatus === 'Failed') {
                  const msg = health.lastKnownFailure
                    ? `${health.lastKnownFailure.code}: ${health.lastKnownFailure.message}`
                    : 'no error detail available';
                  testInfo.annotations.push({
                    type: '⚠️ REFRESH FAILED',
                    description: msg,
                  });
                }
              } else {
                testInfo.annotations.push({
                  type: 'refresh-health',
                  description: 'no refresh history returned by API',
                });
              }
            } catch (err: unknown) {
              testInfo.annotations.push({
                type: 'refresh-health-error',
                description: `API call failed: ${err instanceof Error ? err.message : String(err)}`,
              });
            }
          }

          // On failure: wait briefly so the screenshot captures a more informative state,
          // then save render-state.png.  Passing pages produce no artifacts.
          if (result !== 'rendered') {
            await page.waitForTimeout(3_000);
            await page.screenshot({
              path: `${testInfo.outputDir}/render-state.png`,
              fullPage: false,
            });
          }

          expect(
            result,
            `${id} Broken visual in "${config.reportName}" › "${config.pageDisplayName}": ${result}`,
          ).toBe('rendered');
        });
      }
    });
  }
});

