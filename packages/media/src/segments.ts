import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { medianFilter, motionEnergy, movingAverage, percentile, type MotionOptions, type MotionSeries } from './motion.ts';
import type { PlaySegment } from './types.ts';

export const SegmentationOptionsSchema = z.object({
  /** Median window (seconds) applied to the per-second energy to remove one-second dropouts; keeps edges. */
  medianWindowSec: z.number().int().min(1).default(3),
  /** Moving-average window (seconds) applied after the median filter. 1 = none. */
  meanWindowSec: z.number().int().min(1).default(1),
  /** Seconds added before a detected onset. */
  preRollSec: z.number().min(0).default(1),
  /** Seconds added after a detected offset. */
  postRollSec: z.number().min(0).default(1),
  /** Proposals shorter than this (before rolls) are dropped. */
  minPlaySec: z.number().positive().default(3),
  /** Proposals longer than this are kept but flagged in the confidence note (likely pan, replay or continuous motion). */
  maxPlaySec: z.number().positive().default(45),
  /** Gaps shorter than this between proposals (after rolls) are merged. */
  mergeGapSec: z.number().min(0).default(0.75),
  /** Seconds the energy must stay below the low threshold before a play is closed. */
  offsetHoldSec: z.number().int().min(1).default(1),
  /** Fixed thresholds in YDIF units; when omitted they are derived from the energy distribution. */
  highThreshold: z.number().positive().optional(),
  lowThreshold: z.number().positive().optional(),
  /** Minimum spread between quiet and busy seconds for the adaptive thresholds to be trusted. */
  minContrast: z.number().positive().default(2),
});
export type SegmentationOptions = z.input<typeof SegmentationOptionsSchema>;

export interface SegmentIdentity {
  teamId: string;
  assetId: string;
  gameId: string;
  /** Injectable for deterministic tests. */
  newId?: () => string;
  now?: () => Date;
}

export interface SegmentProposalResult {
  segments: PlaySegment[];
  /** Words, not a score. */
  confidenceNote: string;
  /** Thresholds that were used, so the UI can show "detected at …". */
  thresholds: { high: number; low: number; derived: boolean; floor: number; peak: number };
  /** Raw detections before rolls/merging, for debugging and the CLI. */
  rawRuns: Array<{ startSec: number; endSec: number }>;
  seriesLengthSec: number;
}

interface Run {
  startSec: number;
  endSec: number;
}

/** Hysteresis onset/offset detection over the smoothed per-second energy. Pure. */
export function detectRuns(energy: number[], high: number, low: number, offsetHoldSec: number): Run[] {
  const runs: Run[] = [];
  let active = false;
  let start = 0;
  let quiet = 0;
  for (let i = 0; i < energy.length; i++) {
    const e = energy[i] as number;
    if (!active) {
      if (e > high) {
        active = true;
        start = i;
        quiet = 0;
      }
    } else if (e < low) {
      quiet += 1;
      if (quiet >= offsetHoldSec) {
        runs.push({ startSec: start, endSec: i - quiet + 1 });
        active = false;
        quiet = 0;
      }
    } else {
      quiet = 0;
    }
  }
  if (active) runs.push({ startSec: start, endSec: energy.length });
  return runs;
}

export function deriveThresholds(energy: number[], opts: { highThreshold?: number; lowThreshold?: number; minContrast: number }) {
  const floor = percentile(energy, 10);
  const peak = percentile(energy, 90);
  const derived = opts.highThreshold === undefined || opts.lowThreshold === undefined;
  const high = opts.highThreshold ?? floor + 0.4 * (peak - floor);
  const low = opts.lowThreshold ?? floor + 0.2 * (peak - floor);
  return { high, low, derived, floor, peak };
}

/** Builds proposals from an existing energy series. Pure apart from id/time injection. */
export function proposeSegmentsFromSeries(
  series: Pick<MotionSeries, 'perSecond' | 'durationSec'>,
  identity: SegmentIdentity,
  options: SegmentationOptions = {},
): SegmentProposalResult {
  const o = SegmentationOptionsSchema.parse(options);
  const newId = identity.newId ?? randomUUID;
  const nowIso = (identity.now ?? (() => new Date()))().toISOString();
  const energy = movingAverage(medianFilter(series.perSecond, o.medianWindowSec), o.meanWindowSec);
  const duration = series.durationSec ?? energy.length;
  const thresholds = deriveThresholds(energy, o);
  const notes: string[] = [];

  if (energy.length === 0) {
    return { segments: [], confidenceNote: 'No frames were analysed, so no plays were proposed.', thresholds, rawRuns: [], seriesLengthSec: 0 };
  }
  const contrast = thresholds.peak - thresholds.floor;
  if (thresholds.derived && contrast < o.minContrast) {
    return {
      segments: [],
      confidenceNote:
        'Motion energy barely changes across the file, so quiet time and plays cannot be told apart; no plays were proposed. ' +
        'This happens with constant camera movement, a static test pattern, or film that is one continuous play.',
      thresholds,
      rawRuns: [],
      seriesLengthSec: energy.length,
    };
  }

  const rawRuns = detectRuns(energy, thresholds.high, thresholds.low, o.offsetHoldSec);
  const kept = rawRuns.filter((r) => r.endSec - r.startSec >= o.minPlaySec);
  const dropped = rawRuns.length - kept.length;

  // Merge detections separated by less than mergeGapSec *before* padding, so that
  // pre/post roll never fuses two distinct plays.
  const merged: Run[] = [];
  for (const r of kept) {
    const last = merged[merged.length - 1];
    if (last && r.startSec - last.endSec < o.mergeGapSec) last.endSec = Math.max(last.endSec, r.endSec);
    else merged.push({ ...r });
  }
  const mergedCount = kept.length - merged.length;

  // Pad, then resolve any overlap created by padding at the midpoint of the gap.
  const padded: Run[] = merged.map((r) => ({
    startSec: Math.max(0, r.startSec - o.preRollSec),
    endSec: Math.min(duration, r.endSec + o.postRollSec),
  }));
  for (let i = 1; i < padded.length; i++) {
    const prev = padded[i - 1] as Run;
    const cur = padded[i] as Run;
    if (cur.startSec < prev.endSec) {
      const mid = ((merged[i - 1] as Run).endSec + (merged[i] as Run).startSec) / 2;
      prev.endSec = mid;
      cur.startSec = mid;
    }
  }

  const segments: PlaySegment[] = padded.map((r, index) => ({
    id: newId(),
    teamId: identity.teamId,
    assetId: identity.assetId,
    gameId: identity.gameId,
    index,
    startSec: round3(r.startSec),
    endSec: round3(r.endSec),
    origin: 'proposed',
    reviewStatus: 'proposed',
    supersededBy: [],
    version: 1,
    createdAt: nowIso,
    updatedAt: nowIso,
  }));

  const long = segments.filter((s) => s.endSec - s.startSec > o.maxPlaySec).length;
  const activeFraction = segments.reduce((a, s) => a + (s.endSec - s.startSec), 0) / Math.max(1, duration);
  const ratio = thresholds.floor > 0 ? thresholds.peak / thresholds.floor : Number.POSITIVE_INFINITY;

  if (ratio >= 4) notes.push('Busy and quiet stretches are clearly separated in motion energy.');
  else if (ratio >= 2) notes.push('Busy and quiet stretches are only moderately separated; expect some boundaries to need adjustment.');
  else notes.push('Busy and quiet stretches are weakly separated; treat these boundaries as rough guesses.');
  if (!thresholds.derived) notes.push('Fixed thresholds were supplied rather than derived from this file.');
  if (long > 0) notes.push(`${long} proposal${long === 1 ? ' is' : 's are'} longer than ${o.maxPlaySec} s, which usually means a camera pan, a replay or continuous activity rather than one play.`);
  if (activeFraction > 0.6) notes.push('More than 60% of the file is marked as plays, which is unusual for game film; the camera may be moving or the file may be a highlight cut.');
  if (dropped > 0) notes.push(`${dropped} short burst${dropped === 1 ? '' : 's'} of motion under ${o.minPlaySec} s ${dropped === 1 ? 'was' : 'were'} ignored.`);
  if (mergedCount > 0) notes.push(`${mergedCount} near-adjacent detection${mergedCount === 1 ? ' was' : 's were'} merged.`);
  if (segments.length === 0) notes.push('No sustained motion was found above the derived threshold.');
  notes.push('Boundaries come from whole-frame motion only; they do not know about snaps, whistles, scoreboard overlays or replays.');

  return { segments, confidenceNote: notes.join(' '), thresholds, rawRuns, seriesLengthSec: energy.length };
}

/**
 * Proposes play boundaries for fixed-camera coaching film. Runs one ffmpeg
 * decode pass (see `motionEnergy`) and then the pure detector above. All times
 * are seconds from the start of the original file.
 */
export async function proposeSegments(
  src: string,
  identity: SegmentIdentity,
  options: SegmentationOptions & MotionOptions = {},
): Promise<SegmentProposalResult & { series: MotionSeries }> {
  const { sampleFps, analysisWidth, fromSec, toSec, signal, onProgress, sourceProbe, ...segOpts } = options;
  const series = await motionEnergy(src, { sampleFps, analysisWidth, fromSec, toSec, signal, onProgress, sourceProbe });
  const result = proposeSegmentsFromSeries(series, identity, segOpts);
  return { ...result, series };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
