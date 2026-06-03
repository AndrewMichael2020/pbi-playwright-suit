import { RefreshHealthResult, RefreshHistoryEntry } from './types';

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
