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
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
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

export const JobErrorSchema = z.object({ code: z.string().min(1), message: z.string() });
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
