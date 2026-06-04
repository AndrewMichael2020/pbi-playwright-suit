import { expect, test } from '@playwright/test';
import {
  generateReportEmbedToken,
  getAccessToken,
  getPowerBiEndpoints,
  readEnterpriseCredentialsFromEnv,
} from '../../helper-functions/powerbi-enterprise';
import { loadUpccEnterpriseConfig } from '../../helper-functions/upcc-enterprise-config';

const enterpriseConfig = loadUpccEnterpriseConfig();
const enterpriseCredentials = readEnterpriseCredentialsFromEnv();
const skipReason = !enterpriseConfig
  ? 'Run npm run discover:enterprise-upcc first.'
  : !enterpriseCredentials
    ? 'Set CLIENT_ID in your shell or .env before running enterprise visual smoke.'
    : '';

const knownErrorPatterns = [
  'power bi encountered an unexpected error while loading the model',
  "couldn't retrieve the data model",
  "you don't have permission to view this tile",
  'power bi visuals have been disabled by your administrator',
  'data shapes must contain at least one group or calculation that outputs data',
  "power bi can't determine the relationship between two or more fields",
  'this visual has exceeded the available resources',
  'we are not able to identify the following fields',
];

test.describe('UPCC visual smoke', () => {
  test.skip(Boolean(skipReason), skipReason);

  test('VS-001 through VS-005 UPCC report visual smoke', async ({ page }) => {
    if (!enterpriseConfig || !enterpriseCredentials) {
      test.skip(true, skipReason);
    }

    const config = enterpriseConfig!;
    const credentials = enterpriseCredentials!;
    const endpoints = getPowerBiEndpoints(credentials.environment);
    const accessToken = await getAccessToken(credentials, endpoints);
    const embedToken = await generateReportEmbedToken({
      accessToken,
      workspaceId: config.workspaceId,
      reportId: config.reportId,
      datasetId: config.datasetId,
      endpoints,
    });

    await page.setContent(`
      <!doctype html>
      <html lang="en">
        <body>
          <div id="report-container" style="width: 1400px; height: 900px;"></div>
        </body>
      </html>
    `);

    await page.addScriptTag({ url: 'https://cdnjs.cloudflare.com/ajax/libs/powerbi-client/2.23.1/powerbi.min.js' });

    const embedResult = await page.evaluate(
      async ({ reportId, pageId, embedUrl, embedToken }) => {
        const pbi = (window as unknown as Record<string, any>)['powerbi-client'];
        const models = pbi.models;
        const powerbi = new pbi.service.Service(pbi.factories.hpmFactory, pbi.factories.wpmpFactory, pbi.factories.routerFactory);
        const container = document.getElementById('report-container');

        if (!container) {
          return { status: 'error', message: 'Report container was not created.' };
        }

        const report = powerbi.embed(container, {
          type: 'report',
          id: reportId,
          pageName: pageId,
          embedUrl,
          accessToken: embedToken,
          tokenType: models.TokenType.Embed,
          permissions: models.Permissions.Read,
          viewMode: models.ViewMode.View,
        });

        return await new Promise<{ status: string; message?: string }>((resolve) => {
          const timer = setTimeout(() => {
            resolve({ status: 'timeout', message: 'Timed out waiting for Power BI rendered/error event.' });
          }, 60_000);

          report.on('rendered', () => {
            clearTimeout(timer);
            resolve({ status: 'rendered' });
          });

          report.on('error', (event: { detail?: { message?: string } }) => {
            clearTimeout(timer);
            resolve({
              status: 'error',
              message: event.detail?.message ?? 'Unknown Power BI embed error.',
            });
          });
        });
      },
      {
        reportId: config.reportId,
        pageId: config.pageId,
        embedUrl: config.embedUrl,
        embedToken,
      },
    );

    expect(embedResult.status, embedResult.message).toBe('rendered');

    await page.waitForTimeout(5_000);

    const frameTexts = await Promise.all(
      page.frames().map(async (frame) => {
        try {
          return await frame.locator('body').innerText({ timeout: 5_000 });
        } catch {
          return '';
        }
      }),
    );

    const combinedText = frameTexts.join('\n').toLowerCase();
    const matchedErrors = knownErrorPatterns.filter((pattern) => combinedText.includes(pattern));

    expect(matchedErrors).toEqual([]);
  });
});
