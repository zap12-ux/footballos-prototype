import { existsSync } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import { MediaToolError } from './ffmpeg.ts';
import type { JobRunner } from './jobs/runner.ts';
import { NonRetryableError, type JobHandler } from './jobs/types.ts';
import { DEFAULT_UPLOAD_LIMITS, probe, UploadLimitsSchema, validate, type ProbeResult, type UploadLimits } from './probe.ts';
import { makeProxy, makeThumbnailSheet, ProxyOptionsSchema, ThumbnailSheetOptionsSchema, type ProgressInfo, type ProxyOptions, type ThumbnailSheetOptions } from './proxy.ts';
import { assessQuality } from './quality.ts';
import { proposeSegments, SegmentationOptionsSchema, type SegmentationOptions } from './segments.ts';
import { writeThumbnailSidecar } from './thumbs.ts';
import type { ProxyTimeMapping, ThumbnailSheetMapping } from './timemap.ts';
import type { FootageQuality, PlaySegment } from './types.ts';

/**
 * Job handlers hosted by the API worker (CONTRACTS §14.2, §14.8). Each handler is
 *
 *   async (job: { id, input }, ctx: { signal, progress(done, total, message) }) => result
 *
 * with `input = { assetId, sourcePath, outDir }`. Paths may be absolute or relative
 * to `dataDir`. Handlers honour `ctx.signal` (ffmpeg children are killed on abort and
 * partial outputs are removed) and report progress through `ctx.progress`.
 * `asJobHandler` / `registerMediaHandlers` adapt them to this package's `JobRunner`.
 */

export const MediaJobInputSchema = z.object({
  assetId: z.string().min(1),
  sourcePath: z.string().min(1),
  outDir: z.string().min(1),
  /** Optional identity for segment proposals; falls back to the job's teamId / empty gameId. */
  teamId: z.string().optional(),
  gameId: z.string().optional(),
});
export type MediaJobInput = z.infer<typeof MediaJobInputSchema>;

export interface MediaJob<I = MediaJobInput> {
  id: string;
  input: I;
  /** Present when the host passes the whole job; used for segment identity. */
  teamId?: string;
}

export interface MediaHandlerContext {
  signal: AbortSignal;
  progress(done: number, total: number | null, message: string): void | Promise<void>;
}

export type MediaHandler<R> = (job: MediaJob, ctx: MediaHandlerContext) => Promise<R>;

export interface ValidateJobResult {
  ok: boolean;
  /** Plain-language rejection reasons; empty when ok. */
  reasons: string[];
  /** Plain-language notes that do not reject the file. */
  warnings: string[];
  /** Null only when the file could not be probed at all (then `reasons` says so). */
  probe: ProbeResult | null;
  /** Assessed only for files that pass validation; null otherwise. */
  quality: FootageQuality | null;
}

export interface ProxyJobResult {
  proxyPath: string;
  mapping: ProxyTimeMapping;
  durationDriftSec: number | null;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  byteSize: number;
  fps: number | null;
  notes: string[];
}

export interface ThumbnailsJobResult {
  sheetPath: string;
  everySec: number;
  count: number;
  /** Set when individual frames were kept next to the sheet (default). */
  framesDir?: string;
  /** `<sheetPath>.json`; `thumbTile(sheetPath, n)` reads it. */
  sidecarPath: string;
  mapping: ThumbnailSheetMapping;
  sheetWidth: number | null;
  sheetHeight: number | null;
}

export interface SegmentJobResult {
  /** Ordered, non-overlapping proposals with `origin: 'proposed'`, `reviewStatus: 'proposed'`. */
  segments: PlaySegment[];
  confidenceNote: string;
  thresholds: { high: number; low: number; derived: boolean; floor: number; peak: number };
  /** `<outDir>/segments.json` with the same content, for inspection. */
  segmentsPath: string;
}

export interface MediaHandlers {
  validate: MediaHandler<ValidateJobResult>;
  proxy: MediaHandler<ProxyJobResult>;
  thumbnails: MediaHandler<ThumbnailsJobResult>;
  segment: MediaHandler<SegmentJobResult>;
}

export interface MediaHandlerOptions {
  /** Base directory for relative `sourcePath` / `outDir` values. */
  dataDir: string;
  /** Overrides merged over `DEFAULT_UPLOAD_LIMITS`. */
  limits?: Partial<UploadLimits>;
  /** `makeProxy` options; owner default height 720. */
  proxy?: ProxyOptions;
  /** `makeThumbnailSheet` options; owner default every 10 s. Frames are kept unless `keepFrames: false`. */
  thumbnails?: ThumbnailSheetOptions;
  segmentation?: SegmentationOptions;
  /** Minimum milliseconds between two progress reports from ffmpeg (default 1000). */
  progressIntervalMs?: number;
}

export const PROXY_FILENAME = 'proxy.mp4';
export const THUMBNAIL_SHEET_FILENAME = 'thumbs.jpg';
export const SEGMENTS_FILENAME = 'segments.json';

export function createMediaHandlers(options: MediaHandlerOptions): MediaHandlers {
  if (typeof options.dataDir !== 'string' || options.dataDir.length === 0) throw new TypeError('createMediaHandlers: dataDir is required');
  const o = { dataDir: options.dataDir, progressIntervalMs: Math.max(0, options.progressIntervalMs ?? 1000) };
  const limits: UploadLimits = UploadLimitsSchema.parse({ ...DEFAULT_UPLOAD_LIMITS, ...(options.limits ?? {}) });
  const proxyOpts = ProxyOptionsSchema.parse(options.proxy ?? {});
  const thumbOpts = ThumbnailSheetOptionsSchema.parse({ keepFrames: true, ...(options.thumbnails ?? {}) });
  const segOpts: SegmentationOptions = SegmentationOptionsSchema.parse(options.segmentation ?? {});

  const resolvePath = (p: string) => (isAbsolute(p) ? p : resolve(o.dataDir, p));

  async function prepare(job: MediaJob): Promise<{ input: MediaJobInput; sourcePath: string; outDir: string }> {
    const parsed = MediaJobInputSchema.safeParse(job.input);
    if (!parsed.success) throw new NonRetryableError('bad_input', `media job input is invalid: ${parsed.error.message}`);
    const sourcePath = resolvePath(parsed.data.sourcePath);
    const outDir = resolvePath(parsed.data.outDir);
    try {
      const st = await stat(sourcePath);
      if (!st.isFile()) throw new NonRetryableError('source_missing', `source is not a file: ${sourcePath}`);
    } catch (err) {
      if (err instanceof NonRetryableError) throw err;
      throw new NonRetryableError('source_missing', `source file not found: ${sourcePath}`);
    }
    await mkdir(outDir, { recursive: true });
    return { input: parsed.data, sourcePath, outDir };
  }

  function throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) throw new MediaToolError('aborted', 'job aborted before work started', [], '');
  }

  function ffmpegProgress(ctx: MediaHandlerContext, label: string): (p: ProgressInfo) => void {
    let lastAt = 0;
    return (p) => {
      const now = Date.now();
      const final = p.fraction !== null && p.fraction >= 1;
      if (!final && now - lastAt < o.progressIntervalMs) return;
      lastAt = now;
      const done = Math.round(p.doneSec);
      const total = p.totalSec === null ? null : Math.max(done, Math.round(p.totalSec));
      const pct = p.fraction === null ? '' : ` ${Math.round(p.fraction * 100)}%`;
      report(ctx, done, total, `${label}${pct}`);
    };
  }

  const validateHandler: MediaHandler<ValidateJobResult> = async (job, ctx) => {
    const { sourcePath } = await prepare(job);
    throwIfAborted(ctx.signal);
    await report(ctx, 0, 3, 'Reading the file');
    let probed: ProbeResult;
    try {
      probed = await probe(sourcePath, { signal: ctx.signal });
    } catch (err) {
      if (err instanceof MediaToolError && err.code === 'aborted') throw err;
      const msg = err instanceof Error ? err.message : String(err);
      await report(ctx, 3, 3, 'The file could not be read');
      return { ok: false, reasons: [`The file could not be read as video (${msg.split('\n')[0]}).`], warnings: [], probe: null, quality: null };
    }
    await report(ctx, 1, 3, 'Checking limits');
    const v = validate(probed, limits);
    if (!v.ok) {
      await report(ctx, 3, 3, 'Rejected');
      return { ok: false, reasons: v.reasons, warnings: v.warnings, probe: probed, quality: null };
    }
    await report(ctx, 2, 3, 'Assessing footage quality');
    const q = await assessQuality(sourcePath, { signal: ctx.signal, sourceProbe: probed });
    await report(ctx, 3, 3, 'Validated');
    return { ok: true, reasons: [], warnings: v.warnings, probe: probed, quality: q.quality };
  };

  const proxyHandler: MediaHandler<ProxyJobResult> = async (job, ctx) => {
    const { sourcePath, outDir } = await prepare(job);
    throwIfAborted(ctx.signal);
    const finalPath = join(outDir, PROXY_FILENAME);
    const partPath = `${finalPath}.part-${job.id}`;
    await report(ctx, 0, null, 'Encoding proxy');
    try {
      const r = await makeProxy(sourcePath, partPath, { ...proxyOpts, signal: ctx.signal, onProgress: ffmpegProgress(ctx, 'Encoding proxy') });
      throwIfAborted(ctx.signal);
      await rename(partPath, finalPath);
      await report(ctx, r.durationSec === null ? 1 : Math.round(r.durationSec), r.durationSec === null ? 1 : Math.round(r.durationSec), 'Proxy ready');
      return {
        proxyPath: finalPath,
        mapping: r.mapping,
        durationDriftSec: r.durationDriftSec,
        width: r.width,
        height: r.height,
        durationSec: r.durationSec,
        byteSize: r.byteSize,
        fps: r.fps,
        notes: r.notes,
      };
    } catch (err) {
      await rm(partPath, { force: true });
      throw err;
    }
  };

  const thumbnailsHandler: MediaHandler<ThumbnailsJobResult> = async (job, ctx) => {
    const { sourcePath, outDir } = await prepare(job);
    throwIfAborted(ctx.signal);
    const finalSheet = join(outDir, THUMBNAIL_SHEET_FILENAME);
    const staging = join(outDir, `.thumbnails-${job.id}.part`);
    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });
    const stagedSheet = join(staging, THUMBNAIL_SHEET_FILENAME);
    await report(ctx, 0, null, 'Extracting thumbnails');
    try {
      const r = await makeThumbnailSheet(sourcePath, stagedSheet, { ...thumbOpts, signal: ctx.signal, onProgress: ffmpegProgress(ctx, 'Extracting thumbnails') });
      throwIfAborted(ctx.signal);
      // Move the finished set into place: old outputs are replaced, never mixed.
      const finalFrames = `${finalSheet}.frames`;
      const finalSidecar = `${finalSheet}.json`;
      await Promise.all([rm(finalSheet, { force: true }), rm(finalSidecar, { force: true }), rm(finalFrames, { recursive: true, force: true })]);
      let framesDir: string | undefined;
      if (r.framesDir) {
        await rename(r.framesDir, finalFrames);
        framesDir = finalFrames;
      }
      await rename(stagedSheet, finalSheet);
      // Rewrite the sidecar with the final locations.
      const sidecarPath = await writeThumbnailSidecar(finalSheet, { mapping: r.mapping, sheetWidth: r.sheetWidth, sheetHeight: r.sheetHeight, framesDir: framesDir ?? null });
      await rm(staging, { recursive: true, force: true });
      await report(ctx, r.mapping.count, r.mapping.count, `${r.mapping.count} thumbnails ready`);
      return {
        sheetPath: finalSheet,
        everySec: r.mapping.everySec,
        count: r.mapping.count,
        ...(framesDir ? { framesDir } : {}),
        sidecarPath,
        mapping: r.mapping,
        sheetWidth: r.sheetWidth,
        sheetHeight: r.sheetHeight,
      };
    } catch (err) {
      await rm(staging, { recursive: true, force: true });
      throw err;
    }
  };

  const segmentHandler: MediaHandler<SegmentJobResult> = async (job, ctx) => {
    const { input, sourcePath, outDir } = await prepare(job);
    throwIfAborted(ctx.signal);
    await report(ctx, 0, null, 'Measuring motion');
    const r = await proposeSegments(
      sourcePath,
      { teamId: input.teamId ?? job.teamId ?? '', assetId: input.assetId, gameId: input.gameId ?? '' },
      { ...segOpts, signal: ctx.signal, onProgress: ffmpegProgress(ctx, 'Measuring motion') },
    );
    throwIfAborted(ctx.signal);
    const segmentsPath = join(outDir, SEGMENTS_FILENAME);
    const body = { segments: r.segments, confidenceNote: r.confidenceNote, thresholds: r.thresholds, rawRuns: r.rawRuns, seriesLengthSec: r.seriesLengthSec };
    await writeFile(`${segmentsPath}.part-${job.id}`, JSON.stringify(body, null, 2));
    await rename(`${segmentsPath}.part-${job.id}`, segmentsPath);
    await report(ctx, r.seriesLengthSec, r.seriesLengthSec, `${r.segments.length} plays proposed`);
    return { segments: r.segments, confidenceNote: r.confidenceNote, thresholds: r.thresholds, segmentsPath };
  };

  return { validate: validateHandler, proxy: proxyHandler, thumbnails: thumbnailsHandler, segment: segmentHandler };
}

async function report(ctx: MediaHandlerContext, done: number, total: number | null, message: string): Promise<void> {
  try {
    await ctx.progress(done, total, message);
  } catch {
    // Progress is advisory; a store hiccup must not fail the media work.
  }
}

/** Adapts a §14.8 handler to this package's JobRunner handler shape. */
export function asJobHandler<R>(handler: MediaHandler<R>): JobHandler<MediaJobInput, R> {
  return (ctx) =>
    handler(
      { id: ctx.job.id, input: ctx.input, teamId: ctx.job.teamId },
      { signal: ctx.signal, progress: (done, total, message) => ctx.progress({ done, total, message }) },
    );
}

/** Registers `validate`, `proxy`, `thumbnails` and `segment` on a runner. */
export function registerMediaHandlers(runner: JobRunner, handlers: MediaHandlers): JobRunner {
  runner.register('validate', asJobHandler(handlers.validate));
  runner.register('proxy', asJobHandler(handlers.proxy));
  runner.register('thumbnails', asJobHandler(handlers.thumbnails));
  runner.register('segment', asJobHandler(handlers.segment));
  return runner;
}

/** True when a job's output directory holds a finished proxy (used by hosts to skip re-encoding). */
export function hasProxy(outDir: string): boolean {
  return existsSync(join(outDir, PROXY_FILENAME));
}
