/**
 * Typed domain errors for the Power BI REST boundary.
 *
 * Low-level transport failures (non-2xx HTTP responses) are translated into a
 * single named domain error, `PowerBiError`, whose `kind` field is a closed
 * discriminant. Callers branch on `kind` instead of pattern-matching status
 * codes or error strings. The original transport error, when present, is kept
 * on `cause` so the underlying stack is never lost.
 */

export type PowerBiErrorKind = 'auth' | 'notFound' | 'throttled' | 'service';

export interface HttpErrorContext {
  /** HTTP status code that triggered the failure. */
  status: number;
  /** Request URL, for diagnostics. */
  url: string;
  /** Raw response body text, for diagnostics. */
  body: string;
}

const KIND_LABEL: Record<PowerBiErrorKind, string> = {
  auth: 'Authentication or authorization failed',
  notFound: 'Resource not found',
  throttled: 'Request was throttled by Power BI',
  service: 'Power BI service error',
};

/** Maps an HTTP status code to a closed domain error kind. Pure. */
export function classifyHttpError(status: number): PowerBiErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'notFound';
  if (status === 429) return 'throttled';
  return 'service';
}

/** Named domain error raised at the Power BI REST boundary. */
export class PowerBiError extends Error {
  readonly kind: PowerBiErrorKind;
  readonly status: number;
  readonly url: string;
  readonly body: string;

  constructor(
    message: string,
    context: HttpErrorContext & { kind: PowerBiErrorKind },
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'PowerBiError';
    this.kind = context.kind;
    this.status = context.status;
    this.url = context.url;
    this.body = context.body;
  }
}

/**
 * Translates a non-2xx Power BI HTTP response into a `PowerBiError`, classifying
 * the kind from the status code and preserving the original transport `cause`.
 */
export function httpErrorFromResponse(args: {
  status: number;
  statusText: string;
  url: string;
  body: string;
  cause?: unknown;
}): PowerBiError {
  const kind = classifyHttpError(args.status);
  const message =
    `${KIND_LABEL[kind]} (${args.status} ${args.statusText}) for ${args.url}` +
    (args.body ? `: ${args.body}` : '');

  return new PowerBiError(
    message,
    { kind, status: args.status, url: args.url, body: args.body },
    { cause: args.cause },
  );
}
