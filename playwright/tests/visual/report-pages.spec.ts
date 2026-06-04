import { expect, test } from '@playwright/test';
import {
  generateReportEmbedToken,
  getAccessToken,
  getRefreshHistory,
  getPowerBiEndpoints,
  readEnterpriseCredentialsFromEnv,
} from '../../helper-functions/powerbi-enterprise';
import { loadEnterpriseConfigs } from '../../helper-functions/enterprise-config';
import { evaluateRefreshHealth } from '../../helper-functions/refresh-health';

const allConfigs = loadEnterpriseConfigs();
const enterpriseCredentials = readEnterpriseCredentialsFromEnv();
const skipReason = !allConfigs
  ? 'Run npm run setup first.'
  : !enterpriseCredentials
    ? 'Unable to build enterprise auth settings.'
    : '';

// Build a stable VS-NNN id per config index, then group by report name
// so the HTML report shows: Report name › Page name (business-readable).
type ConfigEntry = { config: NonNullable<typeof allConfigs>[number]; id: string };
const reportGroups = new Map<string, ConfigEntry[]>();
for (const [i, config] of (allConfigs ?? []).entries()) {
  const id = `VS-${String(i + 1).padStart(3, '0')}`;
  if (!reportGroups.has(config.reportName)) reportGroups.set(config.reportName, []);
  reportGroups.get(config.reportName)!.push({ config, id });
}

test.describe('Report page health', () => {
  test.skip(Boolean(skipReason), skipReason);

  for (const [reportName, items] of reportGroups) {
    test.describe(reportName, () => {
      for (const { config, id } of items) {
        test(config.pageDisplayName, async ({ page }, testInfo) => {
          testInfo.annotations.push(
            { type: 'id',        description: id },
            { type: 'workspace', description: config.workspaceName ?? '' },
            { type: 'report',    description: config.reportName },
            { type: 'page',      description: config.pageDisplayName },
          );
          const credentials = enterpriseCredentials!;
          const endpoints = getPowerBiEndpoints(credentials.environment);
          const accessToken = await getAccessToken(credentials, endpoints);

          // Acquire embed token — skip (not fail) when dataset XMLA permissions are disabled.
          let embedToken: string;
          try {
            embedToken = await generateReportEmbedToken({
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
            throw err;
          }

          await page.goto('about:blank');
          await page.addScriptTag({
            path: require.resolve('powerbi-client/dist/powerbi.min.js'),
          });

          // Canonical kerski pattern: embed into a full-viewport container, then race
          // 'rendered' vs 'error' DOM events. The SDK fires 'error' the moment any visual breaks.
          // A 90-second inner timeout guards against pages that fire neither event (e.g. slow
          // datasets, large models, gateway warm-up). page.evaluate itself is capped by the
          // project timeout (180s), so 90s inner leaves headroom for the rest of the test.
          const result: string = await page.evaluate(
            async ({ reportId, pageId, embedUrl, embedToken }) => {
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

              powerbi.embed(container, {
                type: 'report',
                id: reportId,
                pageName: pageId,
                embedUrl,
                accessToken: embedToken,
                tokenType: models.TokenType.Embed,
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
            { reportId: config.reportId, pageId: config.pageId, embedUrl: config.embedUrl, embedToken },
          );

          // Always fetch refresh health — annotate on every test so the report shows
          // dataset status whether the visual passed or failed.
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

              // Prominently flag a failed latest refresh as its own annotation so it is
              // immediately visible in the HTML report without expanding detail.
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
            // Surface the reason so it appears in the HTML report — not silently swallowed.
            testInfo.annotations.push({
              type: 'refresh-health-error',
              description: `API call failed: ${err instanceof Error ? err.message : String(err)}`,
            });
          }

          // On failure, wait briefly so the screenshot captures a more informative visual state.
          if (result !== 'rendered') {
            await page.waitForTimeout(3_000);
          }
          // Always capture what the page looked like — pass or fail.
          await page.screenshot({
            path: `${testInfo.outputDir}/render-state.png`,
            fullPage: false,
          });

          expect(
            result,
            `${id} Broken visual in "${config.reportName}" › "${config.pageDisplayName}": ${result}`,
          ).toBe('rendered');
        });
      }
    });
  }
});

