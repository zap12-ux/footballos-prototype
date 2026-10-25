import type {
  Concept,
  DepthChart,
  ErrorCode,
  GamePlan,
  GamePlanVersion,
  Invite,
  JobStatus,
  Label,
  LabelKey,
  LabelRevision,
  MediaAsset,
  MediaGrant,
  ModelProvenance,
  Opponent,
  PersonnelPackage,
  PlanComment,
  PlaybookDocument,
  PlaybookVersion,
  Player,
  PlaySegment,
  ProcessingJob,
  ReportSnapshot,
  ReviewBasis,
  Role,
  ScheduleImport,
  ScheduledGame,
  ScoutingFinding,
  Season,
  StaffMembership,
  Team,
  Unit,
  Upload,
  UploadContext,
  User,
} from './contracts';

/** Thrown by every Api implementation; mirrors the CONTRACTS §2 error envelope. */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown>;
  constructor(code: ErrorCode, message: string, status: number, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** `GET /auth/me`: the signed-in user with the memberships the session can see. */
export interface Me {
  user: User;
  mfaVerified: boolean;
  memberships: StaffMembership[];
}

export type SignInResult = { kind: 'signed_in'; me: Me } | { kind: 'mfa_required' };

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

/** CONTRACTS §14.7: `GET/PATCH /teams/:teamId/settings` → `{ settings }`. */
export interface UploadLimits {
  /** `MAX_UPLOAD_BYTES`; the client refuses larger files before creating an upload. */
  maxUploadBytes: number;
  /** `UPLOAD_CHUNK_BYTES`; the resumable client never sends a larger range. */
  chunkBytes: number;
  /** `ALLOWED_VIDEO_CONTAINERS`, e.g. `['mp4', 'mov']`. */
  allowedVideoContainers: string[];
}

export interface TeamSettings {
  retentionDays: number | null;
  uploadLimits: UploadLimits;
  version: number;
}

export interface GamePlanBundle {
  plan: GamePlan;
  versions: GamePlanVersion[];
  comments: PlanComment[];
}

/** `POST /games/:gameId/uploads` (§14.1). `sha256` is optional: skipped for very large files. */
export interface CreateUploadInput {
  filename: string;
  byteSize: number;
  mimeType: string;
  sha256?: string;
  context: UploadContext;
}

/** One `PUT /uploads/:id` range: `Content-Range: bytes start-end/total` (end inclusive). */
export interface ChunkRange {
  start: number;
  end: number;
  total: number;
}

export interface JobQuery {
  assetId?: string;
  status?: JobStatus;
}

/** `PATCH /labels/:labelId` (§14.5). */
export interface LabelCorrection {
  accepted: { value: string | null; status: 'accepted' | 'corrected' | 'unknown' | 'rejected' };
  reason?: string;
  expectedVersion: number;
}

/** `GET /teams/:teamId/opponents/:opponentId/scouting` (§14.6): computed, never stored. */
export interface ScoutingReport {
  findings: ScoutingFinding[];
  games: { gameId: string; assetIds: string[] }[];
  sampleSize: number;
  computedAt: string;
  computeVersion: string;
}

export interface ScoutingQuery {
  unit: Unit;
  reviewBasis: ReviewBasis;
  gameIds?: string[];
}

/**
 * The application-facing API. One implementation talks to `apps/api` over HTTP (the typed
 * `hc<AppType>` client); the other (`MockApi`) serves clearly labelled demo data so every
 * screen works without a server. Method groups follow the CONTRACTS §12 and §14 route tables.
 */
export interface Api {
  readonly mode: 'mock' | 'http';
  auth: {
    me(): Promise<Me | null>;
    signIn(input: { email: string; password: string }): Promise<SignInResult>;
    verifyMfa(input: { code: string }): Promise<Me>;
    signOut(): Promise<void>;
    requestRecovery(input: { email: string }): Promise<void>;
  };
  teams: {
    list(): Promise<Team[]>;
    get(teamId: string): Promise<Team>;
    staff(teamId: string): Promise<{ members: (StaffMembership & { user: User })[]; invites: Invite[] }>;
    invite(teamId: string, input: { email: string; role: Role; unit: Unit | null }): Promise<Invite>;
    updateMembership(
      teamId: string,
      membershipId: string,
      patch: Partial<Pick<StaffMembership, 'role' | 'units' | 'active' | 'title'>>,
    ): Promise<StaffMembership>;
    settings(teamId: string): Promise<TeamSettings>;
    updateSettings(teamId: string, patch: Partial<Omit<TeamSettings, 'version'>> & { expectedVersion: number }): Promise<TeamSettings>;
  };
  seasons: {
    list(teamId: string): Promise<Season[]>;
    opponents(teamId: string): Promise<Opponent[]>;
    games(teamId: string, seasonId: string): Promise<ScheduledGame[]>;
    createGame(
      teamId: string,
      seasonId: string,
      input: Pick<ScheduledGame, 'week' | 'kind' | 'opponentId' | 'location' | 'scheduledAt' | 'notes'>,
    ): Promise<ScheduledGame>;
    updateGame(
      gameId: string,
      patch: Partial<Pick<ScheduledGame, 'week' | 'kind' | 'opponentId' | 'location' | 'scheduledAt' | 'status' | 'result' | 'notes'>> & {
        expectedVersion: number;
      },
    ): Promise<ScheduledGame>;
    previewImport(teamId: string, seasonId: string, file: { name: string; text: string }): Promise<ScheduleImport>;
    applyImport(importId: string): Promise<ScheduledGame[]>;
  };
  media: {
    assets(gameId: string): Promise<MediaAsset[]>;
    asset(assetId: string): Promise<MediaAsset>;
    /** §14.1: `409 conflict` with `details.existingAssetId` when the sha256 is already stored. */
    createUpload(gameId: string, input: CreateUploadInput): Promise<{ upload: Upload; asset: MediaAsset }>;
    /** §14.1: `409 conflict` with `details.receivedBytes` when the range is not contiguous. */
    putChunk(uploadId: string, range: ChunkRange, body: Blob): Promise<{ receivedBytes: number }>;
    getUpload(uploadId: string): Promise<Upload>;
    completeUpload(uploadId: string): Promise<{ asset: MediaAsset; jobs: ProcessingJob[] }>;
    deleteAsset(assetId: string): Promise<void>;
    /** §14.3: expiring, team-scoped URLs for the proxy stream and thumbnail tiles. */
    grant(assetId: string): Promise<MediaGrant>;
    jobs(teamId: string, query?: JobQuery): Promise<ProcessingJob[]>;
    job(jobId: string): Promise<ProcessingJob>;
    cancelJob(jobId: string): Promise<ProcessingJob>;
    retryJob(jobId: string): Promise<ProcessingJob>;
    segments(assetId: string): Promise<PlaySegment[]>;
    splitSegment(segmentId: string, input: { atSec: number; expectedVersion: number }): Promise<{ segments: PlaySegment[]; superseded: PlaySegment }>;
    mergeSegments(input: { segmentIds: string[]; expectedVersion: Record<string, number> }): Promise<{ segment: PlaySegment; superseded: PlaySegment[] }>;
    updateSegment(
      segmentId: string,
      patch: { reviewStatus?: PlaySegment['reviewStatus']; startSec?: number; endSec?: number; expectedVersion: number },
    ): Promise<PlaySegment>;
    createSegment(assetId: string, input: { startSec: number; endSec: number }): Promise<PlaySegment>;
  };
  labels: {
    forAsset(assetId: string): Promise<Label[]>;
    forSegment(segmentId: string): Promise<Label[]>;
    correct(labelId: string, input: LabelCorrection): Promise<Label>;
    revisions(labelId: string): Promise<LabelRevision[]>;
    /** §14.5 rule: only `accepted.status === 'inferred'` with `inferred.abstained === false` change. */
    bulkAccept(assetId: string, input: { segmentIds: string[]; keys: LabelKey[] }): Promise<{ accepted: number; skipped: number }>;
    provenance(assetId: string): Promise<ModelProvenance[]>;
    /** §14.5: `202 { jobs }`; with no provider the job fails truthfully with `provider_unavailable`. */
    infer(assetId: string, input?: { segmentIds?: string[]; labelKeys?: LabelKey[] }): Promise<ProcessingJob[]>;
  };
  scouting: {
    report(teamId: string, opponentId: string, query: ScoutingQuery): Promise<ScoutingReport>;
    snapshots(teamId: string, opponentId: string): Promise<ReportSnapshot[]>;
    saveSnapshot(teamId: string, opponentId: string, input: { title: string; unit: Unit; reviewBasis: ReviewBasis }): Promise<ReportSnapshot>;
  };
  plans: {
    get(gameId: string, unit: Unit): Promise<GamePlanBundle>;
    createDraft(versionId: string): Promise<GamePlanVersion>;
    update(
      versionId: string,
      patch: { sections: GamePlanVersion['sections']; expectedVersion: number },
    ): Promise<GamePlanVersion>;
    submit(versionId: string): Promise<GamePlanVersion>;
    approve(versionId: string): Promise<GamePlanVersion>;
    comment(versionId: string, input: { sectionKey: string | null; itemId: string | null; body: string }): Promise<PlanComment>;
  };
  playbook: {
    documents(teamId: string, unit: Unit): Promise<PlaybookDocument[]>;
    versions(teamId: string, unit: Unit): Promise<PlaybookVersion[]>;
    concepts(versionId: string): Promise<Concept[]>;
    decideConcept(conceptId: string, input: { status: 'approved' | 'rejected'; expectedVersion: number }): Promise<Concept>;
  };
  personnel: {
    players(teamId: string, seasonId: string): Promise<Player[]>;
    depthChart(teamId: string, seasonId: string, unit: Unit): Promise<DepthChart | null>;
    packages(teamId: string, seasonId: string, unit: Unit): Promise<PersonnelPackage[]>;
  };
}
