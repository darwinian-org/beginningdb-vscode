export type BeginningDbErrorKind =
  | 'not_found'
  | 'already_exists'
  | 'permission_denied'
  | 'conflict'
  | 'precondition_failed'
  | 'quota_exceeded'
  | 'rate_limited'
  | 'unavailable'
  | 'unauthorized'
  | 'bad_request'
  | 'unknown';

export class BeginningDbError extends Error {
  constructor(
    readonly kind: BeginningDbErrorKind,
    message: string,
    readonly status?: number,
    readonly retryAfterMs?: number
  ) {
    super(message);
    this.name = 'BeginningDbError';
  }

  get retryable(): boolean {
    return this.kind === 'rate_limited' || this.kind === 'unavailable';
  }
}
