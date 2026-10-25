export type ErrorCode = 'validation_error' | 'unauthorized' | 'not_found' | 'conflict' | 'gone' | 'internal';

const STATUS: Record<ErrorCode, number> = {
  validation_error: 400,
  unauthorized: 401,
  not_found: 404,
  conflict: 409,
  gone: 410,
  internal: 500,
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }
  toBody() {
    return { error: { code: this.code, message: this.message, ...(this.details !== undefined ? { details: this.details } : {}) } };
  }
}

export const notFound = (what = 'resource') => new ApiError('not_found', `${what} not found`);
export const unauthorized = (message = 'unauthorized') => new ApiError('unauthorized', message);
export const conflict = (message: string, details?: unknown) => new ApiError('conflict', message, details);
export const gone = (message: string, details?: unknown) => new ApiError('gone', message, details);
export const validation = (message: string, details?: unknown) => new ApiError('validation_error', message, details);
