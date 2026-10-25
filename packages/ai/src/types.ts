/**
 * Record types used by this package, imported from `@footballos/contracts` (owner B) from
 * Milestone B on (CONTRACTS §14.8). This file keeps only thin aliases so that Milestone A
 * call sites and the names used in docs keep working. Do not declare record shapes here;
 * a missing or divergent field is reported to the contracts owner, never patched locally.
 */

import type {
  AcceptedStatus as ContractsAcceptedStatus,
  AnalyzedUnitSchema,
  EvidenceRef as ContractsEvidenceRef,
  FindingKind as ContractsFindingKind,
  InferredLabel as ContractsInferredLabel,
  Label as ContractsLabel,
  LabelKey as ContractsLabelKey,
  LabelRevision as ContractsLabelRevision,
  ModelProvenance as ContractsModelProvenance,
  ModelProvider,
  PlaySegment as ContractsPlaySegment,
  Recommendation as ContractsRecommendation,
  ReportSnapshot as ContractsReportSnapshot,
  ReviewBasis as ContractsReviewBasis,
  ScoutingFinding as ContractsScoutingFinding,
  Uncertainty as ContractsUncertainty,
  Unit as ContractsUnit,
  UploadContext,
} from "@footballos/contracts";
import { EVIDENCE_ONLY_LABEL_KEYS, LabelKeySchema } from "@footballos/contracts";
import type { z } from "zod";

// §5 Media -------------------------------------------------------------------------------

export type AnalyzedTeam = UploadContext["analyzedTeam"];
/** `MediaAsset.context.analyzedUnit`: includes `mixed`, unlike `Unit` below. */
export type AnalyzedUnit = z.infer<typeof AnalyzedUnitSchema>;
export type Perspective = UploadContext["perspective"];
/** CONTRACTS §5 `MediaAsset.context` (the minimal upload context, asked once). */
export type AssetContext = UploadContext;

/** CONTRACTS §5 PlaySegment. */
export type PlaySegment = ContractsPlaySegment;
/** @deprecated Milestone A name; identical to `PlaySegment`. */
export type PlaySegmentRef = ContractsPlaySegment;

/** CONTRACTS §1 Unit: the unit a finding or a game plan is about (`mixed` is not a unit). */
export type Unit = ContractsUnit;

// §6 Labels ------------------------------------------------------------------------------

export type LabelKey = ContractsLabelKey;
export const LABEL_KEYS: readonly LabelKey[] = LabelKeySchema.options;

/**
 * Keys that may never be inferred "from nothing" (CONTRACTS §6 rules). A model may fill
 * them only from visible evidence (scoreboard graphic, down marker); the prompt says so
 * and the validator requires evidence on any non-null value for every key.
 */
export const EVIDENCE_ONLY_KEYS: readonly LabelKey[] = EVIDENCE_ONLY_LABEL_KEYS;

export type EvidenceRef = ContractsEvidenceRef;
export type Uncertainty = ContractsUncertainty;

/** CONTRACTS §6 `Label.inferred` (non-null form). The contracts package calls this `InferredLabel`. */
export type InferredLabelBody = ContractsInferredLabel;

/**
 * One inferred label as returned by a `VisionLabeler` and consumed by `applyInference`:
 * the key plus the `inferred` block. (Distinct from the contracts' `InferredLabel`, which is
 * the block alone; the key is needed to upsert into `Label` rows.)
 */
export interface InferredLabel {
  key: LabelKey;
  inferred: InferredLabelBody;
}

export type AcceptedStatus = ContractsAcceptedStatus;
export type Label = ContractsLabel;
export type LabelRevision = ContractsLabelRevision;

export type Provider = ModelProvider;
export type ModelProvenance = ContractsModelProvenance;

// §7 Scouting ----------------------------------------------------------------------------

export type FindingKind = ContractsFindingKind;
export type ReviewBasis = ContractsReviewBasis;
export type ScoutingFinding = ContractsScoutingFinding;
export type ReportSnapshot = ContractsReportSnapshot;

// §10 Recommendations --------------------------------------------------------------------

export type Recommendation = ContractsRecommendation;
