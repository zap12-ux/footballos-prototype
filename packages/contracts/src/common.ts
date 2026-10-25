import { z } from 'zod';

// §1 Conventions ---------------------------------------------------------------------------

/** UUID v4 generated with `crypto.randomUUID()`; never reused. */
export const IdSchema = z.uuid();
export type Id = z.infer<typeof IdSchema>;

/** ISO 8601 UTC timestamp with millisecond precision, e.g. `2026-10-25T16:04:12.345Z`. */
export const TimestampSchema = z.iso.datetime({ precision: 3 });
export type Timestamp = z.infer<typeof TimestampSchema>;

/** Calendar date `YYYY-MM-DD` (no time, no zone). */
export const DateOnlySchema = z.iso.date();
export type DateOnly = z.infer<typeof DateOnlySchema>;

/** Seconds from the start of the original uploaded file. */
export const SecondsSchema = z.number().finite().nonnegative();
export type Seconds = z.infer<typeof SecondsSchema>;

/** Optimistic-concurrency version; starts at 1. */
export const VersionSchema = z.number().int().positive();
export type Version = z.infer<typeof VersionSchema>;

export const UnitSchema = z.enum(['offense', 'defense', 'special_teams']);
export type Unit = z.infer<typeof UnitSchema>;

export const EnvironmentKindSchema = z.enum(['demo', 'research', 'production']);
export type EnvironmentKind = z.infer<typeof EnvironmentKindSchema>;

/** USD with up to 6 decimals. */
export const CostUsdSchema = z
  .number()
  .finite()
  .nonnegative()
  .refine((n) => Number.isInteger(Math.round(n * 1e6)) && Math.abs(n * 1e6 - Math.round(n * 1e6)) < 1e-6, {
    message: 'costUsd allows at most 6 decimals',
  });
export type CostUsd = z.infer<typeof CostUsdSchema>;

export const TokenCountSchema = z.number().int().nonnegative();

// Pagination ------------------------------------------------------------------------------

export const PAGINATION_DEFAULT_LIMIT = 50;
export const PAGINATION_MAX_LIMIT = 200;

export const PaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(PAGINATION_MAX_LIMIT).default(PAGINATION_DEFAULT_LIMIT),
  cursor: z.string().min(1).optional(),
});
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

export function paginated<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });
}
export type Paginated<T> = { items: T[]; nextCursor: string | null };

// §2 Error envelope -----------------------------------------------------------------------

export const ErrorCodeSchema = z.enum([
  'validation_error',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'payload_too_large',
  'rate_limited',
  'provider_unavailable',
  'gone',
  'internal',
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ERROR_STATUS: Record<ErrorCode, 400 | 401 | 403 | 404 | 409 | 410 | 413 | 429 | 503 | 500> = {
  validation_error: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  payload_too_large: 413,
  rate_limited: 429,
  provider_unavailable: 503,
  /** Share link expired or revoked (v0.4, §15.4). */
  gone: 410,
  internal: 500,
};

export const ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;
