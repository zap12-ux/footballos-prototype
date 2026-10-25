import { describe, expect, it } from 'vitest';
import { bucketPerSecond, medianFilter, movingAverage, parseMetadataPrint, percentile } from '../motion.ts';
import { mergeSegments, renumber, splitSegment, findOverlaps } from '../segment-ops.ts';
import { detectRuns, proposeSegments, proposeSegmentsFromSeries } from '../segments.ts';
import type { PlaySegment } from '../types.ts';
import { CLIPS, readManifest, SYNTHETIC_PATH } from './fixtures.ts';

const identity = { teamId: 'team-demo', assetId: 'asset-1', gameId: 'game-1', now: () => new Date('2026-10-25T12:00:00.000Z') };

describe('motion helpers (pure)', () => {
  it('parses metadata=print output', () => {
    const text = ['frame:0    pts:0       pts_time:0', 'lavfi.signalstats.YAVG=10.5', 'lavfi.signalstats.YDIF=0', 'frame:1    pts:1       pts_time:0.25', 'lavfi.signalstats.YDIF=8.25', 'lavfi.signalstats.YAVG=11'].join('\n');
    const frames = parseMetadataPrint(text, ['YDIF', 'YAVG']);
    expect(frames).toEqual([
      { ptsTime: 0, values: { YAVG: 10.5, YDIF: 0 } },
      { ptsTime: 0.25, values: { YDIF: 8.25, YAVG: 11 } },
    ]);
  });
  it('buckets samples per second', () => {
    const { perSecond } = bucketPerSecond(
      [
        { atSec: 0, ydif: 2, yavg: 50 },
        { atSec: 0.5, ydif: 4, yavg: 50 },
        { atSec: 1.25, ydif: 10, yavg: 50 },
      ],
      3,
    );
    expect(perSecond).toEqual([3, 10, 0]);
  });
  it('median filter removes one-second dropouts but keeps edges', () => {
    expect(medianFilter([10, 10, 0, 10, 10, 0, 0, 0, 10, 10], 3)).toEqual([10, 10, 10, 10, 10, 0, 0, 0, 10, 10]);
    expect(movingAverage([0, 3, 6], 3)).toEqual([1.5, 3, 4.5]);
    expect(percentile([5, 1, 9, 3], 50)).toBe(5);
  });
  it('detects runs with hysteresis and offset hold', () => {
    const e = [0, 0, 8, 9, 7, 1, 0, 0, 9, 9, 9, 2, 9, 0, 0];
    expect(detectRuns(e, 5, 3, 1)).toEqual([
      { startSec: 2, endSec: 5 },
      { startSec: 8, endSec: 13 },
    ]);
    expect(detectRuns([0, 9, 9], 5, 3, 1)).toEqual([{ startSec: 1, endSec: 3 }]);
  });
});

describe('proposeSegmentsFromSeries (pure)', () => {
  it('finds the plays in a synthetic series, padded and non-overlapping', () => {
    const perSecond = [0, 0, 0, 12, 10, 11, 9, 10, 0, 0, 0, 0, 11, 12, 10, 9, 0, 0, 0, 0, 0, 10, 10, 11, 12, 10, 0, 0];
    const r = proposeSegmentsFromSeries({ perSecond, durationSec: 28 }, identity, { preRollSec: 1, postRollSec: 1 });
    expect(r.segments.map((s) => [s.startSec, s.endSec])).toEqual([
      [2, 9],
      [11, 17],
      [20, 27],
    ]);
    expect(r.segments.every((s) => s.origin === 'proposed' && s.reviewStatus === 'proposed' && s.supersededBy.length === 0)).toBe(true);
    expect(r.segments.map((s) => s.index)).toEqual([0, 1, 2]);
    expect(r.confidenceNote).toMatch(/clearly separated/);
    expect(findOverlaps(r.segments)).toEqual([]);
  });
  it('drops short bursts and merges near gaps before padding', () => {
    const perSecond = [0, 0, 12, 0, 0, 0, 0, 10, 10, 10, 10, 0, 10, 10, 10, 10, 0, 0, 0, 0];
    const r = proposeSegmentsFromSeries({ perSecond, durationSec: 20 }, identity, { minPlaySec: 3, mergeGapSec: 1.5, medianWindowSec: 1 });
    expect(r.segments).toHaveLength(1);
    expect(r.segments[0]).toMatchObject({ startSec: 6, endSec: 17 });
    expect(r.confidenceNote).toMatch(/1 short burst of motion under 3 s was ignored/);
    expect(r.confidenceNote).toMatch(/1 near-adjacent detection was merged/);
  });
  it('splits the gap when padding would overlap two distinct plays', () => {
    const perSecond = [0, 0, 10, 10, 10, 10, 0, 10, 10, 10, 10, 0, 0];
    const r = proposeSegmentsFromSeries({ perSecond, durationSec: 13 }, identity, { preRollSec: 1.5, postRollSec: 1.5, mergeGapSec: 0.5, medianWindowSec: 1 });
    expect(r.segments).toHaveLength(2);
    expect(r.segments[0]?.endSec).toBe(6.5);
    expect(r.segments[1]?.startSec).toBe(6.5);
  });
  it('refuses to guess when energy is flat', () => {
    const r = proposeSegmentsFromSeries({ perSecond: new Array<number>(60).fill(7), durationSec: 60 }, identity);
    expect(r.segments).toEqual([]);
    expect(r.confidenceNote).toMatch(/cannot be told apart/);
  });
  it('flags over-long proposals and high active fraction', () => {
    const perSecond = [0, 0, ...new Array<number>(60).fill(10), 0, 0];
    const r = proposeSegmentsFromSeries({ perSecond, durationSec: 64 }, identity, { maxPlaySec: 45 });
    expect(r.segments).toHaveLength(1);
    expect(r.confidenceNote).toMatch(/longer than 45 s/);
    expect(r.confidenceNote).toMatch(/More than 60%/);
  });
});

describe('proposeSegments on fixtures (ffmpeg)', () => {
  it('finds about six plays in the synthetic asset at source-mapped times', async () => {
    const m = await readManifest();
    const r = await proposeSegments(SYNTHETIC_PATH, identity);
    // Report the real count; the brief expects about six.
    process.stdout.write(`[media tests] synthetic asset: ${r.segments.length} proposed segments; note: ${r.confidenceNote}\n`);
    expect(r.segments.length).toBeGreaterThanOrEqual(5);
    expect(r.segments.length).toBeLessThanOrEqual(7);
    // Ordered and non-overlapping, in original seconds.
    for (let i = 1; i < r.segments.length; i++) {
      expect(r.segments[i]!.startSec).toBeGreaterThanOrEqual(r.segments[i - 1]!.endSec);
    }
    expect(r.segments.every((s) => s.startSec >= 0 && s.endSec <= m.totalSec + 0.01)).toBe(true);
    // Every known play is covered by exactly one proposal, within 2 s at each edge.
    for (const play of m.plays) {
      const hits = r.segments.filter((s) => s.startSec <= play.startSec + 2 && s.endSec >= play.endSec - 2);
      expect(hits, `play starting at ${play.startSec}s should be covered`).toHaveLength(1);
      const s = hits[0]!;
      expect(Math.abs(s.startSec - play.startSec)).toBeLessThanOrEqual(2);
      expect(Math.abs(s.endSec - play.endSec)).toBeLessThanOrEqual(2);
    }
    expect(r.series.sampleFps).toBe(4);
    expect(r.series.samples.length).toBeGreaterThan(m.totalSec * 3);
    expect(typeof r.confidenceNote).toBe('string');
    expect(r.confidenceNote.length).toBeGreaterThan(20);
    expect(r.confidenceNote).not.toMatch(/\b0\.\d+\b/); // words, not a score
  });

  it('on a single continuous clip either proposes one play or honestly declines', async () => {
    const r = await proposeSegments(CLIPS[0] as string, identity);
    expect(r.segments.length).toBeLessThanOrEqual(1);
    expect(r.confidenceNote.length).toBeGreaterThan(0);
  });
});

describe('split and merge (pure)', () => {
  const base: PlaySegment = {
    id: 'seg-a',
    teamId: 't',
    assetId: 'a',
    gameId: 'g',
    index: 0,
    startSec: 10,
    endSec: 20,
    origin: 'proposed',
    reviewStatus: 'proposed',
    supersededBy: [],
    version: 1,
    createdAt: '2026-10-25T00:00:00.000Z',
    updatedAt: '2026-10-25T00:00:00.000Z',
  };
  let n = 0;
  const ctx = { newId: () => `id-${++n}`, now: () => new Date('2026-10-25T13:00:00.000Z') };

  it('splitSegment returns two coach_split parts and a superseded copy; input untouched', () => {
    const frozen = Object.freeze({ ...base, supersededBy: Object.freeze([]) as unknown as string[] });
    const r = splitSegment(frozen, 14, ctx);
    expect(r.parts[0]).toMatchObject({ startSec: 10, endSec: 14, origin: 'coach_split', reviewStatus: 'accepted', index: 0, version: 1 });
    expect(r.parts[1]).toMatchObject({ startSec: 14, endSec: 20, origin: 'coach_split', index: 1 });
    expect(r.original.supersededBy).toEqual([r.parts[0].id, r.parts[1].id]);
    expect(r.original.version).toBe(2);
    expect(r.original.id).toBe('seg-a');
    expect(frozen.supersededBy).toEqual([]);
    expect(() => splitSegment(base, 10, ctx)).toThrow(RangeError);
    expect(() => splitSegment(base, 25, ctx)).toThrow(RangeError);
    expect(() => splitSegment(r.original, 12, ctx)).toThrow(/already superseded/);
  });

  it('mergeSegments spans both inputs regardless of argument order', () => {
    const b: PlaySegment = { ...base, id: 'seg-b', index: 1, startSec: 22, endSec: 30 };
    const r = mergeSegments(b, base, { ...ctx, reviewStatus: 'proposed' });
    expect(r.merged).toMatchObject({ startSec: 10, endSec: 30, origin: 'coach_merged', reviewStatus: 'proposed', index: 0 });
    expect(r.originals[0].id).toBe('seg-b');
    expect(r.originals.every((o) => o.supersededBy.includes(r.merged.id) && o.version === 2)).toBe(true);
    expect(base.supersededBy).toEqual([]);
    expect(() => mergeSegments(base, base, ctx)).toThrow();
    expect(() => mergeSegments(base, { ...b, assetId: 'other' }, ctx)).toThrow(/same asset/);
  });

  it('renumber drops superseded segments and reindexes live ones in time order', () => {
    const b: PlaySegment = { ...base, id: 'seg-b', index: 1, startSec: 22, endSec: 30 };
    const split = splitSegment(b, 25, ctx);
    const live = renumber([split.original, base, ...split.parts]);
    expect(live.map((s) => [s.id, s.index, s.startSec])).toEqual([
      ['seg-a', 0, 10],
      [split.parts[0].id, 1, 22],
      [split.parts[1].id, 2, 25],
    ]);
    expect(findOverlaps([base, { ...b, startSec: 15 }])).toEqual([['seg-a', 'seg-b']]);
  });
});
