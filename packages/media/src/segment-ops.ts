import { randomUUID } from 'node:crypto';
import type { PlaySegment } from './types.ts';

export interface SegmentOpContext {
  newId?: () => string;
  now?: () => Date;
  /**
   * Review status for the coach-made segments. A split or merge is a coach
   * decision, so the default is 'accepted'; pass 'proposed' if the host wants
   * an explicit confirmation step.
   */
  reviewStatus?: PlaySegment['reviewStatus'];
}

export interface SplitResult {
  /** Copy of the original with `supersededBy` filled in and version bumped. The input object is untouched. */
  original: PlaySegment;
  /** [first, second], ordered by time. */
  parts: [PlaySegment, PlaySegment];
}

export interface MergeResult {
  /** Copies of the inputs with `supersededBy` pointing at the merged segment. */
  originals: [PlaySegment, PlaySegment];
  merged: PlaySegment;
}

function ctx(c: SegmentOpContext) {
  return {
    newId: c.newId ?? randomUUID,
    nowIso: (c.now ?? (() => new Date()))().toISOString(),
    reviewStatus: c.reviewStatus ?? 'accepted',
  };
}

/** Splits `seg` at `atSec` (source seconds). Throws when the cut is outside the open interval. */
export function splitSegment(seg: PlaySegment, atSec: number, context: SegmentOpContext = {}): SplitResult {
  if (!(atSec > seg.startSec && atSec < seg.endSec)) {
    throw new RangeError(`split point ${atSec} must lie strictly inside ${seg.startSec}..${seg.endSec}`);
  }
  if (seg.supersededBy.length > 0) {
    throw new Error(`segment ${seg.id} is already superseded by ${seg.supersededBy.join(', ')}`);
  }
  const { newId, nowIso, reviewStatus } = ctx(context);
  const base = {
    teamId: seg.teamId,
    assetId: seg.assetId,
    gameId: seg.gameId,
    origin: 'coach_split' as const,
    reviewStatus,
    supersededBy: [] as string[],
    version: 1,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  const first: PlaySegment = { ...base, id: newId(), index: seg.index, startSec: seg.startSec, endSec: atSec };
  const second: PlaySegment = { ...base, id: newId(), index: seg.index + 1, startSec: atSec, endSec: seg.endSec };
  const original: PlaySegment = {
    ...seg,
    supersededBy: [...seg.supersededBy, first.id, second.id],
    version: seg.version + 1,
    updatedAt: nowIso,
  };
  return { original, parts: [first, second] };
}

/** Merges two segments of the same asset into one spanning both. Order of arguments does not matter. */
export function mergeSegments(a: PlaySegment, b: PlaySegment, context: SegmentOpContext = {}): MergeResult {
  if (a.id === b.id) throw new Error('cannot merge a segment with itself');
  if (a.assetId !== b.assetId || a.teamId !== b.teamId || a.gameId !== b.gameId) {
    throw new Error('segments must belong to the same asset, team and game');
  }
  for (const s of [a, b]) {
    if (s.supersededBy.length > 0) throw new Error(`segment ${s.id} is already superseded by ${s.supersededBy.join(', ')}`);
  }
  const [x, y] = a.startSec <= b.startSec ? [a, b] : [b, a];
  const { newId, nowIso, reviewStatus } = ctx(context);
  const merged: PlaySegment = {
    id: newId(),
    teamId: x.teamId,
    assetId: x.assetId,
    gameId: x.gameId,
    index: Math.min(x.index, y.index),
    startSec: Math.min(x.startSec, y.startSec),
    endSec: Math.max(x.endSec, y.endSec),
    origin: 'coach_merged',
    reviewStatus,
    supersededBy: [],
    version: 1,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  const supersede = (s: PlaySegment): PlaySegment => ({
    ...s,
    supersededBy: [...s.supersededBy, merged.id],
    version: s.version + 1,
    updatedAt: nowIso,
  });
  return { originals: [supersede(a), supersede(b)], merged };
}

/** Live (non-superseded) segments sorted by time with `index` renumbered 0..n-1. Returns new objects. */
export function renumber(segments: PlaySegment[], now: () => Date = () => new Date()): PlaySegment[] {
  const nowIso = now().toISOString();
  return segments
    .filter((s) => s.supersededBy.length === 0)
    .sort((p, q) => p.startSec - q.startSec || p.endSec - q.endSec)
    .map((s, index) => (s.index === index ? s : { ...s, index, updatedAt: nowIso }));
}

/** True when live segments overlap or are out of order; hosts can refuse to persist such a set. */
export function findOverlaps(segments: PlaySegment[]): Array<[string, string]> {
  const live = renumber(segments);
  const out: Array<[string, string]> = [];
  for (let i = 1; i < live.length; i++) {
    const prev = live[i - 1] as PlaySegment;
    const cur = live[i] as PlaySegment;
    if (cur.startSec < prev.endSec) out.push([prev.id, cur.id]);
  }
  return out;
}
