import { RefreshHealthResult, RefreshHistoryEntry, RefreshPatternResult } from './types';

function parseErrorPayload(raw?: string): { code?: string; message?: string } {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const code =
      typeof parsed.errorCode === 'string'
        ? parsed.errorCode
        : typeof (parsed.error as Record<string, unknown> | undefined)?.code === 'string'
          ? ((parsed.error as Record<string, string>).code ?? '')
          : '';

    const descriptionRaw =
      typeof parsed.errorDescription === 'string'
        ? parsed.errorDescription
        : typeof (parsed.error as Record<string, unknown> | undefined)?.message === 'string'
          ? ((parsed.error as Record<string, string>).message ?? '')
          : '';

    if (!descriptionRaw) {
      return { code };
    }

    try {
      const nested = JSON.parse(descriptionRaw) as Record<string, unknown>;
      const error = nested.error as Record<string, unknown> | undefined;
      const pbiError =
        (error?.['pbi.error'] as Record<string, unknown> | undefined) ??
        (error?.pbiError as Record<string, unknown> | undefined);
      const details = (pbiError?.details as Array<Record<string, unknown>> | undefined) ?? [];

      const detailValue =
        (details[1]?.detail as Record<string, string> | undefined)?.value ??
        (details[0]?.message as string | undefined) ??
        (details[0]?.detail as Record<string, string> | undefined)?.value ??
        descriptionRaw;

      return { code, message: detailValue };
    } catch {
      return { code, message: descriptionRaw };
    }
  } catch {
    return {};
  }
}

export function extractFailureInfo(refreshes: RefreshHistoryEntry[]): { code: string; message: string } {
  const failed = refreshes.find((refresh) => refresh.status === 'Failed');
  if (!failed) {
    return { code: '', message: '' };
  }

  const fromTop = parseErrorPayload(failed.serviceExceptionJson ?? failed.serviceexceptionjson);
  if (fromTop.code || fromTop.message) {
    return { code: fromTop.code ?? '', message: fromTop.message ?? '' };
  }

  for (const attempt of failed.refreshAttempts ?? []) {
    const attemptDetails = parseErrorPayload(attempt.serviceExceptionJson);
    if (attemptDetails.code || attemptDetails.message) {
      return { code: attemptDetails.code ?? '', message: attemptDetails.message ?? '' };
    }
  }

  if (failed.error) {
    return { code: failed.error.code ?? '', message: failed.error.message ?? '' };
  }

  return { code: '', message: '' };
}

export function evaluateRefreshHealth(
  refreshes: RefreshHistoryEntry[],
  windowDays: number,
  nowIso: string,
): RefreshHealthResult {
  const now = new Date(nowIso);
  const windowStart = new Date(now);
  windowStart.setUTCDate(windowStart.getUTCDate() - windowDays);

  const sorted = [...refreshes].sort((left, right) => {
    return new Date(right.endTime ?? right.startTime ?? 0).getTime() - new Date(left.endTime ?? left.startTime ?? 0).getTime();
  });

  const latest = sorted[0];
  const failures = sorted
    .filter((refresh) => refresh.status === 'Failed')
    .map((refresh) => {
      const normalized = extractFailureInfo([refresh]);
      const time = refresh.endTime ?? refresh.startTime ?? '';
      const withinWindow = new Date(time) >= windowStart;

      return {
        time,
        code: normalized.code,
        message: normalized.message,
        withinWindow,
      };
    });

  const lastSuccess = sorted.find((refresh) => refresh.status === 'Completed');

  return {
    windowDays,
    latestStatus: latest?.status ?? '',
    latestRefreshTime: latest?.endTime ?? latest?.startTime ?? '',
    lastSuccessTime: lastSuccess?.endTime ?? lastSuccess?.startTime ?? '',
    failureCount: failures.filter((failure) => failure.withinWindow).length,
    failures: failures.filter((failure) => failure.withinWindow),
    lastKnownFailure: failures[0],
  };
}

/**
 * Analyses refresh history for operational patterns that go beyond simple
 * pass/fail — consecutive failures, data staleness, and error classification.
 */
export function analyzeRefreshPatterns(
  refreshes: RefreshHistoryEntry[],
  maxStaleHours: number,
  nowIso: string,
): RefreshPatternResult {
  const sorted = [...refreshes].sort((a, b) => {
    return (
      new Date(b.endTime ?? b.startTime ?? 0).getTime() -
      new Date(a.endTime ?? a.startTime ?? 0).getTime()
    );
  });

  // Count consecutive failures from the most recent entry.
  let consecutiveFailureCount = 0;
  for (const entry of sorted) {
    if (entry.status === 'Failed') consecutiveFailureCount++;
    else break;
  }

  // Staleness: how long since the last successful refresh?
  const lastSuccess = sorted.find((r) => r.status === 'Completed');
  let hoursSinceLastSuccess: number | null = null;
  let isStale = true;

  if (lastSuccess) {
    const successTime = new Date(lastSuccess.endTime ?? lastSuccess.startTime ?? 0);
    hoursSinceLastSuccess = (new Date(nowIso).getTime() - successTime.getTime()) / (1000 * 60 * 60);
    isStale = hoursSinceLastSuccess > maxStaleHours;
  }

  // Classify each failure by error code.
  const failuresByCode: Record<string, number> = {};
  for (const entry of sorted.filter((r) => r.status === 'Failed')) {
    const { code } = extractFailureInfo([entry]);
    if (code) {
      failuresByCode[code] = (failuresByCode[code] ?? 0) + 1;
    }
  }

  return { consecutiveFailureCount, isStale, hoursSinceLastSuccess, failuresByCode };
}

/** Patterns in refresh error codes / messages that signal data-integrity or
 *  credential problems — all of these directly prevent visuals from rendering
 *  with correct data. */
const DATA_INTEGRITY_PATTERNS: RegExp[] = [
  // ── data integrity ────────────────────────────────────────────────────────
  /duplicate/i,
  /unique.*constraint/i,
  /primary.*key/i,
  /ambiguous.*relationship/i,
  /multiple.*values/i,
  /cannot.*determine.*single/i,
  /RowValueConflict/i,
  // ── credential / gateway auth ─────────────────────────────────────────────
  /MonikerWithUnbound/i,
  /unbound.*data.*source/i,
  /credential/i,
  /unauthorized/i,
  /oauth/i,
  // Azure AD / DMTS auth errors (e.g. DMTS_UserNotFoundInADGraphError)
  /UserNotFound/i,
  /ADGraph/i,
  /DMTS_/i,
  // On-premises gateway auth failures
  /DM_GW.*Auth/i,
  /InvalidServiceAccount/i,
];

export interface DataIntegrityHit {
  code: string;
  message: string;
  time: string;
  matchedPattern: string;
}

/** Scan all refresh failures for patterns that indicate broken data integrity
 *  or broken credential binding — both cause visuals to render wrong or not at all. */
export function scanForDataIntegrityErrors(
  refreshes: RefreshHistoryEntry[],
): DataIntegrityHit[] {
  const hits: DataIntegrityHit[] = [];

  for (const r of refreshes) {
    if (r.status !== 'Failed') continue;
    const { code, message } = extractFailureInfo([r]);
    const combined = `${code ?? ''} ${message ?? ''}`;
    const matched = DATA_INTEGRITY_PATTERNS.find((p) => p.test(combined));
    if (matched) {
      hits.push({
        code: code ?? '',
        message: message ?? '',
        time: r.endTime ?? r.startTime ?? '',
        matchedPattern: matched.source,
      });
    }
  }

  return hits;
}
