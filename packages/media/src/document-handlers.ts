import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import { DocumentError, extractDocument, PAGES_DIRNAME, type ExtractDocumentOptions, type ExtractedPage, type ExtractDocumentResult } from './documents.ts';
import { MediaToolError } from './ffmpeg.ts';
import type { MediaHandlerContext, MediaJob } from './handlers.ts';
import type { JobRunner } from './jobs/runner.ts';
import { NonRetryableError, type JobHandler } from './jobs/types.ts';

/**
 * `extract_document` job handler (CONTRACTS §15.1, §15.5) in the §14.8 shape:
 *
 *   async (job: { id, input: { assetId, sourcePath, outDir } }, ctx: { signal, progress }) => result
 *
 * Writes `outDir/pages/page-<n>.png` and `outDir/pages.json`. Work happens in a
 * staging directory `outDir/.extract-<jobId>.part/` that is moved into place when
 * everything succeeded, so an abort or crash leaves neither images nor a
 * `pages.json` behind and a re-run starts clean.
 */

export const DocumentJobInputSchema = z.object({
  assetId: z.string().min(1),
  sourcePath: z.string().min(1),
  outDir: z.string().min(1),
});
export type DocumentJobInput = z.infer<typeof DocumentJobInputSchema>;

export interface ExtractDocumentJobResult extends ExtractDocumentResult {
  /** `<outDir>/pages.json` */
  pagesPath: string;
  /** `<outDir>/pages` */
  pagesDir: string;
  renderDpi: number;
}

/** Shape of `pages.json`. */
export interface PagesFile {
  version: 1;
  assetId: string;
  sourcePath: string;
  sourceType: ExtractDocumentResult['sourceType'];
  renderDpi: number;
  ocr: ExtractDocumentResult['ocr'];
  pageCount: number;
  pages: ExtractedPage[];
  warnings: string[];
  extractedAt: string;
}

export const PAGES_FILENAME = 'pages.json';

export interface DocumentHandlerOptions {
  /** Base directory for relative `sourcePath` / `outDir` values. */
  dataDir: string;
  /** Defaults for every job; `renderDpi` 110 and `ocr: 'auto'` per CONTRACTS §15.5. */
  renderDpi?: number;
  ocr?: 'auto' | 'off';
  linesPerPage?: number;
}

export interface DocumentHandlers {
  extract_document: (job: MediaJob<DocumentJobInput>, ctx: MediaHandlerContext) => Promise<ExtractDocumentJobResult>;
}

export function createDocumentHandlers(options: DocumentHandlerOptions): DocumentHandlers {
  if (typeof options.dataDir !== 'string' || options.dataDir.length === 0) throw new TypeError('createDocumentHandlers: dataDir is required');
  const extractOpts: Pick<ExtractDocumentOptions, 'renderDpi' | 'ocr' | 'linesPerPage'> = {
    ...(options.renderDpi !== undefined ? { renderDpi: options.renderDpi } : {}),
    ...(options.ocr !== undefined ? { ocr: options.ocr } : {}),
    ...(options.linesPerPage !== undefined ? { linesPerPage: options.linesPerPage } : {}),
  };
  const resolvePath = (p: string) => (isAbsolute(p) ? p : resolve(options.dataDir, p));

  const extract_document: DocumentHandlers['extract_document'] = async (job, ctx) => {
    const parsed = DocumentJobInputSchema.safeParse(job.input);
    if (!parsed.success) throw new NonRetryableError('bad_input', `extract_document input is invalid: ${parsed.error.message}`);
    const sourcePath = resolvePath(parsed.data.sourcePath);
    const outDir = resolvePath(parsed.data.outDir);
    try {
      const st = await stat(sourcePath);
      if (!st.isFile()) throw new NonRetryableError('source_missing', `source is not a file: ${sourcePath}`);
    } catch (err) {
      if (err instanceof NonRetryableError) throw err;
      throw new NonRetryableError('source_missing', `source file not found: ${sourcePath}`);
    }
    if (ctx.signal.aborted) throw new MediaToolError('aborted', 'job aborted before work started', [], '');
    await mkdir(outDir, { recursive: true });
    const staging = join(outDir, `.extract-${job.id}.part`);
    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });
    try {
      await report(ctx, 0, null, 'Opening document');
      let r: ExtractDocumentResult;
      try {
        r = await extractDocument(sourcePath, staging, {
          ...extractOpts,
          signal: ctx.signal,
          onProgress: (done, total, message) => report(ctx, done, total === Number.MAX_SAFE_INTEGER ? null : total, message),
        });
      } catch (err) {
        if (err instanceof DocumentError) throw new NonRetryableError(err.code, err.message);
        throw err;
      }
      if (ctx.signal.aborted) throw new MediaToolError('aborted', 'job aborted', [], '');
      const finalPagesDir = join(outDir, PAGES_DIRNAME);
      const pagesPath = join(outDir, PAGES_FILENAME);
      const stagedPagesDir = join(staging, PAGES_DIRNAME);
      const pages = r.pages.map((p) => ({
        ...p,
        imagePath: p.imagePath === null ? null : join(finalPagesDir, p.imagePath.slice(stagedPagesDir.length + 1)),
      }));
      const renderDpi = extractOpts.renderDpi ?? 110;
      const body: PagesFile = {
        version: 1,
        assetId: parsed.data.assetId,
        sourcePath,
        sourceType: r.sourceType,
        renderDpi,
        ocr: r.ocr,
        pageCount: r.pageCount,
        pages,
        warnings: r.warnings,
        extractedAt: new Date().toISOString(),
      };
      const stagedJson = join(staging, PAGES_FILENAME);
      await writeFile(stagedJson, JSON.stringify(body, null, 2));
      // Replace any previous output as one unit: old images never mix with new ones.
      await Promise.all([rm(finalPagesDir, { recursive: true, force: true }), rm(pagesPath, { force: true })]);
      await rename(stagedPagesDir, finalPagesDir);
      await rename(stagedJson, pagesPath);
      await rm(staging, { recursive: true, force: true });
      await report(ctx, r.pageCount, r.pageCount, `${r.pageCount} page${r.pageCount === 1 ? '' : 's'} extracted`);
      return { ...r, pages, pagesPath, pagesDir: finalPagesDir, renderDpi };
    } catch (err) {
      await rm(staging, { recursive: true, force: true });
      throw err;
    }
  };

  return { extract_document };
}

async function report(ctx: MediaHandlerContext, done: number, total: number | null, message: string): Promise<void> {
  try {
    await ctx.progress(done, total, message);
  } catch {
    // Progress is advisory.
  }
}

/** Adapts the handler to this package's JobRunner handler shape. */
export function asDocumentJobHandler(handler: DocumentHandlers['extract_document']): JobHandler<DocumentJobInput, ExtractDocumentJobResult> {
  return (ctx) =>
    handler(
      { id: ctx.job.id, input: ctx.input, teamId: ctx.job.teamId },
      { signal: ctx.signal, progress: (done, total, message) => ctx.progress({ done, total, message }) },
    );
}

/** Registers `extract_document` on a runner. */
export function registerDocumentHandlers(runner: JobRunner, handlers: DocumentHandlers): JobRunner {
  runner.register('extract_document', asDocumentJobHandler(handlers.extract_document));
  return runner;
}
