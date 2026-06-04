import fs from 'node:fs';
import path from 'node:path';
import {
  PublicClientApplication,
  type AuthenticationResult,
  type DeviceCodeRequest,
  type TokenCacheContext,
} from '@azure/msal-node';

const LEGACY_PUBLIC_CLIENT_ID = 'd3590ed6-52b3-4102-aeff-aad2292ab01c';

export interface PowerBiEndpoints {
  apiPrefix: string;
  webPrefix: string;
  resourceUrl: string;
  loginUrl: string;
}

export interface EnterpriseCredentials {
  clientId: string;
  tenantId?: string;
  environment: string;
  cacheFile: string;
}

export interface PowerBiWorkspace {
  id: string;
  name: string;
}

export interface PowerBiDataset {
  id: string;
  name: string;
}

export interface PowerBiReport {
  id: string;
  name: string;
  datasetId?: string;
  embedUrl?: string;
}

export interface PowerBiPage {
  name: string;
  displayName: string;
  order: string;
}

export interface PowerBiDataSource {
  datasourceType: string;
  /** Connection details object — empty means the datasource has no bound connection. */
  connectionDetails: Record<string, unknown>;
  datasourceId: string;
  gatewayId: string;
}

function getText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function getPowerBiEndpoints(environment = process.env.PBI_ENVIRONMENT ?? 'Public'): PowerBiEndpoints {
  switch (environment) {
    case 'Germany':
      return {
        apiPrefix: 'https://api.powerbi.de',
        webPrefix: 'https://app.powerbi.de',
        resourceUrl: 'https://analysis.cloudapi.de/powerbi/api',
        loginUrl: 'https://login.microsoftonline.com',
      };
    case 'China':
      return {
        apiPrefix: 'https://api.powerbi.cn',
        webPrefix: 'https://app.powerbi.cn',
        resourceUrl: 'https://analysis.chinacloudapi.cn/powerbi/api',
        loginUrl: 'https://login.partner.microsoftonline.cn',
      };
    case 'USGov':
      return {
        apiPrefix: 'https://api.powerbigov.us',
        webPrefix: 'https://app.powerbigov.us',
        resourceUrl: 'https://analysis.usgovcloudapi.net/powerbi/api',
        loginUrl: 'https://login.microsoftonline.us',
      };
    case 'USGovHigh':
      return {
        apiPrefix: 'https://api.high.powerbigov.us',
        webPrefix: 'https://app.high.powerbigov.us',
        resourceUrl: 'https://analysis.high.usgovcloudapi.net/powerbi/api',
        loginUrl: 'https://login.microsoftonline.us',
      };
    case 'USGovDoD':
      return {
        apiPrefix: 'https://api.mil.powerbi.us',
        webPrefix: 'https://app.mil.powerbi.us',
        resourceUrl: 'https://analysis.dod.usgovcloudapi.net/powerbi/api',
        loginUrl: 'https://login.microsoftonline.us',
      };
    case 'Public':
    default:
      return {
        apiPrefix: 'https://api.powerbi.com',
        webPrefix: 'https://app.powerbi.com',
        resourceUrl: 'https://analysis.windows.net/powerbi/api',
        loginUrl: 'https://login.microsoftonline.com',
      };
  }
}

export function readEnterpriseCredentialsFromEnv(): EnterpriseCredentials | null {
  const clientId = process.env.CLIENT_ID ?? LEGACY_PUBLIC_CLIENT_ID;
  const tenantId = process.env.TENANT_ID;
  const environment = process.env.PBI_ENVIRONMENT ?? 'Public';
  const cacheFile =
    process.env.PBI_TOKEN_CACHE_FILE ??
    path.join(process.cwd(), 'playwright', '.auth', 'msal-device-token-cache.json');

  return {
    clientId,
    tenantId: tenantId || undefined,
    environment,
    cacheFile,
  };
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${body}`);
  }

  return (await response.json()) as T;
}

async function beforeCacheAccess(cacheContext: TokenCacheContext, cacheFile: string): Promise<void> {
  if (fs.existsSync(cacheFile)) {
    cacheContext.tokenCache.deserialize(fs.readFileSync(cacheFile, 'utf8'));
  }
}

async function afterCacheAccess(cacheContext: TokenCacheContext, cacheFile: string): Promise<void> {
  if (!cacheContext.cacheHasChanged) {
    return;
  }

  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.writeFileSync(cacheFile, cacheContext.tokenCache.serialize());
}

export async function getAccessToken(
  credentials: EnterpriseCredentials,
  endpoints = getPowerBiEndpoints(credentials.environment),
): Promise<string> {
  const authorityTenant = credentials.tenantId ?? 'common';
  const app = new PublicClientApplication({
    auth: {
      clientId: credentials.clientId,
      authority: `${endpoints.loginUrl}/${authorityTenant}`,
    },
    cache: {
      cachePlugin: {
        beforeCacheAccess: async (cacheContext) => beforeCacheAccess(cacheContext, credentials.cacheFile),
        afterCacheAccess: async (cacheContext) => afterCacheAccess(cacheContext, credentials.cacheFile),
      },
    },
  });

  const scopes = [`${endpoints.resourceUrl}/.default`];
  const accounts = await app.getTokenCache().getAllAccounts();
  const silentResult = accounts[0]
    ? await app.acquireTokenSilent({
        account: accounts[0],
        scopes,
      })
    : null;

  if (silentResult?.accessToken) {
    return silentResult.accessToken;
  }

  const request: DeviceCodeRequest = {
    scopes,
    deviceCodeCallback: (response) => {
      console.log(response.message);
    },
  };

  const interactiveResult: AuthenticationResult | null = await app.acquireTokenByDeviceCode(request);

  if (!interactiveResult?.accessToken) {
    throw new Error('Device-flow authentication did not return an access token.');
  }

  return interactiveResult.accessToken;
}

async function restGet<T>(path: string, accessToken: string, endpoints: PowerBiEndpoints): Promise<T> {
  return fetchJson<T>(`${endpoints.apiPrefix}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });
}

export async function listWorkspaces(accessToken: string, endpoints: PowerBiEndpoints): Promise<PowerBiWorkspace[]> {
  const response = await restGet<{ value?: Array<Record<string, unknown>> }>('/v1.0/myorg/groups', accessToken, endpoints);
  return (response.value ?? []).map((w) => ({ id: getText(w.id), name: getText(w.name) }));
}

export async function listReports(
  accessToken: string,
  workspaceId: string,
  endpoints: PowerBiEndpoints,
): Promise<PowerBiReport[]> {
  const response = await restGet<{ value?: Array<Record<string, unknown>> }>(
    `/v1.0/myorg/groups/${workspaceId}/reports`,
    accessToken,
    endpoints,
  );
  return (response.value ?? []).map((r) => ({
    id: getText(r.id),
    name: getText(r.name),
    datasetId: getText(r.datasetId) || undefined,
    embedUrl: getText(r.embedUrl) || undefined,
  }));
}

export async function listDatasets(
  accessToken: string,
  workspaceId: string,
  endpoints: PowerBiEndpoints,
): Promise<PowerBiDataset[]> {
  const response = await restGet<{ value?: Array<Record<string, unknown>> }>(
    `/v1.0/myorg/groups/${workspaceId}/datasets`,
    accessToken,
    endpoints,
  );
  return (response.value ?? []).map((d) => ({ id: getText(d.id), name: getText(d.name) }));
}

export async function findWorkspaceByName(
  accessToken: string,
  workspaceName: string,
  endpoints: PowerBiEndpoints,
): Promise<PowerBiWorkspace | null> {
  const response = await restGet<{ value?: Array<Record<string, unknown>> }>('/v1.0/myorg/groups', accessToken, endpoints);
  const match = (response.value ?? []).find((workspace) => getText(workspace.name) === workspaceName);

  return match
    ? {
        id: getText(match.id),
        name: getText(match.name),
      }
    : null;
}

export async function findDatasetByName(
  accessToken: string,
  workspaceId: string,
  datasetName: string,
  endpoints: PowerBiEndpoints,
): Promise<PowerBiDataset | null> {
  const response = await restGet<{ value?: Array<Record<string, unknown>> }>(
    `/v1.0/myorg/groups/${workspaceId}/datasets`,
    accessToken,
    endpoints,
  );
  const match = (response.value ?? []).find((dataset) => getText(dataset.name) === datasetName);

  return match
    ? {
        id: getText(match.id),
        name: getText(match.name),
      }
    : null;
}

export async function findReportByName(
  accessToken: string,
  workspaceId: string,
  reportName: string,
  endpoints: PowerBiEndpoints,
): Promise<PowerBiReport | null> {
  const response = await restGet<{ value?: Array<Record<string, unknown>> }>(
    `/v1.0/myorg/groups/${workspaceId}/reports`,
    accessToken,
    endpoints,
  );
  const match = (response.value ?? []).find((report) => getText(report.name) === reportName);

  return match
    ? {
        id: getText(match.id),
        name: getText(match.name),
        datasetId: getText(match.datasetId) || undefined,
        embedUrl: getText(match.embedUrl) || undefined,
      }
    : null;
}

export async function getReportDetails(
  accessToken: string,
  workspaceId: string,
  reportId: string,
  endpoints: PowerBiEndpoints,
): Promise<PowerBiReport> {
  const response = await restGet<Record<string, unknown>>(
    `/v1.0/myorg/groups/${workspaceId}/reports/${reportId}`,
    accessToken,
    endpoints,
  );

  return {
    id: getText(response.id),
    name: getText(response.name),
    datasetId: getText(response.datasetId) || undefined,
    embedUrl: getText(response.embedUrl) || undefined,
  };
}

export async function listReportPages(
  accessToken: string,
  workspaceId: string,
  reportId: string,
  endpoints: PowerBiEndpoints,
): Promise<PowerBiPage[]> {
  const response = await restGet<{ value?: Array<Record<string, unknown>> }>(
    `/v1.0/myorg/groups/${workspaceId}/reports/${reportId}/pages`,
    accessToken,
    endpoints,
  );

  return (response.value ?? [])
    .map((page) => ({
      name: getText(page.name),
      displayName: getText(page.displayName),
      order: getText(page.order),
    }))
    .sort((left, right) => Number(left.order) - Number(right.order));
}

export async function generateReportEmbedToken(args: {
  accessToken: string;
  workspaceId: string;
  reportId: string;
  datasetId: string;
  endpoints: PowerBiEndpoints;
}): Promise<string> {
  const response = await fetchJson<{ token?: string }>(`${args.endpoints.apiPrefix}/v1.0/myorg/GenerateToken`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${args.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      reports: [{ id: args.reportId }],
      datasets: [{ id: args.datasetId }],
      targetWorkspaces: [{ id: args.workspaceId }],
      accessLevel: 'View',
    }),
  });

  if (!response.token) {
    throw new Error(
      'GenerateToken response did not include a token. Confirm the service principal has workspace access and the workspace is on Premium/Fabric capacity.',
    );
  }

  return response.token;
}

export async function getRefreshHistory(
  accessToken: string,
  workspaceId: string,
  datasetId: string,
  endpoints: PowerBiEndpoints,
  top = 10,
): Promise<import('./types').RefreshHistoryEntry[]> {
  const response = await restGet<{ value?: unknown[] }>(
    `/v1.0/myorg/groups/${workspaceId}/datasets/${datasetId}/refreshes?$top=${top}`,
    accessToken,
    endpoints,
  );
  return (response.value ?? []) as import('./types').RefreshHistoryEntry[];
}

/**
 * Returns the data sources bound to a dataset.
 * An empty connectionDetails object signals a datasource with no bound
 * connection — which causes "unable to access data source" errors at refresh time.
 */
export async function getDataSources(
  accessToken: string,
  workspaceId: string,
  datasetId: string,
  endpoints: PowerBiEndpoints,
): Promise<PowerBiDataSource[]> {
  const response = await restGet<{ value?: Array<Record<string, unknown>> }>(
    `/v1.0/myorg/groups/${workspaceId}/datasets/${datasetId}/datasources`,
    accessToken,
    endpoints,
  );
  return (response.value ?? []).map((s) => ({
    datasourceType: getText(s.datasourceType),
    connectionDetails: (s.connectionDetails as Record<string, unknown> | undefined) ?? {},
    datasourceId: getText(s.datasourceId),
    gatewayId: getText(s.gatewayId),
  }));
}
