import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { runFfmpeg } from './ffmpeg.ts';
import { probe, type ProbeResult } from './probe.ts';

/**
 * Frame extraction by source timestamp (CONTRACTS §14.8, `extractFrames`).
 *
 * Time convention: `atSec` is seconds from the first presented frame of the
 * file, the same clock a browser player and every stored segment use. ffmpeg
 * normalises container start offsets the same way (see README "Timing"), so a
 * proxy or an `-itsoffset` copy returns the same picture for the same `atSec`.
 */

export const ExtractFramesOptionsSchema = z.object({
  /** Output height; the source is never upscaled. Width follows the aspect ratio (even). */
  height: z.number().int().min(16).max(2160).default(720),
  /** mjpeg quality, 2 (best) .. 31 (worst). */
  quality: z.number().int().min(2).max(31).default(4),
  /** Timestamps per ffmpeg invocation; the select expression grows with this. */
  maxPerInvocation: z.number().int().min(1).max(2000).default(240),
  /** Seek to just before the first requested timestamp instead of decoding from the start. */
  seek: z.boolean().default(true),
});
export type ExtractFramesOptions = z.input<typeof ExtractFramesOptionsSchema> & {
  signal?: AbortSignal;
  /** Already-probed source, to avoid probing twice. */
  sourceProbe?: ProbeResult;
};

export interface ExtractedFrame {
  /** The requested timestamp, echoed exactly. */
  atSec: number;
  jpeg: Buffer;
  width: number;
  height: number;
  /** Presentation time of the frame actually decoded: the first frame at or after `atSec`. */
  frameSec: number;
}

export interface ExtractFramesReport {
  /** Ascending by `atSec`; one entry per distinct requested timestamp that has a frame. */
  frames: ExtractedFrame[];
  /** Requested timestamps for which no frame exists (at or past the end of the stream). Ascending. */
  missing: number[];
  /** Source duration as probed, for callers that want to explain `missing`. */
  durationSec: number | null;
}

/**
 * Extracts one JPEG per requested timestamp: the first decodable frame whose
 * presentation time is at or after the timestamp. Runs one ffmpeg invocation per
 * `maxPerInvocation` timestamps (so normally exactly one), seeking to one second
 * before the earliest timestamp and stopping after the latest. Output is sorted
 * ascending by `atSec`; duplicate timestamps collapse to one entry; timestamps at
 * or past the end of the stream yield no frame and are listed in `missing`
 * (see `extractFramesReport`). Throws `RangeError` on a negative or non-finite
 * timestamp.
 */
export async function extractFrames(src: string, timestampsSec: number[], options: ExtractFramesOptions = {}): Promise<ExtractedFrame[]> {
  return (await extractFramesReport(src, timestampsSec, options)).frames;
}

export async function extractFramesReport(src: string, timestampsSec: number[], options: ExtractFramesOptions = {}): Promise<ExtractFramesReport> {
  const { signal, sourceProbe, ...rest } = options;
  const opts = ExtractFramesOptionsSchema.parse(rest);
  for (const t of timestampsSec) {
    if (!Number.isFinite(t) || t < 0) throw new RangeError(`timestamp must be a finite number >= 0, got ${String(t)}`);
  }
  const wanted = [...new Set(timestampsSec)].sort((a, b) => a - b);
  const source = sourceProbe ?? (await probe(src, { signal }));
  if (wanted.length === 0) return { frames: [], missing: [], durationSec: source.durationSec };

  const targetHeight = source.height !== null ? Math.min(opts.height, source.height) : opts.height;
  const frames: ExtractedFrame[] = [];
  const missing: number[] = [];
  for (let i = 0; i < wanted.length; i += opts.maxPerInvocation) {
    const chunk = wanted.slice(i, i + opts.maxPerInvocation);
    const r = await extractChunk(src, chunk, { height: targetHeight, quality: opts.quality, seek: opts.seek, signal });
    frames.push(...r.frames);
    missing.push(...r.missing);
  }
  return { frames, missing, durationSec: source.durationSec };
}

const SEEK_LEAD_SEC = 1;
const TAIL_MARGIN_SEC = 2;
const MATCH_EPS = 1e-4;

async function extractChunk(
  src: string,
  chunk: number[],
  o: { height: number; quality: number; seek: boolean; signal?: AbortSignal },
): Promise<{ frames: ExtractedFrame[]; missing: number[] }> {
  const first = chunk[0] as number;
  const last = chunk[chunk.length - 1] as number;
  // Input seeking lands on the keyframe before `seekSec` and drops frames before it; the
  // filter clock then starts at the seek point, so expression times are relative to it.
  const seekSec = o.seek && first > SEEK_LEAD_SEC ? round3(first - SEEK_LEAD_SEC) : 0;
  const readSec = round3(last - seekSec + TAIL_MARGIN_SEC);
  const expr = chunk.map((t) => selectTerm(round6(t - seekSec))).join('+');

  const dir = await mkdtemp(join(tmpdir(), 'footballos-frames-'));
  try {
    const { stderr } = await runFfmpeg(
      [
        '-y', '-v', 'info', '-nostats',
        ...(seekSec > 0 ? ['-ss', seekSec.toFixed(3)] : []),
        '-t', readSec.toFixed(3),
        '-i', src,
        '-map', '0:v:0',
        '-vf', `select='${expr}',showinfo,scale=-2:${o.height}`,
        '-fps_mode', 'passthrough',
        '-q:v', String(o.quality),
        '-f', 'image2',
        join(dir, 'f-%06d.jpg'),
      ],
      { signal: o.signal },
    );
    const selectedRel = parseShowinfoTimes(stderr);
    const files = (await readdir(dir)).filter((f) => /^f-\d+\.jpg$/.test(f)).sort();
    if (files.length !== selectedRel.length) {
      throw new Error(`frame extraction wrote ${files.length} files but ffmpeg reported ${selectedRel.length} selected frames`);
    }
    const buffers = new Map<number, Buffer>();
    const frames: ExtractedFrame[] = [];
    const missing: number[] = [];
    let j = 0;
    for (const t of chunk) {
      const rel = t - seekSec;
      while (j < selectedRel.length && (selectedRel[j] as number) < rel - MATCH_EPS) j += 1;
      if (j >= selectedRel.length) {
        missing.push(t);
        continue;
      }
      let jpeg = buffers.get(j);
      if (!jpeg) {
        jpeg = await readFile(join(dir, files[j] as string));
        buffers.set(j, jpeg);
      }
      const dim = jpegDimensions(jpeg);
      frames.push({ atSec: t, jpeg, width: dim.width, height: dim.height, frameSec: round3((selectedRel[j] as number) + seekSec) });
    }
    return { frames, missing };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Selects the first frame whose time is at or after `t`: t >= T and (no previous frame or previous < T). */
function selectTerm(t: number): string {
  const v = t.toString();
  return `gte(t\\,${v})*(isnan(prev_t)+lt(prev_t\\,${v}))`;
}

/** Presentation times (seconds) printed by the `showinfo` filter, in output order. */
export function parseShowinfoTimes(stderr: string): number[] {
  const out: number[] = [];
  const re = /\bpts_time:(-?[0-9.]+)/g;
  for (const line of stderr.split('\n')) {
    if (!line.includes('showinfo')) continue;
    re.lastIndex = 0;
    const m = re.exec(line);
    if (m) out.push(Number.parseFloat(m[1] as string));
  }
  return out;
}

/** Reads width/height from a baseline or progressive JPEG's SOF marker. */
export function jpegDimensions(buf: Buffer): { width: number; height: number } {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('not a JPEG');
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = buf[i + 1] as number;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01 || marker === 0xff) {
      i += marker === 0xff ? 1 : 2;
      continue;
    }
    const len = buf.readUInt16BE(i + 2);
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    if (marker === 0xd9 || marker === 0xda) break;
    i += 2 + len;
  }
  throw new Error('JPEG has no SOF marker');
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
