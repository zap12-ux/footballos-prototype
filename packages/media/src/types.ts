/**
 * Record types used by this package, imported from `@footballos/contracts`
 * (authoritative; docs/team/CONTRACTS.md §5, §6). This file only re-exports
 * them under the names the rest of the package and its tests use, so no
 * structural copy of a contract lives here any more.
 *
 * Contract gaps noticed while switching (not edited here; `packages/contracts`
 * is owned by B):
 * - `ProcessingJob` has no `input`, `result`, `notBeforeAt`, `cancelRequestedAt`
 *   fields; the job store's `Job` type adds them (see `jobs/types.ts`, §14.2).
 * - `ProcessingJob.kind` is the closed `JobKind` enum. The runner stays generic
 *   over kind strings so hosts can register kinds the contract does not list yet.
 */
import type {
  EvidenceRef,
  FootageQuality,
  JobError,
  JobKind,
  JobProgress,
  JobStatus,
  MediaAsset,
  MediaStatus,
  PlaySegment,
  ProcessingJob,
  SegmentOrigin,
  SegmentReviewStatus,
  UploadContext,
} from '@footballos/contracts';

export type {
  EvidenceRef,
  FootageQuality,
  JobError,
  JobKind,
  JobProgress,
  JobStatus,
  MediaAsset,
  MediaStatus,
  PlaySegment,
  ProcessingJob,
  SegmentOrigin,
  SegmentReviewStatus,
  UploadContext,
};

// Thin aliases kept for Milestone A call sites and tests.
export type MediaAssetStatus = MediaStatus;
export type MediaAssetContext = UploadContext;
export type ProcessingJobKind = JobKind;
export type ProcessingJobStatus = JobStatus;
