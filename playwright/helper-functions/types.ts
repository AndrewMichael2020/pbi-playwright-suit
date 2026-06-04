export interface RefreshAttempt {
  serviceExceptionJson?: string;
}

export interface RefreshHistoryEntry {
  startTime?: string;
  endTime?: string;
  status?: string;
  serviceExceptionJson?: string;
  serviceexceptionjson?: string;
  refreshAttempts?: RefreshAttempt[];
  error?: {
    code?: string;
    message?: string;
  };
}

export interface NormalizedRefreshFailure {
  time: string;
  code: string;
  message: string;
  withinWindow: boolean;
}

export interface RefreshHealthResult {
  windowDays: number;
  latestStatus: string;
  latestRefreshTime: string;
  lastSuccessTime: string;
  failureCount: number;
  failures: NormalizedRefreshFailure[];
  lastKnownFailure?: NormalizedRefreshFailure;
}

export interface ParsedColumn {
  name: string;
  type: string;
  hidden: boolean;
}

export interface ParsedMeasure {
  name: string;
  expression: string;
}

export interface ParsedPartition {
  name: string;
  mode: string;
  sourceType: string;
  sqlQuery?: string;
  mExpression?: string;
}

export interface ParsedTable {
  name: string;
  hidden: boolean;
  columns: ParsedColumn[];
  measures: ParsedMeasure[];
  partitions: ParsedPartition[];
}

export interface ParsedRelationship {
  id: string;
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  active: boolean;
  crossFilter: string;
  securityFilter: string;
  cardinality: string;
}

export interface ParsedRole {
  name: string;
  members: string[];
  filters: Array<{
    table: string;
    filter: string;
  }>;
}

export interface ParsedUpccMetadata {
  workspaceName: string;
  workspaceId: string;
  datasetName: string;
  datasetId: string;
  lastRefresh: string;
  refreshStatus: string;
  lastFailed: string;
  failureCode: string;
  failureMessage: string;
  tables: ParsedTable[];
  relationships: ParsedRelationship[];
  roles: ParsedRole[];
}

export interface ModelSignature {
  datasetName: string;
  tableCount: number;
  relationshipCount: number;
  roleCount: number;
  tables: Array<{
    name: string;
    hidden: boolean;
    columns: ParsedColumn[];
    measures: Array<{
      name: string;
      expressionHash: string;
    }>;
    partitions: Array<{
      name: string;
      mode: string;
      sourceType: string;
      extractedSqlHash?: string;
    }>;
  }>;
  relationships: ParsedRelationship[];
  roles: Array<{
    name: string;
    memberCount: number;
    filterCount: number;
  }>;
  allowlist: {
    hiddenSupportColumnPrefixes: string[];
    inactiveRelationshipKeys: string[];
  };
}

export interface SignatureDrift {
  addedTables: string[];
  removedTables: string[];
  changedTables: string[];
  changedRelationships: string[];
}

export interface DuplicateIssue {
  severity: 'warning' | 'error';
  type:
    | 'duplicate-table'
    | 'duplicate-measure'
    | 'duplicate-relationship'
    | 'duplicate-source-signature'
    | 'unexpected-inactive-relationship'
    | 'cross-table-measure-name'
    | 'zombie-table';
  message: string;
}

export interface RefreshPatternResult {
  /** Number of consecutive failures starting from the most recent refresh. */
  consecutiveFailureCount: number;
  /** True when the last successful refresh is older than maxStaleHours. */
  isStale: boolean;
  /** Hours since the last successful refresh, or null if no success exists. */
  hoursSinceLastSuccess: number | null;
  /** Map of failure error-code → occurrence count. */
  failuresByCode: Record<string, number>;
}
