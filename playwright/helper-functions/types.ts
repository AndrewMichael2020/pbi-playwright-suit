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
