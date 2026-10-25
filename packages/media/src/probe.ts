import { stat } from 'node:fs/promises';
import { z } from 'zod';
import { runFfprobe } from './ffmpeg.ts';

export type ContainerKind = 'mp4' | 'mov' | 'mkv' | 'webm' | 'avi' | 'mpegts' | 'other';

export interface ProbeResult {
  path: string;
  byteSize: number;
  /** Normalized container family derived from ffprobe's format_name and major_brand. */
  container: ContainerKind;
  /** Raw ffprobe format_name (comma-separated list of demuxer aliases). */
  formatName: string;
  majorBrand: string | null;
  durationSec: number | null;
  /** Container start offset. Players show the first frame at 0; add this to get container PTS seconds. */
  startTimeSec: number;
  videoCodec: string | null;
  videoProfile: string | null;
  audioCodec: string | null;
  hasAudio: boolean;
  width: number | null;
  height: number | null;
  /** Average frame rate (avg_frame_rate), null when ffprobe cannot establish it. */
  fps: number | null;
  /** Nominal frame rate (r_frame_rate) as a string like "30000/1001". */
  rFrameRate: string | null;
  /** Rotation in degrees from the display matrix / rotate tag, 0 when none. */
  rotation: number;
  pixFmt: string | null;
  bitRate: number | null;
  nbFrames: number | null;
  /** Count of video streams; coaching film normally has exactly one. */
  videoStreamCount: number;
}

function num(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  const n = typeof v === 'number' ? v : Number.parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function parseRate(s: unknown): number | null {
  if (typeof s !== 'string' || s.length === 0) return null;
  const [a, b] = s.split('/');
  const n = Number.parseFloat(a ?? '');
  const d = b === undefined ? 1 : Number.parseFloat(b);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0 || n === 0) return null;
  return n / d;
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  profile?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  start_time?: string;
  duration?: string;
  nb_frames?: string;
  pix_fmt?: string;
  bit_rate?: string;
  tags?: Record<string, string>;
  side_data_list?: Array<{ side_data_type?: string; rotation?: number }>;
  disposition?: Record<string, number>;
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: {
    format_name?: string;
    duration?: string;
    start_time?: string;
    bit_rate?: string;
    size?: string;
    tags?: Record<string, string>;
  };
}

export function classifyContainer(formatName: string, majorBrand: string | null): ContainerKind {
  const names = formatName.split(',').map((s) => s.trim());
  if (names.includes('mp4') || names.includes('mov')) {
    const brand = (majorBrand ?? '').toLowerCase().trim();
    if (brand.startsWith('qt')) return 'mov';
    return 'mp4';
  }
  if (names.includes('matroska')) return 'mkv';
  if (names.includes('webm')) return 'webm';
  if (names.includes('avi')) return 'avi';
  if (names.includes('mpegts')) return 'mpegts';
  return 'other';
}

function rotationOf(stream: FfprobeStream): number {
  const fromTag = num(stream.tags?.['rotate']);
  if (fromTag !== null) return normalizeRotation(fromTag);
  for (const sd of stream.side_data_list ?? []) {
    if (typeof sd.rotation === 'number') return normalizeRotation(sd.rotation);
  }
  return 0;
}

function normalizeRotation(r: number): number {
  const m = ((Math.round(r) % 360) + 360) % 360;
  return m;
}

/** Reads container and stream facts with ffprobe. Never throws on odd files short of ffprobe itself failing. */
export async function probe(path: string, opts: { signal?: AbortSignal } = {}): Promise<ProbeResult> {
  const st = await stat(path);
  const { stdout } = await runFfprobe(
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path],
    { signal: opts.signal },
  );
  const parsed = JSON.parse(stdout) as FfprobeOutput;
  const streams = parsed.streams ?? [];
  const video = streams.filter((s) => s.codec_type === 'video' && s.disposition?.['attached_pic'] !== 1);
  const audio = streams.filter((s) => s.codec_type === 'audio');
  const v = video[0] ?? null;
  const a = audio[0] ?? null;
  const formatName = parsed.format?.format_name ?? '';
  const majorBrand = parsed.format?.tags?.['major_brand'] ?? null;

  const formatDuration = num(parsed.format?.duration);
  const streamDuration = v ? num(v.duration) : null;
  const width = v ? num(v.width) : null;
  const height = v ? num(v.height) : null;
  const rotation = v ? rotationOf(v) : 0;
  const swap = rotation === 90 || rotation === 270;

  return {
    path,
    byteSize: st.size,
    container: classifyContainer(formatName, majorBrand),
    formatName,
    majorBrand,
    durationSec: formatDuration ?? streamDuration,
    startTimeSec: num(v?.start_time) ?? num(parsed.format?.start_time) ?? 0,
    videoCodec: v?.codec_name ?? null,
    videoProfile: v?.profile ?? null,
    audioCodec: a?.codec_name ?? null,
    hasAudio: audio.length > 0,
    width: swap ? height : width,
    height: swap ? width : height,
    fps: v ? (parseRate(v.avg_frame_rate) ?? parseRate(v.r_frame_rate)) : null,
    rFrameRate: v?.r_frame_rate ?? null,
    rotation,
    pixFmt: v?.pix_fmt ?? null,
    bitRate: num(parsed.format?.bit_rate) ?? (v ? num(v.bit_rate) : null),
    nbFrames: v ? num(v.nb_frames) : null,
    videoStreamCount: video.length,
  };
}

export const UploadLimitsSchema = z.object({
  allowedContainers: z.array(z.enum(['mp4', 'mov', 'mkv', 'webm', 'avi', 'mpegts', 'other'])).min(1),
  allowedVideoCodecs: z.array(z.string().min(1)).min(1),
  maxDurationSec: z.number().positive(),
  maxBytes: z.number().int().positive(),
  minWidth: z.number().int().positive(),
  minHeight: z.number().int().positive(),
});
export type UploadLimits = z.infer<typeof UploadLimitsSchema>;

/** Defaults confirmed by the owner on 2026-10-25: 8 GB, 4 h, mp4/mov/mkv, h264/hevc, at least 720p. */
export const DEFAULT_UPLOAD_LIMITS: UploadLimits = UploadLimitsSchema.parse({
  allowedContainers: ['mp4', 'mov', 'mkv'],
  allowedVideoCodecs: ['h264', 'hevc'],
  maxDurationSec: 4 * 60 * 60,
  maxBytes: 8 * 1024 * 1024 * 1024,
  minWidth: 1280,
  minHeight: 720,
});

export interface ValidationResult {
  ok: boolean;
  /** Plain-language reasons the file is rejected. Empty when ok. */
  reasons: string[];
  /** Plain-language notes that do not reject the file. */
  warnings: string[];
}

function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min ${s} s`;
  return `${s} s`;
}

function fmtBytes(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(gb >= 10 ? 0 : 1)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
}

/** Checks a probe against limits; `limits` is validated with zod so a bad config fails loudly. */
export function validate(p: ProbeResult, limits: UploadLimits = DEFAULT_UPLOAD_LIMITS): ValidationResult {
  const lim = UploadLimitsSchema.parse(limits);
  const reasons: string[] = [];

  if (p.videoStreamCount === 0 || p.videoCodec === null) {
    reasons.push('The file has no video stream we can read.');
  }
  if (!lim.allowedContainers.includes(p.container)) {
    reasons.push(
      `The file container (${p.container === 'other' ? p.formatName || 'unknown' : p.container}) is not supported; use ${lim.allowedContainers.join(', ')}.`,
    );
  }
  if (p.videoCodec !== null && !lim.allowedVideoCodecs.includes(p.videoCodec)) {
    reasons.push(`The video codec (${p.videoCodec}) is not supported; use ${lim.allowedVideoCodecs.join(' or ')}.`);
  }
  if (p.durationSec === null) {
    reasons.push('The file duration could not be determined; the file may be truncated or still being written.');
  } else if (p.durationSec > lim.maxDurationSec) {
    reasons.push(`The file is ${fmtDuration(p.durationSec)} long; the limit is ${fmtDuration(lim.maxDurationSec)}.`);
  } else if (p.durationSec <= 0) {
    reasons.push('The file has zero length.');
  }
  if (p.byteSize > lim.maxBytes) {
    reasons.push(`The file is ${fmtBytes(p.byteSize)}; the limit is ${fmtBytes(lim.maxBytes)}.`);
  }
  if (p.width === null || p.height === null) {
    if (p.videoCodec !== null) reasons.push('The video resolution could not be read.');
  } else if (p.width < lim.minWidth || p.height < lim.minHeight) {
    reasons.push(`The video is ${p.width}x${p.height}; at least ${lim.minWidth}x${lim.minHeight} is required.`);
  }
  const warnings: string[] = [];
  if (p.videoStreamCount > 1) {
    warnings.push(`The file has ${p.videoStreamCount} video streams; only the first will be used.`);
  }
  if (p.rotation !== 0) {
    warnings.push(`The video carries a ${p.rotation} degree rotation flag; the proxy will be rendered upright.`);
  }
  if (p.fps !== null && p.fps < 24) {
    warnings.push(`The frame rate is ${p.fps.toFixed(2)} fps; motion-based play detection is less reliable below 24 fps.`);
  }
  return { ok: reasons.length === 0, reasons, warnings };
}
