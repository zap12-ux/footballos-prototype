import type { AnalyzedUnit, EvidenceRef, Label, LabelKey, ReviewBasis } from "../types.js";

/** Segment as the statistics module needs it. The API layer maps PlaySegment + asset context. */
export interface StatSegment {
  id: string;
  gameId: string;
  /** From the asset's analyzedUnit or the coach's `unit` label; null when unknown. */
  unit: AnalyzedUnit | null;
  reviewStatus: "proposed" | "accepted" | "rejected";
  supersededBy: string[];
}

export type ExclusionReason = "unknown" | "rejected" | "unreviewed" | "superseded" | "other_unit";

export interface ResolvedValue {
  value: string | null;
  /** Set when the value cannot be used; `value` is then null. */
  excluded: ExclusionReason | null;
  evidence: EvidenceRef[];
}

/**
 * The effective value of one label under a review basis (CONTRACTS §6/§7):
 * - `corrected` / `accepted` → the coach's `accepted.value`
 * - `rejected` → excluded "rejected"
 * - `unknown` → excluded "unknown"
 * - `inferred` → under `reviewed_only` excluded "unreviewed"; under `includes_inferred` the
 *   model's `inferred.value` (abstained or null → "unknown")
 * A literal value of "unknown" is treated as unknown.
 */
export function resolveLabelValue(label: Label | undefined, basis: ReviewBasis): ResolvedValue {
  if (!label) return { value: null, excluded: "unknown", evidence: [] };
  const evidence = label.inferred?.evidence ?? [];
  switch (label.accepted.status) {
    case "corrected":
    case "accepted":
      return normalize(label.accepted.value, evidence);
    case "rejected":
      return { value: null, excluded: "rejected", evidence: [] };
    case "unknown":
      return { value: null, excluded: "unknown", evidence: [] };
    case "inferred":
      if (basis === "reviewed_only") return { value: null, excluded: "unreviewed", evidence: [] };
      if (!label.inferred || label.inferred.abstained) return { value: null, excluded: "unknown", evidence: [] };
      return normalize(label.inferred.value, evidence);
  }
}

function normalize(value: string | null, evidence: EvidenceRef[]): ResolvedValue {
  if (value === null || value.trim() === "" || value.trim().toLowerCase() === "unknown") {
    return { value: null, excluded: "unknown", evidence: [] };
  }
  return { value: value.trim(), excluded: null, evidence };
}

/** Segment-level eligibility, independent of any label. */
export function segmentExclusion(seg: StatSegment, basis: ReviewBasis, unit: AnalyzedUnit): ExclusionReason | null {
  if (seg.reviewStatus === "rejected") return "rejected";
  if (seg.supersededBy.length > 0) return "superseded";
  if (basis === "reviewed_only" && seg.reviewStatus === "proposed") return "unreviewed";
  if (seg.unit === null) return "unknown";
  if (seg.unit !== unit) return "other_unit";
  return null;
}

/** Index labels by segment then key for O(1) lookup. */
export function indexLabels(labels: Label[]): Map<string, Map<LabelKey, Label>> {
  const idx = new Map<string, Map<LabelKey, Label>>();
  for (const l of labels) {
    let m = idx.get(l.segmentId);
    if (!m) {
      m = new Map();
      idx.set(l.segmentId, m);
    }
    // Later versions win when duplicates exist.
    const prev = m.get(l.key);
    if (!prev || l.version >= prev.version) m.set(l.key, l);
  }
  return idx;
}
