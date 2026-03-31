export type ServerErrorCode =
  | 'SCAN_NOT_FOUND'
  | 'PLAN_NOT_FOUND'
  | 'REPORT_NOT_FOUND'
  | 'INVALID_INPUT'
  | 'RATE_LIMITED'
  | 'SCAN_FAILED'
  | 'AWS_ERROR'
  | 'PLAN_INVALID'
  | 'DB_ERROR'
  | 'INTERNAL_ERROR';

export interface ServerErrorOptions {
  readonly code: ServerErrorCode;
  readonly status: number;
  readonly details?: unknown;
  readonly cause?: unknown;
}

export class ServerError extends Error {
  public readonly code: ServerErrorCode;
  public readonly status: number;
  public readonly details?: unknown;
  public readonly cause?: unknown;

  public constructor(message: string, options: ServerErrorOptions) {
    super(message);
    this.name = 'ServerError';
    this.code = options.code;
    this.status = options.status;
    this.details = options.details;
    this.cause = options.cause;
  }
}

export function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(typeof error === 'string' ? error : 'Unknown error');
}
