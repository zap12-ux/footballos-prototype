/**
 * Pure helpers for the asset view: label filters, the §14.5 bulk-accept rule, segment
 * adjacency and thumbnail-tile arithmetic. No React, no I/O, so each is unit-tested directly.
 */
import type { AcceptedStatus, Label, LabelKey, PlaySegment } from '../api/contracts';

export interface LabelFilter {
  status: AcceptedStatus | 'all';
  key: LabelKey | 'all';
  abstainedOnly: boolean;
  /** Restrict to these segments (the timeline's review queue), or null for every segment. */
  segmentIds: ReadonlySet<string> | null;
}

export const DEFAULT_LABEL_FILTER: LabelFilter = { status: 'all', key: 'all', abstainedOnly: false, segmentIds: null };

export function applyLabelFilter(labels: Label[], filter: LabelFilter): Label[] {
  return labels.filter(
    (l) =>
      (filter.status === 'all' || l.accepted.status === filter.status) &&
      (filter.key === 'all' || l.key === filter.key) &&
      (!filter.abstainedOnly || l.inferred?.abstained === true) &&
      (!filter.segmentIds || filter.segmentIds.has(l.segmentId)),
  );
}

/** CONTRACTS §14.5: bulk accept changes only `accepted.status === 'inferred'` with `inferred.abstained === false`. */
export function isBulkAcceptable(label: Label): boolean {
  return label.accepted.status === 'inferred' && label.inferred !== null && label.inferred.abstained === false;
}

export interface BulkAcceptPlan {
  eligible: Label[];
  skippedAbstained: number;
  skippedReviewed: number;
  segmentIds: string[];
  keys: LabelKey[];
}

/** What a bulk accept over `labels` would do: shown in the confirmation before `POST …/bulk-accept`. */
export function planBulkAccept(labels: Label[]): BulkAcceptPlan {
  const eligible = labels.filter(isBulkAcceptable);
  const skippedAbstained = labels.filter((l) => l.accepted.status === 'inferred' && l.inferred?.abstained === true).length;
  const skippedReviewed = labels.filter((l) => l.accepted.status !== 'inferred').length;
  return {
    eligible,
    skippedAbstained,
    skippedReviewed,
    segmentIds: [...new Set(eligible.map((l) => l.segmentId))],
    keys: [...new Set(eligible.map((l) => l.key))],
  };
}

/** The segment that follows `segment` in timeline order, when the two touch (merge candidate). */
export function nextAdjacent(segments: PlaySegment[], segment: PlaySegment): PlaySegment | null {
  const ordered = [...segments].sort((a, b) => a.startSec - b.startSec);
  const i = ordered.findIndex((s) => s.id === segment.id);
  return i >= 0 && i + 1 < ordered.length ? ordered[i + 1] : null;
}

/** Thumbnail tile for a time: tiles are one per `everySec` from the start of the original file. */
export function thumbIndexFor(atSec: number, everySec: number): number {
  return Math.max(0, Math.floor(atSec / Math.max(0.001, everySec)));
}

export function thumbUrl(template: string, n: number): string {
  return template.replace('{n}', String(n)).replace('%7Bn%7D', String(n));
}

/** Word for the model's own uncertainty; never a number that was not measured. */
export function uncertaintyWord(label: Label): string {
  if (!label.inferred) return 'no model output';
  if (label.inferred.abstained) return 'abstained';
  switch (label.inferred.uncertainty) {
    case 'low':
      return 'confident';
    case 'medium':
      return 'unsure';
    case 'high':
      return 'very unsure';
    default:
      return 'uncertainty not reported';
  }
}
