import { ERROR_STATUS, type ErrorCode, type ErrorEnvelope } from '@footballos/contracts';

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: (typeof ERROR_STATUS)[ErrorCode];
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.details = details;
  }

  toEnvelope(): ErrorEnvelope {
    return { error: { code: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) } };
  }
}

export const errors = {
  validation: (message: string, details?: Record<string, unknown>) => new ApiError('validation_error', message, details),
  unauthorized: (message = 'Authentication required', details?: Record<string, unknown>) => new ApiError('unauthorized', message, details),
  forbidden: (message = 'Not permitted') => new ApiError('forbidden', message),
  notFound: (what = 'Record') => new ApiError('not_found', `${what} not found`),
  conflict: (message: string, details?: Record<string, unknown>) => new ApiError('conflict', message, details),
  rateLimited: (retryAfterSec: number) => new ApiError('rate_limited', 'Too many attempts; try again later', { retryAfterSec }),
  internal: () => new ApiError('internal', 'Internal error'),
};
