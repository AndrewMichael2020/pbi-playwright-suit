export interface PowerBiEndpoints {
  apiPrefix: string;
  webPrefix: string;
  resourceUrl: string;
  loginUrl: string;
}

export interface EnterpriseCredentials {
  clientId: string;
  clientSecret: string;
  tenantId: string;
  environment: string;
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
  const clientId = process.env.CLIENT_ID;
  const clientSecret = process.env.CLIENT_SECRET;
  const tenantId = process.env.TENANT_ID;
  const environment = process.env.PBI_ENVIRONMENT ?? 'Public';

  if (!clientId || !clientSecret || !tenantId) {
    return null;
  }

  return {
    clientId,
    clientSecret,
    tenantId,
    environment,
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

export async function getAccessToken(credentials: EnterpriseCredentials, endpoints = getPowerBiEndpoints(credentials.environment)): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    scope: `${endpoints.resourceUrl}/.default`,
  });

  const tokenResponse = await fetchJson<{ access_token?: string }>(
    `${endpoints.loginUrl}/${credentials.tenantId}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    },
  );

  if (!tokenResponse.access_token) {
    throw new Error('Access token response did not include access_token.');
  }

  return tokenResponse.access_token;
}

async function restGet<T>(path: string, accessToken: string, endpoints: PowerBiEndpoints): Promise<T> {
  return fetchJson<T>(`${endpoints.apiPrefix}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });
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
