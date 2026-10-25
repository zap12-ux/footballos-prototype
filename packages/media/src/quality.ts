import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runFfmpeg } from './ffmpeg.ts';
import { escapeFilterArg, parseMetadataPrint, percentile } from './motion.ts';
import { probe, type ProbeResult } from './probe.ts';
import type { FootageQuality } from './types.ts';

export interface SampleWindow {
  fromSec: number;
  toSec: number;
}

export interface QualityFrameSample {
  atSec: number;
  /** Mean luma of the frame (0..255). */
  yavg: number;
  /** Mean |diff| to previous analysed frame (0..255). */
  ydif: number;
  /** Fraction (0..1) of a 64-px-wide frame whose luma changed by more than 16 since the previous analysed frame. */
  movingArea: number;
  /** Mean of the edge-detected frame (0..255); higher = more edges. Uncalibrated sharpness proxy. */
  edgeDensity: number;
}

export interface QualityOptions {
  /** Explicit windows to analyse; default picks `windowCount` windows spread through the file. */
  windows?: SampleWindow[];
  windowCount?: number;
  windowSec?: number;
  sampleFps?: number;
  analysisWidth?: number;
  signal?: AbortSignal;
  sourceProbe?: ProbeResult;
}

export interface QualityAssessment {
  /** Contract-shaped summary (CONTRACTS §5 FootageQuality). */
  quality: FootageQuality;
  resolutionClass: 'sd' | 'hd_720' | 'hd_1080' | 'uhd' | 'unknown';
  fpsClass: 'low' | 'standard' | 'high' | 'unknown';
  exposure: { meanLuma: number | null; class: 'dark' | 'normal' | 'bright' | 'unknown'; blackFrameFraction: number | null };
  sharpness: { edgeDensityMean: number | null; note: string };
  stability: {
    movingAreaP50: number | null;
    movingAreaP90: number | null;
    /** Share of analysed non-black frames that were almost identical to the previous one. */
    quietFrameFraction: number | null;
    estimate: 'stable' | 'unstable' | 'unknown';
  };
  windows: SampleWindow[];
  frameCount: number;
}

/** Picks `count` evenly spaced windows of `windowSec`, avoiding the first and last 2% of the file. */
export function defaultWindows(durationSec: number | null, count = 5, windowSec = 4): SampleWindow[] {
  if (durationSec === null || durationSec <= 0) return [{ fromSec: 0, toSec: windowSec }];
  if (durationSec <= windowSec * count * 1.5) return [{ fromSec: 0, toSec: durationSec }];
  const margin = durationSec * 0.02;
  const usable = durationSec - 2 * margin - windowSec;
  const out: SampleWindow[] = [];
  for (let i = 0; i < count; i++) {
    const from = margin + (count === 1 ? usable / 2 : (usable * i) / (count - 1));
    out.push({ fromSec: round3(from), toSec: round3(from + windowSec) });
  }
  return out;
}

async function sampleWindow(src: string, w: SampleWindow, sampleFps: number, width: number, signal?: AbortSignal): Promise<QualityFrameSample[]> {
  const dir = await mkdtemp(join(tmpdir(), 'footballos-quality-'));
  const f1 = join(dir, 'stats.txt');
  const f2 = join(dir, 'moving.txt');
  const f3 = join(dir, 'edges.txt');
  try {
    const graph =
      `[0:v]fps=${sampleFps},scale=${width}:-2,split=3[a][b][c];` +
      `[a]signalstats,metadata=print:file=${escapeFilterArg(f1)}[o1];` +
      `[b]scale=64:-2,tblend=all_mode=difference,lutyuv=y='if(gt(val,16),255,0)',signalstats,metadata=print:file=${escapeFilterArg(f2)}[o2];` +
      `[c]edgedetect=low=0.1:high=0.3,signalstats,metadata=print:file=${escapeFilterArg(f3)}[o3]`;
    await runFfmpeg(
      [
        '-v', 'error',
        '-ss', w.fromSec.toFixed(3), '-to', w.toSec.toFixed(3),
        '-i', src,
        '-filter_complex', graph,
        '-map', '[o1]', '-f', 'null', '-',
        '-map', '[o2]', '-f', 'null', '-',
        '-map', '[o3]', '-f', 'null', '-',
      ],
      { signal },
    );
    const stats = parseMetadataPrint(await readFile(f1, 'utf8'), ['YAVG', 'YDIF']);
    const moving = parseMetadataPrint(await readFile(f2, 'utf8'), ['YAVG']);
    const edges = parseMetadataPrint(await readFile(f3, 'utf8'), ['YAVG']);
    const n = Math.min(stats.length, moving.length, edges.length);
    const out: QualityFrameSample[] = [];
    for (let i = 0; i < n; i++) {
      const s = stats[i]!;
      out.push({
        atSec: round3(s.ptsTime + w.fromSec),
        yavg: s.values['YAVG'] ?? 0,
        ydif: s.values['YDIF'] ?? 0,
        movingArea: (moving[i]!.values['YAVG'] ?? 0) / 255,
        edgeDensity: edges[i]!.values['YAVG'] ?? 0,
      });
    }
    return out;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const BLACK_LUMA = 16;
const QUIET_MOVING_AREA = 0.02;
// Calibrated on one fixed end-zone clip (p90 0.16 mid-play) and a synthetic violently shaken copy of it (p90 0.55).
const UNSTABLE_MOVING_AREA_P90 = 0.45;

/**
 * Assesses what ffmpeg statistics can honestly say about footage, and lists
 * explicitly what they cannot. Nothing here looks at football content.
 */
export async function assessQuality(src: string, options: QualityOptions = {}): Promise<QualityAssessment> {
  const source = options.sourceProbe ?? (await probe(src, { signal: options.signal }));
  const windows = options.windows ?? defaultWindows(source.durationSec, options.windowCount ?? 5, options.windowSec ?? 4);
  const sampleFps = options.sampleFps ?? 4;
  const width = options.analysisWidth ?? 320;
  const samples: QualityFrameSample[] = [];
  for (const w of windows) {
    samples.push(...(await sampleWindow(src, w, sampleFps, width, options.signal)));
  }
  return interpretQuality(source, samples, windows);
}

/** Pure interpretation step, exported for unit tests with hand-built samples. */
export function interpretQuality(source: ProbeResult, samples: QualityFrameSample[], windows: SampleWindow[]): QualityAssessment {
  const notes: string[] = [];
  const unevaluable: string[] = [
    'line of scrimmage visibility',
    'whether all 22 players are in frame',
    'camera perspective (sideline, end zone, broadcast)',
    'scoreboard or down-marker legibility',
    'presence of replays, cuts or graphics overlays',
    'focus and blur beyond an uncalibrated edge-density number',
    'whether the camera follows the play (slow pans over a uniform field are not reliably detected)',
  ];

  const h = source.height;
  const resolutionClass: QualityAssessment['resolutionClass'] =
    h === null ? 'unknown' : h >= 2000 ? 'uhd' : h >= 1000 ? 'hd_1080' : h >= 700 ? 'hd_720' : 'sd';
  const fpsClass: QualityAssessment['fpsClass'] =
    source.fps === null ? 'unknown' : source.fps < 24 ? 'low' : source.fps < 50 ? 'standard' : 'high';
  if (source.width !== null && source.height !== null) notes.push(`Resolution ${source.width}x${source.height} (${resolutionClass.replace('_', ' ')}).`);
  if (source.fps !== null) notes.push(`Frame rate ${source.fps.toFixed(2)} fps (${fpsClass}).`);
  if (resolutionClass === 'sd') notes.push('Below 720p; jersey numbers and alignment details will be hard to read.');
  if (fpsClass === 'low') notes.push('Below 24 fps; fast motion will look choppy and motion-based play detection is less reliable.');

  // Drop the first frame of each window: tblend/YDIF compare against nothing there.
  const usable = samples.filter((s, i) => i > 0 && !(windows.some((w) => Math.abs(s.atSec - w.fromSec) < 1e-6)));
  const nonBlack = usable.filter((s) => s.yavg > BLACK_LUMA);
  const blackFraction = samples.length > 0 ? (samples.length - samples.filter((s) => s.yavg > BLACK_LUMA).length) / samples.length : null;

  let exposureClass: QualityAssessment['exposure']['class'] = 'unknown';
  let meanLuma: number | null = null;
  if (nonBlack.length > 0) {
    meanLuma = nonBlack.reduce((a, s) => a + s.yavg, 0) / nonBlack.length;
    exposureClass = meanLuma < 50 ? 'dark' : meanLuma > 200 ? 'bright' : 'normal';
    if (exposureClass === 'dark') notes.push('Sampled frames are dark on average (night game or underexposed).');
    if (exposureClass === 'bright') notes.push('Sampled frames are very bright on average; highlights may be clipped.');
  } else {
    notes.push('All sampled frames were black; exposure and stability were not assessed.');
  }
  if (blackFraction !== null && blackFraction > 0.2 && nonBlack.length > 0) {
    notes.push(`${Math.round(blackFraction * 100)}% of sampled frames are black (gaps, fades or a late start).`);
  }

  const edgeDensityMean = nonBlack.length > 0 ? nonBlack.reduce((a, s) => a + s.edgeDensity, 0) / nonBlack.length : null;
  const sharpnessNote =
    edgeDensityMean === null
      ? 'No non-black frames to measure.'
      : 'Mean edge density of sampled frames; higher means more fine detail. No calibrated blur threshold exists yet, so this is a number to compare between uploads, not a verdict.';

  let stable: boolean | null = null;
  let estimate: QualityAssessment['stability']['estimate'] = 'unknown';
  let p50: number | null = null;
  let p90: number | null = null;
  let quietFraction: number | null = null;
  if (nonBlack.length >= 8) {
    const areas = nonBlack.map((s) => s.movingArea);
    p50 = percentile(areas, 50);
    p90 = percentile(areas, 90);
    quietFraction = areas.filter((a) => a < QUIET_MOVING_AREA).length / areas.length;
    if (p90 > UNSTABLE_MOVING_AREA_P90) {
      stable = false;
      estimate = 'unstable';
      notes.push('Most of the frame changes between nearly every sampled frame; the camera is likely moving or shaking.');
    } else if (quietFraction >= 0.15) {
      stable = true;
      estimate = 'stable';
      notes.push('There are stretches where almost nothing in the frame changes, which is what a fixed camera looks like between plays.');
    } else {
      notes.push('Camera stability could not be judged: every sampled stretch contains motion, and whole-frame statistics cannot separate player motion from a slow pan.');
    }
  } else {
    notes.push('Too few sampled frames to judge camera stability.');
  }
  if (stable === null) unevaluable.push('camera stability (no quiet stretch was sampled)');

  return {
    quality: { stable, lineOfScrimmageVisible: null, allTwentyTwoVisible: null, notes, unevaluable },
    resolutionClass,
    fpsClass,
    exposure: { meanLuma: meanLuma === null ? null : round3(meanLuma), class: exposureClass, blackFrameFraction: blackFraction === null ? null : round3(blackFraction) },
    sharpness: { edgeDensityMean: edgeDensityMean === null ? null : round3(edgeDensityMean), note: sharpnessNote },
    stability: { movingAreaP50: p50 === null ? null : round3(p50), movingAreaP90: p90 === null ? null : round3(p90), quietFrameFraction: quietFraction === null ? null : round3(quietFraction), estimate },
    windows,
    frameCount: samples.length,
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
