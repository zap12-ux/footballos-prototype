import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runFfmpeg } from './ffmpeg.ts';
import { probe, type ProbeResult } from './probe.ts';

/** One analysed frame. Times are source seconds (first frame = 0). */
export interface MotionSample {
  atSec: number;
  /** Mean absolute luma difference to the previous analysed frame (signalstats YDIF, 0..255). */
  ydif: number;
  /** Mean luma (signalstats YAVG, 0..255). Near 0 means a black frame. */
  yavg: number;
}

export interface MotionSeries {
  sampleFps: number;
  analysisWidth: number;
  samples: MotionSample[];
  /** Mean YDIF per whole second of source time, index = second. Empty seconds are 0. */
  perSecond: number[];
  /** Mean YAVG per whole second, used to recognise black gaps. */
  perSecondLuma: number[];
  durationSec: number | null;
}

export interface MotionOptions {
  /** Analysed frames per second. 4 is plenty for play boundaries. */
  sampleFps?: number;
  /** Frames are downscaled to this width before statistics; keeps a 3-hour game to minutes. */
  analysisWidth?: number;
  /** Analyse only this window of source time. */
  fromSec?: number;
  toSec?: number;
  signal?: AbortSignal;
  onProgress?: (p: { doneSec: number; totalSec: number | null; fraction: number | null }) => void;
  sourceProbe?: ProbeResult;
}

/** Escapes a value for use inside an ffmpeg filter graph option. */
export function escapeFilterArg(v: string): string {
  return v.replace(/[\\':,;\[\]]/g, (c) => `\\${c}`);
}

/** Parses `metadata=print` output into samples; tolerant of extra keys. */
export function parseMetadataPrint(text: string, keys: string[]): Array<{ ptsTime: number; values: Record<string, number> }> {
  const out: Array<{ ptsTime: number; values: Record<string, number> }> = [];
  let current: { ptsTime: number; values: Record<string, number> } | null = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('frame:')) {
      const m = /pts_time:(-?[\d.]+)/.exec(line);
      current = { ptsTime: m ? Number.parseFloat(m[1] as string) : Number.NaN, values: {} };
      out.push(current);
      continue;
    }
    if (!current) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq);
    for (const k of keys) {
      if (key === k || key.endsWith(`.${k}`)) {
        const n = Number.parseFloat(line.slice(eq + 1));
        if (Number.isFinite(n)) current.values[k] = n;
      }
    }
  }
  return out.filter((f) => Number.isFinite(f.ptsTime));
}

function progressFromFfmpeg(totalSec: number | null, onProgress?: MotionOptions['onProgress']) {
  let buf = '';
  return (chunk: string) => {
    if (!onProgress) return;
    buf += chunk;
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line.startsWith('out_time_us=')) {
        const us = Number.parseInt(line.slice(12), 10);
        if (Number.isFinite(us) && us >= 0) {
          const doneSec = us / 1e6;
          onProgress({ doneSec, totalSec, fraction: totalSec ? Math.min(doneSec / totalSec, 1) : null });
        }
      }
    }
  };
}

/**
 * Per-frame motion energy from ffmpeg `signalstats` (YDIF = mean |Y_t - Y_{t-1}|),
 * computed on downscaled frames at a low sample rate. One decode pass; the
 * expensive part for a full game is H.264 decoding, not the statistics.
 */
export async function motionEnergy(src: string, options: MotionOptions = {}): Promise<MotionSeries> {
  const sampleFps = options.sampleFps ?? 4;
  const analysisWidth = options.analysisWidth ?? 160;
  const source = options.sourceProbe ?? (await probe(src, { signal: options.signal }));
  const dir = await mkdtemp(join(tmpdir(), 'footballos-motion-'));
  const metaFile = join(dir, 'meta.txt');
  try {
    const inputArgs: string[] = [];
    if (options.fromSec !== undefined) inputArgs.push('-ss', options.fromSec.toFixed(3));
    if (options.toSec !== undefined) inputArgs.push('-to', options.toSec.toFixed(3));
    const from = options.fromSec ?? 0;
    const to = options.toSec ?? source.durationSec;
    const totalSec = to !== null ? Math.max(0, to - from) : null;
    await runFfmpeg(
      [
        '-v', 'error', '-progress', 'pipe:1',
        ...inputArgs,
        '-i', src,
        '-map', '0:v:0',
        '-vf',
        `fps=${sampleFps},scale=${analysisWidth}:-2,signalstats,metadata=print:file=${escapeFilterArg(metaFile)}`,
        '-an', '-f', 'null', '-',
      ],
      { signal: options.signal, onStdout: progressFromFfmpeg(totalSec, options.onProgress) },
    );
    const text = await readFile(metaFile, 'utf8');
    const frames = parseMetadataPrint(text, ['YDIF', 'YAVG']);
    const samples: MotionSample[] = frames
      .map((f) => ({ atSec: Math.round(f.ptsTime * 1000) / 1000 + from, ydif: f.values['YDIF'] ?? 0, yavg: f.values['YAVG'] ?? 0 }))
      .sort((a, b) => a.atSec - b.atSec);
    const { perSecond, perSecondLuma } = bucketPerSecond(samples, source.durationSec);
    return { sampleFps, analysisWidth, samples, perSecond, perSecondLuma, durationSec: source.durationSec };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function bucketPerSecond(samples: MotionSample[], durationSec: number | null): { perSecond: number[]; perSecondLuma: number[] } {
  const last = samples.length > 0 ? (samples[samples.length - 1] as MotionSample).atSec : 0;
  const n = Math.max(Math.ceil(durationSec ?? 0), Math.floor(last) + 1);
  const sum = new Array<number>(n).fill(0);
  const lum = new Array<number>(n).fill(0);
  const cnt = new Array<number>(n).fill(0);
  for (const s of samples) {
    const i = Math.min(Math.floor(s.atSec), n - 1);
    if (i < 0) continue;
    sum[i] = (sum[i] ?? 0) + s.ydif;
    lum[i] = (lum[i] ?? 0) + s.yavg;
    cnt[i] = (cnt[i] ?? 0) + 1;
  }
  return {
    perSecond: sum.map((v, i) => ((cnt[i] ?? 0) > 0 ? v / (cnt[i] as number) : 0)),
    perSecondLuma: lum.map((v, i) => ((cnt[i] ?? 0) > 0 ? v / (cnt[i] as number) : 0)),
  };
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[idx] as number;
}

export function medianFilter(values: number[], window: number): number[] {
  if (window <= 1 || values.length === 0) return [...values];
  const half = Math.floor(window / 2);
  return values.map((_, i) => {
    const lo = Math.max(0, i - half);
    const hi = Math.min(values.length - 1, i + half);
    return percentile(values.slice(lo, hi + 1), 50);
  });
}

export function movingAverage(values: number[], window: number): number[] {
  if (window <= 1 || values.length === 0) return [...values];
  const half = Math.floor(window / 2);
  return values.map((_, i) => {
    const lo = Math.max(0, i - half);
    const hi = Math.min(values.length - 1, i + half);
    let s = 0;
    for (let j = lo; j <= hi; j++) s += values[j] as number;
    return s / (hi - lo + 1);
  });
}
