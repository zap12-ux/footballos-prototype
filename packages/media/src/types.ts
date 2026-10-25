/**
 * Local structural types mirroring docs/team/CONTRACTS.md §5.
 *
 * `@footballos/contracts` does not exist yet. These declarations use the same
 * field names so the switch is a type-import change; nothing here is exported
 * as a schema. When the contracts package lands, replace these with imports.
 */

export type MediaAssetStatus =
  | 'uploading'
  | 'uploaded'
  | 'validated'
  | 'rejected'
  | 'processing'
  | 'ready'
  | 'failed'
  | 'deleted';

export interface MediaAssetContext {
  analyzedTeam: 'us' | 'opponent';
  analyzedUnit: 'offense' | 'defense' | 'special_teams' | 'mixed';
  perspective: 'sideline_fixed' | 'endzone' | 'broadcast' | 'other';
  teamCues: string | null;
}

export interface FootageQuality {
  stable: boolean | null;
  lineOfScrimmageVisible: boolean | null;
  allTwentyTwoVisible: boolean | null;
  notes: string[];
  unevaluable: string[];
}

export interface MediaAsset {
  id: string;
  teamId: string;
  gameId: string;
  uploadedBy: string;
  kind: 'game_film' | 'clip' | 'document' | 'image';
  originalFilename: string;
  byteSize: number;
  sha256: string;
  mimeType: string;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  status: MediaAssetStatus;
  rejectionReason: string | null;
  context: MediaAssetContext;
  quality: FootageQuality | null;
  storageKey: string;
  proxyStorageKey: string | null;
  thumbnailSheetKey: string | null;
  retentionUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ProcessingJobKind =
  | 'validate'
  | 'proxy'
  | 'thumbnails'
  | 'segment'
  | 'infer_labels'
  | 'extract_document'
  | 'reanalyze_segments';

export type ProcessingJobStatus =
  | 'queued'
  | 'running'
  | 'retry_wait'
  | 'succeeded'
  | 'failed'
  | 'canceled';

export interface JobProgress {
  done: number;
  total: number | null;
  message: string;
}

export interface JobError {
  code: string;
  message: string;
}

export interface ProcessingJob {
  id: string;
  teamId: string;
  assetId: string | null;
  kind: ProcessingJobKind | string;
  status: ProcessingJobStatus;
  progress: JobProgress;
  attempt: number;
  maxAttempts: number;
  leaseExpiresAt: string | null;
  workerId: string | null;
  idempotencyKey: string;
  configVersion: string;
  error: JobError | null;
  requestedBy: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  canceledAt: string | null;
}

export type SegmentOrigin = 'proposed' | 'coach_split' | 'coach_merged' | 'coach_created';
export type SegmentReviewStatus = 'proposed' | 'accepted' | 'rejected';

export interface PlaySegment {
  id: string;
  teamId: string;
  assetId: string;
  gameId: string;
  index: number;
  startSec: number;
  endSec: number;
  origin: SegmentOrigin;
  reviewStatus: SegmentReviewStatus;
  supersededBy: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
}
