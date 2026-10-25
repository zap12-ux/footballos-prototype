/**
 * Grounded recommendations (CONTRACTS §10, §15.3, §15.5) and plan review flags (§15.4).
 * Record shapes come from `@footballos/contracts`; the few fields §15 adds that the contracts
 * package does not carry yet (`Player.availability`, `ReviewFlag`) are declared here with the
 * contract's wording and reported to the contracts owner in the handoff.
 */
import type { Concept, ConceptKind, DepthChart, GamePlanVersion, PersonnelPackage, Player, PlaybookVersion } from "@footballos/contracts";
import type { Recommendation, ReviewBasis, ScoutingFinding, Unit } from "../types.js";

// §15.2 availability ------------------------------------------------------------------------

export type PlayerAvailabilityStatus = "available" | "limited" | "out";

/** `Player.availability[]` (CONTRACTS §15.2): per game week of the season. */
export interface PlayerAvailability {
  week: number;
  status: PlayerAvailabilityStatus;
  note?: string | null;
}

export type PersonnelPlayer = Player & { availability?: PlayerAvailability[] | null };

// Inputs --------------------------------------------------------------------------------------

/** The scouting report as `buildScoutingReport` returns it (or the stored snapshot's findings). */
export interface RecommendationReport {
  teamId: string;
  opponentId: string;
  /** The opponent unit the findings describe (a defense plan uses the opponent *offense* report). */
  unit: Unit;
  reviewBasis: ReviewBasis;
  findings: ScoutingFinding[];
  /** Carried into the labels hash when present. */
  inputsHash?: string | null;
}

export interface RecommendationPlaybook {
  /** The approved version's id; null when the team has no approved playbook for the unit. */
  versionId: string | null;
  /** When given, anything but `approved` blocks generation. */
  status?: PlaybookVersion["status"] | null;
  /** Concepts of that version (any status); only `status:'approved' && installed` ground items. */
  concepts: Concept[];
}

export interface RecommendationPersonnel {
  players: PersonnelPlayer[];
  packages: PersonnelPackage[];
  depthChart: DepthChart | null;
  /** The game week whose availability applies; null when unknown. */
  week: number | null;
}

export interface RecommendationInputs {
  report: RecommendationReport;
  playbook: RecommendationPlaybook;
  personnel: RecommendationPersonnel;
  /** Our unit the plan is for. */
  unit: Unit;
  gameId: string;
}

export interface BuildRecommendationsOptions {
  /** Findings with a smaller denominator never become items (default 4). */
  minSample?: number;
  /** A play-type split needs at least this share to count as a tendency (default 60). */
  minTendencyPercent?: number;
  /** A formation needs at least this share of known-formation plays to be worth a call (default 25). */
  minFormationPercent?: number;
  now?: () => Date;
  newId?: () => string;
}

export type BuildRecommendationsInput = RecommendationInputs & BuildRecommendationsOptions;

// Outputs ------------------------------------------------------------------------------------

export type RecommendationType =
  | "defend_formation"
  | "defend_run_tendency"
  | "defend_pass_tendency"
  | "defend_situation_run"
  | "defend_situation_pass"
  | "defend_general"
  | "attack_defensive_look"
  | "attack_general"
  | "special_teams_look";

export interface PackageAvailability {
  packageId: string;
  name: string;
  available: boolean;
  /** Why it is unavailable, or a caution ("limited player") when available. */
  reason: string | null;
}

export interface SkippedFinding {
  findingId: string;
  reason: string;
}

export interface BuildRecommendationsResult {
  items: Recommendation[];
  /** Why nothing (or less) was produced; empty when every eligible finding grounded. */
  blockedReasons: string[];
  inputsHash: string;
  /** Per-finding account of what did not become an item (sample, no tendency, no concept kind …). */
  skipped: SkippedFinding[];
  /** Every package of the plan unit and whether it was usable for this game week. */
  packages: PackageAvailability[];
  /** The recommendation type each item was built as (parallel to `items`). */
  types: RecommendationType[];
}

// Hashes and review flags -----------------------------------------------------------------

export interface RecommendationInputHashes {
  /** sha256 over all inputs; stored on every `Recommendation.inputsHash`. */
  inputsHash: string;
  /** sha256 over finding ids and values (labels and segments behind them). */
  labelsHash: string;
  /** sha256 over the playbook version id and installed concept ids/versions. */
  playbookHash: string;
  /** sha256 over player ids/versions/availability, package ids/versions, depth chart id/version, week. */
  personnelHash: string;
}

export type ReviewFlagKind = "stale_recommendation" | "playbook_changed" | "personnel_changed" | "labels_changed";

/** CONTRACTS §15.4 `ReviewFlag`. */
export interface ReviewFlag {
  kind: ReviewFlagKind;
  message: string;
  itemId?: string;
  /** When the flagged inputs were last known to be current (ISO timestamp). */
  since: string;
}

export interface PlanReviewFlagsInput {
  version: GamePlanVersion;
  /** The recommendations the version's items reference (others are ignored). */
  recommendations: (Recommendation & { inputHashes?: Partial<RecommendationInputHashes> | null })[];
  /** Hashes of the inputs as they are now (`recommendationInputHashes(currentInputs)`). */
  currentHashes: Pick<RecommendationInputHashes, "inputsHash"> & Partial<RecommendationInputHashes>;
  /**
   * Component hashes recorded when the version was created or approved, with the time they
   * were taken. When absent, component flags fall back to the hashes stored with the
   * referenced recommendations (when B stores them); without either, only
   * `stale_recommendation` flags are produced.
   */
  baselineHashes?: (Partial<RecommendationInputHashes> & { at?: string | null }) | null;
}

export type { Concept, ConceptKind, DepthChart, GamePlanVersion, PersonnelPackage, Player, PlaybookVersion };
