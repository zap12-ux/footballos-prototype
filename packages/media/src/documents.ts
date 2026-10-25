import { createRequire } from 'node:module';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { z } from 'zod';
import { MediaToolError } from './ffmpeg.ts';
import { createOcrEngine, normaliseOcrText, ocrAvailability, type OcrEngine } from './ocr.ts';

/**
 * Document extraction for playbook intake (CONTRACTS §15.1, §15.5).
 *
 *   extractDocument(path, outDir, { renderDpi = 110, ocr: 'auto' | 'off' })
 *     → { pageCount, pages: { pageNumber, imagePath, width, height, text, textSource, ocrConfidence }[], warnings[] }
 *
 * PDF pages are rendered to `outDir/pages/page-<n>.png` with pdfjs-dist (Apache-2.0)
 * on an @napi-rs/canvas (MIT) canvas and their text layer is read per page
 * (`textSource: 'pdf_text'`). Pages without a text layer go through offline OCR
 * (tesseract.js, see `ocr.ts`) when `ocr: 'auto'` and the engine is installed;
 * otherwise they come back as `textSource: 'none'` with a warning. `.txt` / `.md`
 * files become pages of `linesPerPage` lines; `.docx` is converted to plain text by
 * mammoth (BSD-2-Clause) first. Text pages are also rendered to a PNG so every page
 * has an image to show.
 *
 * Nothing is ever invented: a page whose text could not be read has `text: null`.
 * PDFs are untrusted input: pdfjs runs without scripting support
 * and no XFA; OCR output is data, never an instruction.
 */

const require = createRequire(import.meta.url);

export const DOCUMENT_EXTENSIONS = ['.pdf', '.txt', '.md', '.docx'] as const;
export type DocumentSourceType = 'pdf' | 'text' | 'docx';
export type TextSource = 'pdf_text' | 'ocr' | 'none';

export const ExtractDocumentOptionsSchema = z.object({
  /** Render resolution for page images (dots per inch of the PDF page). */
  renderDpi: z.number().min(36).max(300).default(110),
  /** `auto`: OCR pages without a text layer when an engine is installed; `off`: never. */
  ocr: z.enum(['auto', 'off']).default('auto'),
  /** Lines per page for `.txt` / `.md` / `.docx` sources. */
  linesPerPage: z.number().int().min(1).max(500).default(60),
});

export interface ExtractDocumentOptions extends Partial<z.input<typeof ExtractDocumentOptionsSchema>> {
  signal?: AbortSignal;
  /** Called once per finished page (and once before the first). Errors thrown here are ignored. */
  onProgress?: (done: number, total: number, message: string) => void;
}

export interface ExtractedPage {
  /** 1-based, in the document's own order. */
  pageNumber: number;
  /** `outDir/pages/page-<n>.png`; null only when the page could not be rendered (a warning says why). */
  imagePath: string | null;
  /** Pixel size of the rendered image (the page size at `renderDpi` when rendering failed). */
  width: number;
  height: number;
  /** Null when no text could be read from the page. */
  text: string | null;
  textSource: TextSource;
  /** 0..1 for OCR pages, null otherwise. */
  ocrConfidence: number | null;
}

export interface ExtractDocumentResult {
  pageCount: number;
  pages: ExtractedPage[];
  /** Plain-language notes: encrypted PDF, pages without a text layer, render or OCR failures. */
  warnings: string[];
  sourceType: DocumentSourceType;
  /** Which OCR engine was available for this run (null when none); `used` is true when at least one page went through it. */
  ocr: { requested: 'auto' | 'off'; engine: 'tesseract.js' | null; used: boolean };
}

/** Thrown for inputs this module cannot process at all; `code` is stable, `message` is for people. */
export class DocumentError extends Error {
  readonly code: 'unsupported_type' | 'source_missing' | 'invalid_pdf' | 'pdf_failed' | 'docx_failed' | 'text_failed';
  constructor(code: DocumentError['code'], message: string) {
    super(message);
    this.name = 'DocumentError';
    this.code = code;
  }
}

export const PAGES_DIRNAME = 'pages';
export function pageImageName(pageNumber: number): string {
  return `page-${pageNumber}.png`;
}

/** US Letter in PDF points; text documents are laid out on it. */
const LETTER_PT = { width: 612, height: 792 } as const;

export function documentSourceType(path: string): DocumentSourceType | null {
  const ext = extname(path).toLowerCase();
  if (ext === '.pdf') return 'pdf';
  if (ext === '.txt' || ext === '.md') return 'text';
  if (ext === '.docx') return 'docx';
  return null;
}

export async function extractDocument(path: string, outDir: string, options: ExtractDocumentOptions = {}): Promise<ExtractDocumentResult> {
  const { signal, onProgress, ...rest } = options;
  const opts = ExtractDocumentOptionsSchema.parse(rest);
  const sourceType = documentSourceType(path);
  if (!sourceType) {
    throw new DocumentError('unsupported_type', `Unsupported document type "${extname(path) || '(none)'}"; accepted: ${DOCUMENT_EXTENSIONS.join(', ')}.`);
  }
  try {
    const st = await stat(path);
    if (!st.isFile()) throw new DocumentError('source_missing', `Not a file: ${path}`);
  } catch (err) {
    if (err instanceof DocumentError) throw err;
    throw new DocumentError('source_missing', `Document not found: ${path}`);
  }
  throwIfAborted(signal);
  const pagesDir = join(outDir, PAGES_DIRNAME);
  await mkdir(pagesDir, { recursive: true });

  const run: Extraction = {
    opts,
    signal,
    progress: (done, total, message) => {
      try {
        onProgress?.(done, total, message);
      } catch {
        // advisory
      }
    },
    pagesDir,
    written: [],
    warnings: [],
    ocrEngine: null,
    ocrUsed: false,
    ocrUnavailableNoted: false,
  };

  try {
    let pages: ExtractedPage[];
    if (sourceType === 'pdf') pages = await extractPdf(path, run);
    else if (sourceType === 'docx') pages = await extractDocx(path, run);
    else pages = await extractText(path, run);
    const availability = ocrAvailability();
    return {
      pageCount: pages.length,
      pages,
      warnings: run.warnings,
      sourceType,
      ocr: { requested: opts.ocr, engine: availability.available ? 'tesseract.js' : null, used: run.ocrUsed },
    };
  } catch (err) {
    // Leave nothing half-written behind: a caller re-running the job starts clean.
    await Promise.all(run.written.map((f) => rm(f, { force: true })));
    throw err;
  } finally {
    if (run.ocrEngine) await run.ocrEngine.terminate();
  }
}

interface Extraction {
  opts: z.infer<typeof ExtractDocumentOptionsSchema>;
  signal: AbortSignal | undefined;
  progress: (done: number, total: number, message: string) => void;
  pagesDir: string;
  written: string[];
  warnings: string[];
  ocrEngine: OcrEngine | null;
  ocrUsed: boolean;
  ocrUnavailableNoted: boolean;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new MediaToolError('aborted', 'document extraction aborted', [], '');
}

// ---------------------------------------------------------------------------
// PDF

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let pdfjsModule: Promise<PdfJs> | null = null;
function loadPdfJs(): Promise<PdfJs> {
  pdfjsModule ??= import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsModule;
}

function pdfjsAssetUrl(sub: string): string {
  const root = dirname(require.resolve('pdfjs-dist/package.json'));
  return `${join(root, sub)}/`;
}

async function extractPdf(path: string, run: Extraction): Promise<ExtractedPage[]> {
  const pdfjs = await loadPdfJs();
  const bytes = await readFile(path);
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
    disableFontFace: true,
    standardFontDataUrl: pdfjsAssetUrl('standard_fonts'),
    cMapUrl: pdfjsAssetUrl('cmaps'),
    cMapPacked: true,
    iccUrl: pdfjsAssetUrl('iccs'),
    wasmUrl: pdfjsAssetUrl('wasm'),
    verbosity: 0,
  });
  let pdf: Awaited<typeof loadingTask.promise>;
  try {
    pdf = await loadingTask.promise;
  } catch (err) {
    await loadingTask.destroy().catch(() => {});
    const name = errorName(err);
    const msg = errorMessage(err);
    if (name === 'PasswordException') {
      run.warnings.push('The PDF is password-protected; nothing could be extracted.');
      return [];
    }
    if (name === 'InvalidPDFException') throw new DocumentError('invalid_pdf', `The file is not a readable PDF (${msg}).`);
    throw new DocumentError('pdf_failed', `The PDF could not be opened (${msg}).`);
  }
  try {
    const total = pdf.numPages;
    const pages: ExtractedPage[] = [];
    run.progress(0, total, `Rendering ${total} page${total === 1 ? '' : 's'}`);
    const scale = run.opts.renderDpi / 72;
    for (let n = 1; n <= total; n++) {
      throwIfAborted(run.signal);
      let imagePath: string | null = null;
      let width = 0;
      let height = 0;
      let png: Buffer | null = null;
      let text: string | null = null;
      let textSource: TextSource = 'none';
      let ocrConfidence: number | null = null;
      let page: Awaited<ReturnType<typeof pdf.getPage>> | null = null;
      try {
        page = await pdf.getPage(n);
        const viewport = page.getViewport({ scale });
        width = Math.max(1, Math.round(viewport.width));
        height = Math.max(1, Math.round(viewport.height));
        try {
          png = await renderPdfPage(page, viewport, width, height);
          imagePath = join(run.pagesDir, pageImageName(n));
          await writeFile(imagePath, png);
          run.written.push(imagePath);
        } catch (err) {
          if (err instanceof MediaToolError && err.code === 'aborted') throw err;
          run.warnings.push(`Page ${n} could not be rendered (${errorMessage(err)}).`);
          imagePath = null;
          png = null;
        }
        throwIfAborted(run.signal);
        let layerText = '';
        try {
          layerText = await readPdfTextLayer(page);
        } catch (err) {
          run.warnings.push(`Page ${n}: the text layer could not be read (${errorMessage(err)}).`);
        }
        if (layerText.length > 0) {
          text = layerText;
          textSource = 'pdf_text';
        } else if (png) {
          const ocr = await ocrPage(run, n, png);
          text = ocr.text;
          textSource = ocr.textSource;
          ocrConfidence = ocr.ocrConfidence;
        } else {
          run.warnings.push(`Page ${n} has no text layer and no image to read.`);
        }
      } catch (err) {
        if (err instanceof MediaToolError && err.code === 'aborted') throw err;
        run.warnings.push(`Page ${n} could not be processed (${errorMessage(err)}).`);
      } finally {
        page?.cleanup();
      }
      pages.push({ pageNumber: n, imagePath, width, height, text, textSource, ocrConfidence });
      run.progress(n, total, `Page ${n} of ${total}`);
    }
    return pages;
  } finally {
    await loadingTask.destroy().catch(() => {});
  }
}

type PdfPage = Awaited<ReturnType<Awaited<ReturnType<PdfJs['getDocument']>['promise']>['getPage']>>;
type PdfViewport = ReturnType<PdfPage['getViewport']>;

async function renderPdfPage(page: PdfPage, viewport: PdfViewport, width: number, height: number): Promise<Buffer> {
  const { createCanvas } = await import('@napi-rs/canvas');
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  // pdfjs types name DOM canvas classes; the Node canvas factory accepts @napi-rs/canvas objects.
  const renderParams = { canvas, canvasContext: ctx, viewport, intent: 'print' } as unknown as Parameters<PdfPage['render']>[0];
  await page.render(renderParams).promise;
  return canvas.toBuffer('image/png');
}

/** Joins the text layer in reading order as pdfjs reports it; lines end where items say they do. */
async function readPdfTextLayer(page: PdfPage): Promise<string> {
  const content = await page.getTextContent();
  let out = '';
  for (const item of content.items) {
    if (!('str' in item)) continue;
    out += item.str;
    if (item.hasEOL) out += '\n';
  }
  return normaliseText(out);
}

async function ocrPage(run: Extraction, pageNumber: number, png: Buffer): Promise<{ text: string | null; textSource: TextSource; ocrConfidence: number | null }> {
  if (run.opts.ocr === 'off') {
    run.warnings.push(`Page ${pageNumber} has no text layer; OCR is off.`);
    return { text: null, textSource: 'none', ocrConfidence: null };
  }
  const availability = ocrAvailability();
  if (!availability.available) {
    if (!run.ocrUnavailableNoted) {
      run.ocrUnavailableNoted = true;
      run.warnings.push(availability.reason ?? 'OCR engine not available.');
    }
    run.warnings.push(`Page ${pageNumber} has no text layer (OCR engine not available).`);
    return { text: null, textSource: 'none', ocrConfidence: null };
  }
  try {
    run.ocrEngine ??= await createOcrEngine({ signal: run.signal });
    run.progress(pageNumber - 1, Number.MAX_SAFE_INTEGER, `OCR on page ${pageNumber}`);
    const r = await run.ocrEngine.recognize(png);
    run.ocrUsed = true;
    if (r.text.length === 0) {
      run.warnings.push(`Page ${pageNumber} has no text layer and OCR found no text.`);
      return { text: null, textSource: 'none', ocrConfidence: r.confidence };
    }
    return { text: r.text, textSource: 'ocr', ocrConfidence: r.confidence };
  } catch (err) {
    if (err instanceof MediaToolError && err.code === 'aborted') throw err;
    run.warnings.push(`Page ${pageNumber}: OCR failed (${errorMessage(err)}).`);
    return { text: null, textSource: 'none', ocrConfidence: null };
  }
}

// ---------------------------------------------------------------------------
// Plain text and .docx

async function extractText(path: string, run: Extraction): Promise<ExtractedPage[]> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    throw new DocumentError('text_failed', `The text file could not be read (${errorMessage(err)}).`);
  }
  return pagesFromText(raw, run);
}

async function extractDocx(path: string, run: Extraction): Promise<ExtractedPage[]> {
  let value: string;
  try {
    const mammoth = (await import('mammoth')).default;
    const r = await mammoth.extractRawText({ path });
    value = r.value;
    for (const m of r.messages) run.warnings.push(`docx: ${m.message}`);
  } catch (err) {
    throw new DocumentError('docx_failed', `The .docx could not be converted to text (${errorMessage(err)}).`);
  }
  if (value.trim().length === 0) run.warnings.push('The .docx contains no text (images and drawings are not extracted).');
  return pagesFromText(value, run);
}

/** Splits text into pages of `linesPerPage` lines (CONTRACTS §15.5); a page is `pdf_text` because the text is authoritative, not recognised. */
export function paginateText(raw: string, linesPerPage: number): string[][] {
  const lines = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += linesPerPage) pages.push(lines.slice(i, i + linesPerPage));
  if (pages.length === 0) pages.push([]);
  return pages;
}

async function pagesFromText(raw: string, run: Extraction): Promise<ExtractedPage[]> {
  const chunks = paginateText(raw, run.opts.linesPerPage);
  const total = chunks.length;
  const pages: ExtractedPage[] = [];
  run.progress(0, total, `Laying out ${total} page${total === 1 ? '' : 's'}`);
  for (let i = 0; i < total; i++) {
    throwIfAborted(run.signal);
    const n = i + 1;
    const lines = chunks[i] as string[];
    const text = normaliseText(lines.join('\n'));
    let imagePath: string | null = null;
    const scale = run.opts.renderDpi / 72;
    const width = Math.round(LETTER_PT.width * scale);
    const height = Math.round(LETTER_PT.height * scale);
    try {
      const png = await renderTextPage(lines, run.opts.renderDpi);
      imagePath = join(run.pagesDir, pageImageName(n));
      await writeFile(imagePath, png);
      run.written.push(imagePath);
    } catch (err) {
      run.warnings.push(`Page ${n} could not be rendered (${errorMessage(err)}).`);
    }
    if (text.length === 0) run.warnings.push(total === 1 ? 'The document is empty.' : `Page ${n} is empty.`);
    pages.push({
      pageNumber: n,
      imagePath,
      width,
      height,
      text: text.length > 0 ? text : null,
      textSource: text.length > 0 ? 'pdf_text' : 'none',
      ocrConfidence: null,
    });
    run.progress(n, total, `Page ${n} of ${total}`);
  }
  return pages;
}

/** Draws lines of text on a white Letter page in a monospace face; long lines are wrapped, overflow is clipped. */
async function renderTextPage(lines: string[], renderDpi: number): Promise<Buffer> {
  const { createCanvas } = await import('@napi-rs/canvas');
  const scale = renderDpi / 72;
  const width = Math.round(LETTER_PT.width * scale);
  const height = Math.round(LETTER_PT.height * scale);
  const margin = 54 * scale;
  const fontPx = 10 * scale;
  const lineHeight = 11 * scale;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#000000';
  ctx.font = `${fontPx}px monospace`;
  ctx.textBaseline = 'top';
  const charWidth = Math.max(1, ctx.measureText('M').width);
  const maxChars = Math.max(1, Math.floor((width - 2 * margin) / charWidth));
  let y = margin;
  for (const line of lines) {
    const pieces = line.length === 0 ? [''] : chunkString(line.replace(/\t/g, '    '), maxChars);
    for (const piece of pieces) {
      if (y + lineHeight > height - margin) return canvas.toBuffer('image/png');
      if (piece.length > 0) ctx.fillText(piece, margin, y);
      y += lineHeight;
    }
  }
  return canvas.toBuffer('image/png');
}

function chunkString(s: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out;
}

// ---------------------------------------------------------------------------

export function normaliseText(s: string): string {
  return normaliseOcrText(s);
}

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err === 'object' && err !== null && 'name' in err ? String((err as { name: unknown }).name) : '';
}

function errorMessage(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  return m.split('\n')[0] ?? m;
}
