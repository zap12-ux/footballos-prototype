import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { z } from 'zod';
import { runFfmpeg } from './ffmpeg.ts';
import { probe, type ProbeResult } from './probe.ts';
import { writeThumbnailSidecar } from './thumbs.ts';
import type { ProxyTimeMapping, ThumbnailSheetMapping } from './timemap.ts';

export interface ProgressInfo {
  /** Seconds of output produced so far. */
  doneSec: number;
  /** Total seconds expected, null when the source duration is unknown. */
  totalSec: number | null;
  /** 0..1 when totalSec is known. */
  fraction: number | null;
}

export const ProxyOptionsSchema = z.object({
  /** Target proxy height; the source is never upscaled. Owner default 720. */
  height: z.number().int().min(144).max(2160).default(720),
  crf: z.number().int().min(0).max(51).default(23),
  preset: z
    .enum(['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow'])
    .default('veryfast'),
  /** Keep audio when present (AAC 96k). */
  audio: z.boolean().default(true),
  /** Keyframe interval in seconds; small values make scrubbing more responsive. */
  keyframeIntervalSec: z.number().positive().default(2),
});
export type ProxyOptions = z.input<typeof ProxyOptionsSchema>;

export interface ProxyResult {
  path: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  mapping: ProxyTimeMapping;
  /** Absolute drift between source and proxy duration; large values mean timestamps may not line up. */
  durationDriftSec: number | null;
  /** Frames-per-second actually written. */
  fps: number | null;
  notes: string[];
}

interface CommonRunOpts {
  signal?: AbortSignal;
  onProgress?: (p: ProgressInfo) => void;
  /** Already-probed source, to avoid probing twice. */
  sourceProbe?: ProbeResult;
}

function progressParser(totalSec: number | null, onProgress?: (p: ProgressInfo) => void): (chunk: string) => void {
  let buffer = '';
  return (chunk: string) => {
    if (!onProgress) return;
    buffer += chunk;
    let idx: number;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line.startsWith('out_time_us=')) {
        const us = Number.parseInt(line.slice('out_time_us='.length), 10);
        if (Number.isFinite(us) && us >= 0) {
          const doneSec = us / 1_000_000;
          const fraction = totalSec && totalSec > 0 ? Math.min(doneSec / totalSec, 1) : null;
          onProgress({ doneSec, totalSec, fraction });
        }
      } else if (line === 'progress=end' && totalSec !== null) {
        onProgress({ doneSec: totalSec, totalSec, fraction: 1 });
      }
    }
  };
}

/**
 * Produces a 720p (default) H.264/AAC MP4 playback proxy. Timing: ffmpeg
 * normalises the source so its first frame is at 0, which is also what a
 * browser player shows for the original, so `proxyOffsetSec` is 0 by
 * construction; the result records the measured duration drift so the caller
 * can see whether that assumption held for this file.
 */
export async function makeProxy(src: string, out: string, options: ProxyOptions & CommonRunOpts = {}): Promise<ProxyResult> {
  const { signal, onProgress, sourceProbe, ...rest } = options;
  const opts = ProxyOptionsSchema.parse(rest);
  const source = sourceProbe ?? (await probe(src, { signal }));
  await mkdir(dirname(out), { recursive: true });

  const notes: string[] = [];
  const targetHeight = source.height !== null ? Math.min(opts.height, source.height) : opts.height;
  if (source.height !== null && source.height < opts.height) {
    notes.push(`Source height ${source.height} is below the requested ${opts.height}; proxy keeps the source height.`);
  }
  const gop = source.fps ? Math.max(1, Math.round(source.fps * opts.keyframeIntervalSec)) : 60;
  const args = [
    '-y',
    '-v', 'error',
    '-progress', 'pipe:1',
    '-i', src,
    '-map', '0:v:0',
    ...(opts.audio && source.hasAudio ? ['-map', '0:a:0?', '-c:a', 'aac', '-b:a', '96k'] : ['-an']),
    '-vf', `scale=-2:${targetHeight}`,
    '-c:v', 'libx264',
    '-preset', opts.preset,
    '-crf', String(opts.crf),
    '-pix_fmt', 'yuv420p',
    '-g', String(gop),
    '-keyint_min', String(gop),
    '-sc_threshold', '0',
    '-movflags', '+faststart',
    '-f', 'mp4',
    out,
  ];
  await runFfmpeg(args, { signal, onStdout: progressParser(source.durationSec, onProgress) });

  const produced = await probe(out, { signal });
  const drift =
    source.durationSec !== null && produced.durationSec !== null ? Math.abs(produced.durationSec - source.durationSec) : null;
  if (drift !== null && drift > 0.5) {
    notes.push(`Proxy duration differs from the source by ${drift.toFixed(2)} s; check the source for variable frame rate or edit lists.`);
  }
  return {
    path: out,
    byteSize: produced.byteSize,
    width: produced.width,
    height: produced.height,
    durationSec: produced.durationSec,
    mapping: { proxyOffsetSec: 0, sourceDurationSec: source.durationSec, proxyDurationSec: produced.durationSec },
    durationDriftSec: drift,
    fps: produced.fps,
    notes,
  };
}

export const ThumbnailSheetOptionsSchema = z.object({
  everySec: z.number().positive().default(10),
  tileWidth: z.number().int().min(32).max(1920).default(320),
  columns: z.number().int().min(1).max(50).default(10),
  /** JPEG quality for ffmpeg's mjpeg encoder (2 best .. 31 worst). */
  jpegQuality: z.number().int().min(2).max(31).default(4),
  /** Keep the individual frames next to the sheet (directory `<out>.frames/`), for /thumb/:n routes. */
  keepFrames: z.boolean().default(false),
});
export type ThumbnailSheetOptions = z.input<typeof ThumbnailSheetOptionsSchema>;

export interface ThumbnailSheetResult {
  path: string;
  byteSize: number;
  sheetWidth: number | null;
  sheetHeight: number | null;
  mapping: ThumbnailSheetMapping;
  /** Directory holding frame-00001.jpg … when keepFrames was set, else null. */
  framesDir: string | null;
  /** `<path>.json` with the tile geometry, read by `thumbTile` and friends. */
  sidecarPath: string;
}

/**
 * Two ffmpeg passes: extract one frame every `everySec` seconds as JPEGs
 * (so the count is exact), then tile them into a single sheet. Thumbnail n
 * shows source time `n * everySec` (the fps filter samples at multiples of
 * the period from the first frame).
 */
export async function makeThumbnailSheet(
  src: string,
  out: string,
  options: ThumbnailSheetOptions & CommonRunOpts = {},
): Promise<ThumbnailSheetResult> {
  const { signal, onProgress, sourceProbe, ...rest } = options;
  const opts = ThumbnailSheetOptionsSchema.parse(rest);
  const source = sourceProbe ?? (await probe(src, { signal }));
  await mkdir(dirname(out), { recursive: true });
  const framesDir = opts.keepFrames ? `${out}.frames` : await mkdtemp(join(tmpdir(), 'footballos-thumbs-'));
  await mkdir(framesDir, { recursive: true });
  try {
    await runFfmpeg(
      [
        '-y', '-v', 'error', '-progress', 'pipe:1',
        '-i', src,
        '-map', '0:v:0',
        '-vf', `fps=1/${opts.everySec},scale=${opts.tileWidth}:-2`,
        '-q:v', String(opts.jpegQuality),
        '-f', 'image2',
        join(framesDir, 'frame-%05d.jpg'),
      ],
      { signal, onStdout: progressParser(source.durationSec, onProgress) },
    );
    const frames = (await readdir(framesDir)).filter((f) => /^frame-\d+\.jpg$/.test(f)).sort();
    const count = frames.length;
    if (count === 0) throw new Error(`no thumbnails could be extracted from ${basename(src)}`);
    const first = await probe(join(framesDir, frames[0] as string), { signal });
    const tileWidth = first.width ?? opts.tileWidth;
    const tileHeight = first.height ?? Math.round((opts.tileWidth * 9) / 16);
    const columns = Math.min(opts.columns, count);
    const rows = Math.ceil(count / columns);
    await runFfmpeg(
      [
        '-y', '-v', 'error',
        '-framerate', '1',
        '-i', join(framesDir, 'frame-%05d.jpg'),
        '-vf', `tile=${columns}x${rows}`,
        '-frames:v', '1',
        '-q:v', String(opts.jpegQuality),
        '-f', 'image2',
        out,
      ],
      { signal },
    );
    const sheet = await probe(out, { signal });
    const mapping: ThumbnailSheetMapping = { everySec: opts.everySec, firstAtSec: 0, count, columns, rows, tileWidth, tileHeight };
    const keptFrames = opts.keepFrames ? framesDir : null;
    const sidecarPath = await writeThumbnailSidecar(out, { mapping, sheetWidth: sheet.width, sheetHeight: sheet.height, framesDir: keptFrames });
    return {
      path: out,
      byteSize: sheet.byteSize,
      sheetWidth: sheet.width,
      sheetHeight: sheet.height,
      mapping,
      framesDir: keptFrames,
      sidecarPath,
    };
  } finally {
    if (!opts.keepFrames) await rm(framesDir, { recursive: true, force: true });
  }
}

export interface ThumbnailAtResult {
  path: string;
  /** The time that was requested, in source seconds. */
  requestedAtSec: number;
  /** The time the frame was actually taken from (clamped into the file). Decoding seeks to the nearest decodable frame at or after this time. */
  atSec: number;
  width: number | null;
  height: number | null;
}

/** Writes one JPEG frame from source time `atSec`. */
export async function thumbnailAt(
  src: string,
  atSec: number,
  out: string,
  options: { width?: number; jpegQuality?: number } & CommonRunOpts = {},
): Promise<ThumbnailAtResult> {
  const width = options.width ?? 640;
  const q = options.jpegQuality ?? 4;
  const source = options.sourceProbe ?? (await probe(src, { signal: options.signal }));
  const duration = source.durationSec;
  const frameSec = source.fps ? 1 / source.fps : 0.04;
  // Seeking at or past the last decodable frame yields no output, so clamp and, if the
  // file still comes back empty, back off further toward the end of the stream.
  const candidates: number[] = [];
  const requested = Math.max(0, atSec);
  if (duration !== null && requested >= duration - frameSec) {
    candidates.push(Math.max(0, duration - 2 * frameSec), Math.max(0, duration - 0.5), Math.max(0, duration - 1));
  } else {
    candidates.push(requested);
  }
  await mkdir(dirname(out), { recursive: true });
  let t = candidates[0] as number;
  let produced = false;
  for (const candidate of candidates) {
    t = candidate;
    await runFfmpeg(
      ['-y', '-v', 'error', '-ss', t.toFixed(3), '-i', src, '-map', '0:v:0', '-frames:v', '1', '-vf', `scale=${width}:-2`, '-q:v', String(q), '-f', 'image2', out],
      { signal: options.signal },
    );
    if (existsSync(out)) {
      produced = true;
      break;
    }
  }
  if (!produced) throw new Error(`no frame could be decoded near ${atSec.toFixed(3)} s of ${basename(src)}`);
  const img = await probe(out, { signal: options.signal });
  return { path: out, requestedAtSec: atSec, atSec: t, width: img.width, height: img.height };
}
