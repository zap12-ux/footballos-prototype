/**
 * Pure helpers for the asset view: label filters, the §14.5 bulk-accept rule, segment
 * adjacency and thumbnail-tile arithmetic. No React, no I/O, so each is unit-tested directly.
 */
import type { AcceptedStatus, Label, LabelKey, PlaySegment } from '../api/contracts';
import type { ProxyInfo } from '../api/api';

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

// Evidence seeks (iteration 1: HC-05, OC-02, PC-01) ------------------------------------------------

function mmss(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** The play whose range contains `sec`, if any. */
export function segmentAt(segments: PlaySegment[], sec: number): PlaySegment | null {
  return segments.find((s) => sec >= s.startSec && sec <= s.endSec) ?? null;
}

export type SeekPlan =
  /** The stream is the real proxy: seek straight to the requested time. */
  | { kind: 'direct'; requestedSec: number; mediaSec: number; segment: PlaySegment | null; message: null }
  /** A stand-in clip: the cited play is mapped onto it and the player says so. */
  | { kind: 'stand_in'; requestedSec: number; mediaSec: number; segment: PlaySegment; message: string }
  /** Nothing playable shows this moment: do not seek, say so at the control and the player. */
  | { kind: 'unavailable'; requestedSec: number; mediaSec: null; segment: PlaySegment | null; message: string };

/**
 * Where a request for `requestedSec` (seconds in the original upload) lands on the stream a
 * grant serves. Never seeks silently to footage that cannot show the cited moment: a real
 * proxy shorter than the request, or a stand-in clip with no play covering the time, yields
 * `unavailable` with a sentence for the coach.
 */
export function planSeek(requestedSec: number, segments: PlaySegment[], proxy: ProxyInfo | null | undefined): SeekPlan {
  const segment = segmentAt(segments, requestedSec);
  const at = mmss(requestedSec);
  if (!proxy?.standIn) {
    if (proxy && proxy.durationSec !== null && requestedSec > proxy.durationSec + 0.5) {
      return { kind: 'unavailable', requestedSec, mediaSec: null, segment, message: `Footage for ${at} is not in this proxy: the file ends at ${mmss(proxy.durationSec)}.` };
    }
    return { kind: 'direct', requestedSec, mediaSec: Math.max(0, requestedSec), segment, message: null };
  }
  if (!segment) {
    return { kind: 'unavailable', requestedSec, mediaSec: null, segment: null, message: `Footage for ${at} is not in this proxy: no play on this film covers that moment, and the demo clip stands in for plays only.` };
  }
  const clip = proxy.durationSec !== null && proxy.durationSec > 0 ? proxy.durationSec : null;
  // Clip position = seconds into the cited play, so the playhead reads play start + clip time.
  // A clip shorter than the play stops short of the play's last moments; the caption says it stands in.
  const offset = Math.max(0, requestedSec - segment.startSec);
  const mediaSec = clip === null ? offset : Math.min(offset, Math.max(0, clip - 0.25));
  return {
    kind: 'stand_in',
    requestedSec,
    mediaSec: Math.round(mediaSec * 10) / 10,
    segment,
    message: `Demo proxy: stand-in footage for ${at} (play ${segment.index}, ${mmss(segment.startSec)}–${mmss(segment.endSec)}). The credited clip is not this snap; the playhead stands for where the cited moment falls in the play.`,
  };
}

/** Original-file time for a stand-in clip position, given the play the clip currently stands for. */
export function standInToOriginal(mediaSec: number, segment: PlaySegment): number {
  return Math.round((segment.startSec + Math.max(0, mediaSec)) * 10) / 10;
}
