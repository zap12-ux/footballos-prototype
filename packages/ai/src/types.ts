/**
 * Structural types mirroring docs/team/CONTRACTS.md §5–§7 and §10.
 *
 * `@footballos/contracts` (owned by B) has not landed yet. These declarations use the
 * same field names so that they can be replaced by imports from the contracts package
 * without changing call sites. Do not add fields here that are not in CONTRACTS.md.
 */

export type AnalyzedTeam = "us" | "opponent";
export type AnalyzedUnit = "offense" | "defense" | "special_teams" | "mixed";
export type Perspective = "sideline_fixed" | "endzone" | "broadcast" | "other";

/** CONTRACTS §5 MediaAsset.context (the minimal upload context, asked once). */
export interface AssetContext {
  analyzedTeam: AnalyzedTeam;
  analyzedUnit: AnalyzedUnit;
  perspective: Perspective;
  /** Coach-provided text such as "white jerseys, gold helmets". Untrusted data. */
  teamCues: string | null;
}

/** CONTRACTS §5 PlaySegment (subset used by this package). */
export interface PlaySegmentRef {
  id: string;
  teamId: string;
  assetId: string;
  gameId: string;
  index: number;
  startSec: number;
  endSec: number;
  origin: "proposed" | "coach_split" | "coach_merged" | "coach_created";
  reviewStatus: "proposed" | "accepted" | "rejected";
  supersededBy: string[];
  version: number;
}

/** CONTRACTS §6 LabelKey. */
export type LabelKey =
  | "unit"
  | "play_type"
  | "formation_family"
  | "alignment"
  | "personnel_estimate"
  | "situation_down"
  | "situation_distance"
  | "situation_field_position"
  | "hash"
  | "motion"
  | "result_visible"
  | "special_teams_type";

export const LABEL_KEYS: readonly LabelKey[] = [
  "unit",
  "play_type",
  "formation_family",
  "alignment",
  "personnel_estimate",
  "situation_down",
  "situation_distance",
  "situation_field_position",
  "hash",
  "motion",
  "result_visible",
  "special_teams_type",
];

/**
 * Keys that may never be inferred "from nothing" (CONTRACTS §6 rules). A model may fill
 * them only from visible evidence (scoreboard graphic, down marker); the prompt says so
 * and the validator requires evidence on any non-null value for every key.
 */
export const EVIDENCE_ONLY_KEYS: readonly LabelKey[] = [
  "situation_down",
  "situation_distance",
  "situation_field_position",
];

/** CONTRACTS §6 EvidenceRef. */
export interface EvidenceRef {
  assetId: string;
  atSec: number;
  toSec: number | null;
  frameIndex: number | null;
  note: string | null;
}

export type Uncertainty = "low" | "medium" | "high";

/** CONTRACTS §6 Label.inferred (non-null form). */
export interface InferredLabelBody {
  value: string | null;
  abstained: boolean;
  rationale: string;
  evidence: EvidenceRef[];
  uncertainty: Uncertainty | null;
}

/** One inferred label as returned by a VisionLabeler: key plus the `inferred` block. */
export interface InferredLabel {
  key: LabelKey;
  inferred: InferredLabelBody;
}

export type AcceptedStatus = "inferred" | "accepted" | "corrected" | "unknown" | "rejected";

/** CONTRACTS §6 Label. */
export interface Label {
  id: string;
  teamId: string;
  segmentId: string;
  key: LabelKey;
  inferred: InferredLabelBody | null;
  accepted: {
    value: string | null;
    status: AcceptedStatus;
    byUserId: string | null;
    at: string | null;
  };
  provenanceId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type Provider = "anthropic" | "openai" | "open_source" | "none";

/** CONTRACTS §6 ModelProvenance. */
export interface ModelProvenance {
  id: string;
  provider: Provider;
  model: string;
  modelRevision: string | null;
  promptId: string;
  promptHash: string;
  preprocessing: {
    samplingFps: number | null;
    frameCount: number;
    clipSec: number | null;
    resolution: string;
  };
  /** Exactly what the model saw. */
  inspected: { fromSec: number; toSec: number; frameTimestampsSec: number[] };
  analysisVersion: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  latencyMs: number;
  requestedAt: string;
  completedAt: string;
}

export type FindingKind =
  | "formation_frequency"
  | "play_type_by_formation"
  | "tendency_by_situation"
  | "strength"
  | "weakness"
  | "uncertain";

export type ReviewBasis = "reviewed_only" | "includes_inferred";

/** CONTRACTS §7 ScoutingFinding. */
export interface ScoutingFinding {
  id: string;
  teamId: string;
  opponentId: string;
  gameIds: string[];
  unit: AnalyzedUnit;
  kind: FindingKind;
  statement: string;
  numerator: number;
  denominator: number;
  percent: number | null;
  sampleSize: number;
  includedSegmentIds: string[];
  excludedSegmentIds: string[];
  excludedReason: Record<string, string>;
  reviewBasis: ReviewBasis;
  supportingEvidence: EvidenceRef[];
  contraryEvidence: EvidenceRef[];
  computedAt: string;
  computeVersion: string;
}

/** CONTRACTS §10 Recommendation (declared for completeness; not produced by this package yet). */
export interface Recommendation {
  id: string;
  teamId: string;
  gameId: string;
  unit: AnalyzedUnit;
  statement: string;
  supportingFindings: string[];
  supportingEvidence: EvidenceRef[];
  counts: { n: number; of: number; context: string }[];
  limitations: string[];
  contraryEvidence: EvidenceRef[];
  playbookConceptIds: string[];
  personnelPackageIds: string[];
  status: "proposed" | "accepted" | "edited" | "rejected" | "deferred" | "stale";
  staleReason: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  inputsHash: string;
  createdAt: string;
  version: number;
}
