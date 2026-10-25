/**
 * Contract shapes transcribed from `docs/team/CONTRACTS.md` (v0.1, 2026-10-25).
 *
 * TEMPORARY: `packages/contracts` (owned by Backend) is the authoritative source. When
 * `@footballos/contracts` lands, every type here becomes a re-export of that package and
 * any difference is resolved in favour of the package. Nothing in this file is a
 * hand-written fetch type; it is the entity vocabulary the screens are built against.
 */

export type EnvironmentKind = 'demo' | 'research' | 'production';
export type Unit = 'offense' | 'defense' | 'special_teams';
export type Role = 'head_coach' | 'coordinator' | 'position_coach' | 'analyst' | 'viewer';

// §2 error envelope ---------------------------------------------------------------------

export type ErrorCode =
  | 'validation_error'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'payload_too_large'
  | 'rate_limited'
  | 'provider_unavailable'
  | 'internal';

export interface ErrorEnvelope {
  error: { code: ErrorCode; message: string; details?: Record<string, unknown> };
}

// §3 auth -------------------------------------------------------------------------------

export interface User {
  id: string;
  email: string;
  displayName: string;
  mfaEnabled: boolean;
  createdAt: string;
}

export interface StaffMembership {
  id: string;
  teamId: string;
  userId: string;
  role: Role;
  units: Unit[];
  title: string;
  active: boolean;
  createdAt: string;
}

export interface Invite {
  id: string;
  teamId: string;
  email: string;
  role: Role;
  unit: Unit | null;
  expiresAt: string;
  acceptedAt: string | null;
  createdBy: string;
}

// §4 team, season, schedule -------------------------------------------------------------

export interface Team {
  id: string;
  name: string;
  shortName: string;
  level: 'high_school' | 'college' | 'other';
  environmentKind: EnvironmentKind;
  timezone: string;
  createdAt: string;
}

export interface Season {
  id: string;
  teamId: string;
  label: string;
  startsOn: string;
  endsOn: string;
  isCurrent: boolean;
}

export interface Opponent {
  id: string;
  teamId: string;
  name: string;
  shortName: string;
  notes: string;
}

export type GameKind = 'regular' | 'bye' | 'scrimmage' | 'playoff' | 'other';
export type GameStatus = 'scheduled' | 'rescheduled' | 'postponed' | 'canceled' | 'final';
export type GameLocation = 'home' | 'away' | 'neutral';

export interface GameResult {
  ourScore: number;
  theirScore: number;
  outcome: 'win' | 'loss' | 'tie';
}

export interface ScheduledGame {
  id: string;
  teamId: string;
  seasonId: string;
  week: number | null;
  kind: GameKind;
  opponentId: string | null;
  location: GameLocation | null;
  scheduledAt: string | null;
  status: GameStatus;
  result: GameResult | null;
  notes: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ImportRowError {
  row: number;
  message: string;
}

export interface ScheduleImport {
  id: string;
  teamId: string;
  seasonId: string;
  filename: string;
  status: 'previewed' | 'applied' | 'discarded';
  mapping: Record<string, string>;
  rowCount: number;
  errors: ImportRowError[];
  createdAt: string;
  /** Preview rows (frontend convenience; the import record itself stores only the mapping). */
  previewRows?: Array<Partial<Pick<ScheduledGame, 'week' | 'kind' | 'location' | 'scheduledAt'>> & { opponentName: string | null }>;
}

// §5 media ------------------------------------------------------------------------------

export type MediaStatus =
  | 'uploading'
  | 'uploaded'
  | 'validated'
  | 'rejected'
  | 'processing'
  | 'ready'
  | 'failed'
  | 'deleted';

export interface FootageQuality {
  stable: boolean | null;
  lineOfScrimmageVisible: boolean | null;
  allTwentyTwoVisible: boolean | null;
  notes: string[];
  unevaluable: string[];
}

export interface UploadContext {
  analyzedTeam: 'us' | 'opponent';
  analyzedUnit: Unit | 'mixed';
  perspective: 'sideline_fixed' | 'endzone' | 'broadcast' | 'other';
  teamCues: string | null;
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
  status: MediaStatus;
  rejectionReason: string | null;
  context: UploadContext;
  quality: FootageQuality | null;
  storageKey: string;
  proxyStorageKey: string | null;
  thumbnailSheetKey: string | null;
  retentionUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

export type JobKind =
  | 'validate'
  | 'proxy'
  | 'thumbnails'
  | 'segment'
  | 'infer_labels'
  | 'extract_document'
  | 'reanalyze_segments';
export type JobStatus = 'queued' | 'running' | 'retry_wait' | 'succeeded' | 'failed' | 'canceled';

export interface ProcessingJob {
  id: string;
  teamId: string;
  assetId: string | null;
  kind: JobKind;
  status: JobStatus;
  progress: { done: number; total: number | null; message: string };
  attempt: number;
  maxAttempts: number;
  leaseExpiresAt: string | null;
  workerId: string | null;
  idempotencyKey: string;
  configVersion: string;
  error: { code: string; message: string } | null;
  requestedBy: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  canceledAt: string | null;
}

export interface PlaySegment {
  id: string;
  teamId: string;
  assetId: string;
  gameId: string;
  index: number;
  startSec: number;
  endSec: number;
  origin: 'proposed' | 'coach_split' | 'coach_merged' | 'coach_created';
  reviewStatus: 'proposed' | 'accepted' | 'rejected';
  supersededBy: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

// §6 evidence ---------------------------------------------------------------------------

export interface EvidenceRef {
  assetId: string;
  atSec: number;
  toSec: number | null;
  frameIndex: number | null;
  note: string | null;
}

// §7 scouting ---------------------------------------------------------------------------

export type FindingKind =
  | 'formation_frequency'
  | 'play_type_by_formation'
  | 'tendency_by_situation'
  | 'strength'
  | 'weakness'
  | 'uncertain';

export interface ScoutingFinding {
  id: string;
  teamId: string;
  opponentId: string;
  gameIds: string[];
  unit: Unit;
  kind: FindingKind;
  statement: string;
  numerator: number;
  denominator: number;
  percent: number | null;
  sampleSize: number;
  includedSegmentIds: string[];
  excludedSegmentIds: string[];
  excludedReason: Record<string, string>;
  reviewBasis: 'reviewed_only' | 'includes_inferred';
  supportingEvidence: EvidenceRef[];
  contraryEvidence: EvidenceRef[];
  computedAt: string;
  computeVersion: string;
}

// §8 playbook ---------------------------------------------------------------------------

export interface PlaybookDocument {
  id: string;
  teamId: string;
  unit: Unit;
  title: string;
  assetId: string;
  pageCount: number;
  status: 'uploaded' | 'extracting' | 'extracted' | 'review' | 'failed';
  createdAt: string;
}

export interface PlaybookVersion {
  id: string;
  teamId: string;
  unit: Unit;
  seasonId: string;
  label: string;
  status: 'draft' | 'approved' | 'superseded';
  approvedBy: string | null;
  approvedAt: string | null;
  supersedes: string | null;
  createdAt: string;
}

export interface SourceRef {
  documentId: string;
  pageNumber: number;
  bbox: [number, number, number, number] | null;
  excerpt: string | null;
}

export type ConceptKind =
  | 'run'
  | 'pass'
  | 'protection'
  | 'front'
  | 'coverage'
  | 'pressure'
  | 'special_teams'
  | 'formation'
  | 'other';

export interface Concept {
  id: string;
  teamId: string;
  versionId: string;
  name: string;
  kind: ConceptKind;
  description: string;
  installed: boolean;
  sources: SourceRef[];
  status: 'proposed' | 'approved' | 'rejected';
  version: number;
}

// §9 personnel --------------------------------------------------------------------------

export interface Player {
  id: string;
  teamId: string;
  seasonId: string;
  jersey: string | null;
  firstName: string;
  lastName: string;
  positions: string[];
  classYear: string;
  status: 'active' | 'injured' | 'unavailable' | 'inactive';
  strengths: string[];
  developmentPriorities: string[];
  notes: string;
  version: number;
}

export interface DepthChart {
  id: string;
  teamId: string;
  seasonId: string;
  unit: Unit;
  slots: { position: string; order: number; playerId: string }[];
  version: number;
}

export interface PersonnelPackage {
  id: string;
  teamId: string;
  seasonId: string;
  unit: Unit;
  name: string;
  playerIds: string[];
  description: string;
  version: number;
}

// §11 weekly unit game plans ------------------------------------------------------------

export type OffenseSectionKey =
  | 'objectives'
  | 'personnel'
  | 'formations'
  | 'runs'
  | 'passes'
  | 'protections'
  | 'opening_script'
  | 'third_down'
  | 'red_zone'
  | 'short_yardage'
  | 'two_minute';
export type DefenseSectionKey =
  | 'opponent_tendencies'
  | 'fronts'
  | 'fits'
  | 'coverages'
  | 'pressures'
  | 'matchups'
  | 'third_down'
  | 'red_zone'
  | 'short_yardage'
  | 'two_minute';
export type SpecialTeamsSectionKey =
  | 'kickoff_return'
  | 'punt_protection_return'
  | 'fg_pat'
  | 'opponent_alerts'
  | 'special_situations';
export type PlanSectionKey = OffenseSectionKey | DefenseSectionKey | SpecialTeamsSectionKey;

export interface PlanItem {
  id: string;
  text: string;
  sourceRecommendationId: string | null;
  conceptIds: string[];
  packageIds: string[];
  order: number;
}

export interface PlanSection {
  key: PlanSectionKey;
  title: string;
  items: PlanItem[];
}

export type PlanVersionStatus = 'draft' | 'in_review' | 'approved' | 'superseded';

export interface GamePlanVersion {
  id: string;
  planId: string;
  number: number;
  status: PlanVersionStatus;
  basedOn: string | null;
  sections: PlanSection[];
  createdBy: string;
  createdAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  override: boolean;
  version: number;
}

export interface GamePlan {
  id: string;
  teamId: string;
  gameId: string;
  unit: Unit;
  currentVersionId: string;
  createdAt: string;
}

export interface PlanComment {
  id: string;
  versionId: string;
  sectionKey: string | null;
  itemId: string | null;
  authorUserId: string;
  body: string;
  createdAt: string;
  resolvedAt: string | null;
}

/** Section templates per unit (CONTRACTS §11). Titles are the coach-facing names. */
export const PLAN_SECTION_TEMPLATES: Record<Unit, { key: PlanSectionKey; title: string }[]> = {
  offense: [
    { key: 'objectives', title: 'Objectives' },
    { key: 'personnel', title: 'Personnel' },
    { key: 'formations', title: 'Formations' },
    { key: 'runs', title: 'Runs' },
    { key: 'passes', title: 'Passes' },
    { key: 'protections', title: 'Protections' },
    { key: 'opening_script', title: 'Opening script' },
    { key: 'third_down', title: 'Third down' },
    { key: 'red_zone', title: 'Red zone' },
    { key: 'short_yardage', title: 'Short yardage' },
    { key: 'two_minute', title: 'Two minute' },
  ],
  defense: [
    { key: 'opponent_tendencies', title: 'Opponent tendencies' },
    { key: 'fronts', title: 'Fronts' },
    { key: 'fits', title: 'Fits' },
    { key: 'coverages', title: 'Coverages' },
    { key: 'pressures', title: 'Pressures' },
    { key: 'matchups', title: 'Matchups' },
    { key: 'third_down', title: 'Third down' },
    { key: 'red_zone', title: 'Red zone' },
    { key: 'short_yardage', title: 'Short yardage' },
    { key: 'two_minute', title: 'Two minute' },
  ],
  special_teams: [
    { key: 'kickoff_return', title: 'Kickoff and kickoff return' },
    { key: 'punt_protection_return', title: 'Punt protection and return' },
    { key: 'fg_pat', title: 'Field goal and PAT' },
    { key: 'opponent_alerts', title: 'Opponent alerts' },
    { key: 'special_situations', title: 'Special situations' },
  ],
};

export const UNIT_LABELS: Record<Unit, string> = {
  offense: 'Offense',
  defense: 'Defense',
  special_teams: 'Special teams',
};

export const ROLE_LABELS: Record<Role, string> = {
  head_coach: 'Head coach',
  coordinator: 'Coordinator',
  position_coach: 'Position coach',
  analyst: 'Analyst',
  viewer: 'Viewer',
};

/** Season record (CONTRACTS §4): final games only, bye and canceled excluded. */
export function seasonRecord(games: ScheduledGame[]): { wins: number; losses: number; ties: number } {
  const record = { wins: 0, losses: 0, ties: 0 };
  for (const game of games) {
    if (game.status !== 'final' || !game.result || game.kind === 'bye') continue;
    if (game.result.outcome === 'win') record.wins += 1;
    else if (game.result.outcome === 'loss') record.losses += 1;
    else record.ties += 1;
  }
  return record;
}
