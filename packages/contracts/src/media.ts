import { z } from 'zod';
import { IdSchema, SecondsSchema, TimestampSchema, VersionSchema } from './common.js';

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
  gameId: IdSchema,
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

export const CreateUploadRequestSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  byteSize: z.number().int().positive(),
  mimeType: z.string().min(1).max(127),
  /** Optional client-side hash; enables the early duplicate check (`409 existingAssetId`). */
  sha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  kind: z.enum(['game_film', 'clip']).default('game_film'),
  context: UploadContextSchema,
});
export type CreateUploadRequest = z.infer<typeof CreateUploadRequestSchema>;

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
