import { expect, test } from '@playwright/test';
import {
  generateReportEmbedToken,
  getAccessToken,
  getPowerBiEndpoints,
  readEnterpriseCredentialsFromEnv,
} from '../../helper-functions/powerbi-enterprise';
import { loadEnterpriseConfigs } from '../../helper-functions/enterprise-config';

const allConfigs = loadEnterpriseConfigs();
const enterpriseCredentials = readEnterpriseCredentialsFromEnv();
const skipReason = !allConfigs
  ? 'Run npm run setup first.'
  : !enterpriseCredentials
    ? 'Unable to build enterprise auth settings.'
    : '';

test.describe('Report page health', () => {
  test.skip(Boolean(skipReason), skipReason);

  for (const [i, config] of (allConfigs ?? []).entries()) {
    const id = `VS-${String(i + 1).padStart(3, '0')}`;
    test(id, async ({ page }, testInfo) => {
      testInfo.annotations.push(
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
        url: 'https://cdnjs.cloudflare.com/ajax/libs/powerbi-client/2.23.1/powerbi.min.js',
      });

      // Canonical kerski pattern: embed into a full-viewport container, then race
      // 'rendered' vs 'error' DOM events. The SDK fires 'error' the moment any visual breaks.
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

          const once = { once: true };
          const errorPromise = new Promise<string>((resolve) => {
            container.addEventListener('error', (e: any) =>
              resolve(`error: ${e?.detail?.message ?? 'unknown'}`), once);
          });
          const renderedPromise = new Promise<string>((resolve) => {
            container.addEventListener('rendered', () => resolve('rendered'), once);
          });

          return Promise.race([errorPromise, renderedPromise]);
        },
        { reportId: config.reportId, pageId: config.pageId, embedUrl: config.embedUrl, embedToken },
      );

      // On failure, wait briefly so the screenshot captures a more informative visual state
      // (the video already captures the full render timeline).
      if (result !== 'rendered') {
        await page.waitForTimeout(3_000);
      }

      expect(
        result,
        `${id} Broken visual in "${config.reportName}" › "${config.pageDisplayName}": ${result}`,
      ).toBe('rendered');
    });
  }
});
