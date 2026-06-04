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
  ? 'Run npm run discover:interactive first.'
  : !enterpriseCredentials
    ? 'Unable to build enterprise auth settings.'
    : '';

test.describe('UPCC visual smoke', () => {
  test.skip(Boolean(skipReason), skipReason);

  test(
    `Visual smoke — ${enterpriseConfig?.reportName ?? 'report'} › ${enterpriseConfig?.pageDisplayName ?? 'page'}`,
    async ({ page }) => {
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

      await page.goto('about:blank');
      await page.addScriptTag({
        url: 'https://cdnjs.cloudflare.com/ajax/libs/powerbi-client/2.23.1/powerbi.min.js',
      });

      // Races 'rendered' (all visuals OK) vs 'error' (any visual broke).
      // Canonical kerski pattern — the SDK fires these as DOM events on
      // document.body; whichever fires first determines the result.
      const result: string = await page.evaluate(
        async ({ reportId, pageId, embedUrl, embedToken }) => {
          const pbi = (window as any)['powerbi-client'];
          const models = pbi.models;
          const powerbi = new pbi.service.Service(
            pbi.factories.hpmFactory,
            pbi.factories.wpmpFactory,
            pbi.factories.routerFactory,
          );

          powerbi.embed(document.body, {
            type: 'report',
            id: reportId,
            pageName: pageId,
            embedUrl,
            accessToken: embedToken,
            tokenType: models.TokenType.Embed,
            permissions: models.Permissions.Read,
            viewMode: models.ViewMode.View,
          });

          const once = { once: true };
          const errorPromise = new Promise<string>((resolve) => {
            document.body.addEventListener('error', (e: any) => resolve(`error: ${e?.detail?.message ?? 'unknown'}`), once);
          });
          const renderedPromise = new Promise<string>((resolve) => {
            document.body.addEventListener('rendered', () => resolve('rendered'), once);
          });

          return Promise.race([errorPromise, renderedPromise]);
        },
        { reportId: config.reportId, pageId: config.pageId, embedUrl: config.embedUrl, embedToken },
      );

      expect(
        result,
        `Broken visual in "${config.reportName}" › "${config.pageDisplayName}": ${result}`,
      ).toBe('rendered');
    },
  );
});
