/**
 * LOCAL STAND-IN for `createMediaHandlers` / `extractFrames` from `@footballos/media`
 * (CONTRACTS §14.8, owned by C). It implements exactly the §14.8 signatures on top of the
 * primitives C already shipped (`probe`, `validate`, `assessQuality`, `makeProxy`,
 * `makeThumbnailSheet`, `proposeSegments`, `thumbnailAt`). When C's export lands, replace the
 * import in `src/jobs/worker.ts` with `import { createMediaHandlers, extractFrames } from
 * '@footballos/media'` and delete this file; the worker only depends on the interface below.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FootageQuality, PlaySegment } from '@footballos/contracts';
import {
  assessQuality, makeProxy, makeThumbnailSheet, probe, proposeSegments, thumbnailAt, validate,
  type ProbeResult, type ProxyTimeMapping, type UploadLimits,
} from '@footballos/media';

export type ChainJobInput = { assetId: string; sourcePath: string; outDir: string; teamId: string; gameId: string };
export type HandlerJob<I = ChainJobInput> = { id: string; input: I };
export type HandlerCtx = { signal: AbortSignal; progress(done: number, total: number | null, message: string): Promise<void> | void };

export type ValidateResult = { ok: boolean; reasons: string[]; warnings: string[]; probe: ProbeResult; quality: FootageQuality | null };
export type ProxyResult = { proxyPath: string; mapping: ProxyTimeMapping; durationDriftSec: number | null; width: number | null; height: number | null };
export type ThumbnailsResult = { sheetPath: string; everySec: number; count: number; framesDir: string | null };
export type SegmentResult = { segments: PlaySegment[]; confidenceNote: string };

export type MediaHandlers = {
  validate: (job: HandlerJob, ctx: HandlerCtx) => Promise<ValidateResult>;
  proxy: (job: HandlerJob, ctx: HandlerCtx) => Promise<ProxyResult>;
  thumbnails: (job: HandlerJob, ctx: HandlerCtx) => Promise<ThumbnailsResult>;
  segment: (job: HandlerJob, ctx: HandlerCtx) => Promise<SegmentResult>;
};

export type MediaHandlerOptions = {
  dataDir: string;
  limits: UploadLimits;
  proxy: { height: number };
  thumbnails: { everySec: number };
};

export function createMediaHandlers(opts: MediaHandlerOptions): MediaHandlers {
  return {
    async validate(job, ctx) {
      await ctx.progress(0, 2, 'probing file');
      const p = await probe(job.input.sourcePath, { signal: ctx.signal });
      const v = validate(p, opts.limits);
      let quality: FootageQuality | null = null;
      if (v.ok) {
        await ctx.progress(1, 2, 'assessing footage quality');
        quality = (await assessQuality(job.input.sourcePath, { signal: ctx.signal, sourceProbe: p })).quality;
      }
      await ctx.progress(2, 2, v.ok ? 'valid' : 'rejected');
      return { ok: v.ok, reasons: v.reasons, warnings: v.warnings, probe: p, quality };
    },
    async proxy(job, ctx) {
      const out = path.join(job.input.outDir, 'proxy.mp4');
      const r = await makeProxy(job.input.sourcePath, out, {
        height: opts.proxy.height,
        signal: ctx.signal,
        onProgress: (p) => void ctx.progress(Math.round(p.doneSec), p.totalSec === null ? null : Math.round(p.totalSec), 'encoding proxy'),
      });
      return { proxyPath: r.path, mapping: r.mapping, durationDriftSec: r.durationDriftSec, width: r.width, height: r.height };
    },
    async thumbnails(job, ctx) {
      const out = path.join(job.input.outDir, 'thumbs', 'sheet.jpg');
      const r = await makeThumbnailSheet(job.input.sourcePath, out, {
        everySec: opts.thumbnails.everySec,
        keepFrames: true,
        signal: ctx.signal,
        onProgress: (p) => void ctx.progress(Math.round(p.doneSec), p.totalSec === null ? null : Math.round(p.totalSec), 'extracting thumbnails'),
      });
      return { sheetPath: r.path, everySec: r.mapping.everySec, count: r.mapping.count, framesDir: r.framesDir };
    },
    async segment(job, ctx) {
      const r = await proposeSegments(job.input.sourcePath, { teamId: job.input.teamId, assetId: job.input.assetId, gameId: job.input.gameId }, {
        signal: ctx.signal,
        onProgress: (p) => void ctx.progress(Math.round(p.doneSec), p.totalSec === null ? null : Math.round(p.totalSec), 'measuring motion'),
      });
      return { segments: r.segments as PlaySegment[], confidenceNote: r.confidenceNote };
    },
  };
}

export type ExtractedFrame = { atSec: number; jpeg: Buffer; width: number | null; height: number | null };

/** One ffmpeg seek per timestamp (C's real implementation will batch); frames are scaled to `height` keeping the aspect ratio. */
export async function extractFrames(src: string, timestampsSec: number[], options: { height?: number; signal?: AbortSignal } = {}): Promise<ExtractedFrame[]> {
  const height = options.height ?? 720;
  const source = await probe(src, { signal: options.signal });
  const width = source.width && source.height ? Math.round((source.width / source.height) * height / 2) * 2 : Math.round((16 / 9) * height);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'footballos-frames-'));
  try {
    const out: ExtractedFrame[] = [];
    for (let i = 0; i < timestampsSec.length; i++) {
      const file = path.join(dir, `frame-${i}.jpg`);
      const r = await thumbnailAt(src, timestampsSec[i]!, file, { width, signal: options.signal, sourceProbe: source });
      out.push({ atSec: timestampsSec[i]!, jpeg: await fs.readFile(file), width: r.width, height: r.height });
    }
    return out;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
