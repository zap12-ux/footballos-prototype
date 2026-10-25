import { z } from 'zod';
import { IdSchema, SecondsSchema, TimestampSchema, UnitSchema, VersionSchema } from './common.js';

// §5 Media, processing jobs, segments ----------------------------------------------------

export const MediaKindSchema = z.enum(['game_film', 'clip', 'document', 'image']);
export type MediaKind = z.infer<typeof MediaKindSchema>;

export const MediaStatusSchema = z.enum([
  'uploading',
  'uploaded',
  'validated',
  'rejected',
  'processing',
  'ready',
  'failed',
  'deleted',
]);
export type MediaStatus = z.infer<typeof MediaStatusSchema>;

export const AnalyzedTeamSchema = z.enum(['us', 'opponent']);
export const AnalyzedUnitSchema = z.enum(['offense', 'defense', 'special_teams', 'mixed']);
export const PerspectiveSchema = z.enum(['sideline_fixed', 'endzone', 'broadcast', 'other']);

export const UploadContextSchema = z.object({
  analyzedTeam: AnalyzedTeamSchema,
  analyzedUnit: AnalyzedUnitSchema,
  perspective: PerspectiveSchema,
  /** Coach-provided, untrusted text, e.g. "white jerseys, gold helmets". */
  teamCues: z.string().max(500).nullable(),
});
export type UploadContext = z.infer<typeof UploadContextSchema>;

export const FootageQualitySchema = z.object({
  stable: z.boolean().nullable(),
  lineOfScrimmageVisible: z.boolean().nullable(),
  allTwentyTwoVisible: z.boolean().nullable(),
  notes: z.array(z.string()),
  /** What could not be assessed, in words. */
  unevaluable: z.array(z.string()),
});
export type FootageQuality = z.infer<typeof FootageQualitySchema>;

export const MediaAssetSchema = z.object({
  id: IdSchema,
  teamId: IdSchema,
  /** Null for playbook documents uploaded at team level (v0.4, §15.1); film is always game-bound. */
  gameId: IdSchema.nullable(),
  uploadedBy: IdSchema,
  kind: MediaKindSchema,
  originalFilename: z.string().min(1).max(255),
  byteSize: z.number().int().nonnegative(),
  /** Hex sha256 of the original file; null while the upload is still in progress (v0.3). */
  sha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  mimeType: z.string().min(1).max(127),
  durationSec: SecondsSchema.nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  fps: z.number().positive().nullable(),
  status: MediaStatusSchema,
  rejectionReason: z.string().nullable(),
  context: UploadContextSchema,
  quality: FootageQualitySchema.nullable(),
  storageKey: z.string().min(1),
  proxyStorageKey: z.string().nullable(),
  thumbnailSheetKey: z.string().nullable(),
  retentionUntil: TimestampSchema.nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type MediaAsset = z.infer<typeof MediaAssetSchema>;

export const UploadSchema = z.object({
  id: IdSchema,
  assetId: IdSchema,
  teamId: IdSchema,
  chunkSizeBytes: z.number().int().positive(),
  receivedBytes: z.number().int().nonnegative(),
  totalBytes: z.number().int().positive(),
  expiresAt: TimestampSchema,
  completedAt: TimestampSchema.nullable(),
});
export type Upload = z.infer<typeof UploadSchema>;

export const MediaGrantSchema = z.object({
  streamUrl: z.string(),
  thumbUrlTemplate: z.string(),
  expiresAt: TimestampSchema,
});
export type MediaGrant = z.infer<typeof MediaGrantSchema>;

export const JobKindSchema = z.enum([
  'validate',
  'proxy',
  'thumbnails',
  'segment',
  'infer_labels',
  'extract_document',
  'reanalyze_segments',
]);
export type JobKind = z.infer<typeof JobKindSchema>;

export const JobStatusSchema = z.enum(['queued', 'running', 'retry_wait', 'succeeded', 'failed', 'canceled']);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const JobProgressSchema = z.object({
  done: z.number().int().nonnegative(),
  total: z.number().int().nonnegative().nullable(),
  message: z.string(),
});
export type JobProgress = z.infer<typeof JobProgressSchema>;

export const JobErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string(),
  /** False when no further attempt will be made (set by the job store when the job ends `failed`). */
  retryable: z.boolean().optional(),
});
export type JobError = z.infer<typeof JobErrorSchema>;

export const ProcessingJobSchema = z.object({
  id: IdSchema,
  teamId: IdSchema,
  assetId: IdSchema.nullable(),
  kind: JobKindSchema,
  status: JobStatusSchema,
  progress: JobProgressSchema,
  attempt: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  leaseExpiresAt: TimestampSchema.nullable(),
  workerId: z.string().nullable(),
  /** sha256(kind + inputs + config version); a duplicate returns the existing job. */
  idempotencyKey: z.string().regex(/^[0-9a-f]{64}$/),
  configVersion: z.string().min(1),
  error: JobErrorSchema.nullable(),
  requestedBy: IdSchema.nullable(),
  createdAt: TimestampSchema,
  startedAt: TimestampSchema.nullable(),
  finishedAt: TimestampSchema.nullable(),
  canceledAt: TimestampSchema.nullable(),
  /** `retry_wait` wake-up time (store field adopted in v0.3). */
  notBeforeAt: TimestampSchema.nullable().optional(),
  /** Set when a cancel was requested for a running job (store field adopted in v0.3). */
  cancelRequestedAt: TimestampSchema.nullable().optional(),
});
export type ProcessingJob = z.infer<typeof ProcessingJobSchema>;

export const SegmentOriginSchema = z.enum(['proposed', 'coach_split', 'coach_merged', 'coach_created']);
export type SegmentOrigin = z.infer<typeof SegmentOriginSchema>;

export const SegmentReviewStatusSchema = z.enum(['proposed', 'accepted', 'rejected']);
export type SegmentReviewStatus = z.infer<typeof SegmentReviewStatusSchema>;

export const PlaySegmentSchema = z
  .object({
    id: IdSchema,
    teamId: IdSchema,
    assetId: IdSchema,
    gameId: IdSchema,
    index: z.number().int().nonnegative(),
    startSec: SecondsSchema,
    endSec: SecondsSchema,
    origin: SegmentOriginSchema,
    reviewStatus: SegmentReviewStatusSchema,
    /** ids after split/merge; the original is kept, never rewritten. */
    supersededBy: z.array(IdSchema),
    version: VersionSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .refine((s) => s.endSec > s.startSec, { message: 'endSec must be after startSec', path: ['endSec'] });
export type PlaySegment = z.infer<typeof PlaySegmentSchema>;

// §14.1 Resumable uploads: request / response shapes (v0.3) ------------------------------

/**
 * Sanitizes a client-supplied upload filename (§14.10, QA D-7): control characters (C0, DEL) are
 * removed, the result is trimmed and must be 1..255 characters with a stem before the extension.
 * Returns null when the name must be rejected: a NUL byte anywhere, empty after cleaning, longer
 * than 255 characters, or no stem (`.mp4`, `..mp4`). Storage keys never use this name; it is the
 * display name echoed to clients.
 */
export function sanitizeFilename(input: string): string | null {
  if (input.includes('\u0000')) return null;
  const cleaned = input.replace(/[\u0001-\u001f\u007f]/g, '').trim();
  if (cleaned.length === 0 || cleaned.length > 255) return null;
  const stem = cleaned.replace(/\.[A-Za-z0-9]{1,8}$/, '');
  if (stem.replace(/\./g, '').length === 0) return null;
  return cleaned;
}

/** Upload filename: sanitized on intake (see `sanitizeFilename`); invalid names are a validation error. */
export const UploadFilenameSchema = z
  .string()
  .max(4096)
  .transform((v, ctx) => {
    const out = sanitizeFilename(v);
    if (out === null) {
      ctx.addIssue({ code: 'custom', message: 'filename must be 1-255 characters with a name before the extension and no control characters' });
      return z.NEVER;
    }
    return out;
  });

export const CreateUploadRequestSchema = z
  .object({
    filename: UploadFilenameSchema,
    byteSize: z.number().int().positive(),
    mimeType: z.string().min(1).max(127),
    /** Optional client-side hash; enables the early duplicate check (`409 existingAssetId`). */
    sha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
    /** `document` (v0.4, §15.1): a playbook document; `context` is then omitted and `unit` is required. */
    kind: z.enum(['game_film', 'clip', 'document']).default('game_film'),
    context: UploadContextSchema.optional(),
    /** Documents only: the unit the playbook belongs to. */
    unit: UnitSchema.optional(),
    /** Documents only: display title (defaults to the filename stem). */
    title: z.string().trim().min(1).max(200).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'document') {
      if (!v.unit) ctx.addIssue({ code: 'custom', path: ['unit'], message: 'unit is required for a document upload' });
    } else if (!v.context) {
      ctx.addIssue({ code: 'custom', path: ['context'], message: 'context is required for film uploads' });
    }
  });
export type CreateUploadRequest = z.infer<typeof CreateUploadRequestSchema>;

/** §15.1 team-level document intake: `POST /teams/:teamId/playbook/documents` (same chunk/complete flow as film). */
export const CreateDocumentUploadRequestSchema = z.object({
  filename: UploadFilenameSchema,
  byteSize: z.number().int().positive(),
  mimeType: z.string().min(1).max(127),
  sha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  unit: UnitSchema,
  title: z.string().trim().min(1).max(200).optional(),
});
export type CreateDocumentUploadRequest = z.infer<typeof CreateDocumentUploadRequestSchema>;

export const CreateUploadResponseSchema = z.object({ upload: UploadSchema, asset: MediaAssetSchema });
export type CreateUploadResponse = z.infer<typeof CreateUploadResponseSchema>;

export const UploadChunkResponseSchema = z.object({ receivedBytes: z.number().int().nonnegative() });
export type UploadChunkResponse = z.infer<typeof UploadChunkResponseSchema>;

export const UploadCompleteRequestSchema = z.object({
  /** Client-side hash of the whole file; a mismatch with the stored bytes is `400`. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
});
export type UploadCompleteRequest = z.infer<typeof UploadCompleteRequestSchema>;

export const UploadCompleteResponseSchema = z.object({ asset: MediaAssetSchema, jobs: z.array(ProcessingJobSchema) });
export type UploadCompleteResponse = z.infer<typeof UploadCompleteResponseSchema>;

// §14.2 Jobs ----------------------------------------------------------------------------

const commaList = <T extends z.ZodTypeAny>(item: T) =>
  z.preprocess((v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : v), z.array(item));

export const JobsQuerySchema = z.object({
  assetId: IdSchema.optional(),
  /** One status or a comma-separated list. */
  status: commaList(JobStatusSchema).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).optional(),
});
export type JobsQuery = z.infer<typeof JobsQuerySchema>;

// §14.4 Segments -------------------------------------------------------------------------

export const SplitSegmentRequestSchema = z.object({ atSec: SecondsSchema, expectedVersion: VersionSchema });
export type SplitSegmentRequest = z.infer<typeof SplitSegmentRequestSchema>;

export const MergeSegmentsRequestSchema = z.object({
  segmentIds: z.array(IdSchema).min(2).max(50),
  expectedVersion: z.record(IdSchema, VersionSchema),
});
export type MergeSegmentsRequest = z.infer<typeof MergeSegmentsRequestSchema>;

export const PatchSegmentRequestSchema = z
  .object({
    expectedVersion: VersionSchema,
    reviewStatus: SegmentReviewStatusSchema.optional(),
    startSec: SecondsSchema.optional(),
    endSec: SecondsSchema.optional(),
  })
  .refine((p) => p.startSec === undefined || p.endSec === undefined || p.endSec > p.startSec, {
    message: 'endSec must be after startSec',
    path: ['endSec'],
  });
export type PatchSegmentRequest = z.infer<typeof PatchSegmentRequestSchema>;

export const CreateSegmentRequestSchema = z
  .object({ startSec: SecondsSchema, endSec: SecondsSchema })
  .refine((s) => s.endSec > s.startSec, { message: 'endSec must be after startSec', path: ['endSec'] });
export type CreateSegmentRequest = z.infer<typeof CreateSegmentRequestSchema>;
