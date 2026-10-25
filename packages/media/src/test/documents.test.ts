import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PlaybookPageSchema } from '@footballos/contracts';
import { createDocumentHandlers, PAGES_FILENAME, registerDocumentHandlers, type PagesFile } from '../document-handlers.ts';
import { DocumentError, extractDocument, paginateText } from '../documents.ts';
import { InMemoryJobStore } from '../jobs/memory-store.ts';
import { idempotencyKeyFor, JobRunner } from '../jobs/runner.ts';
import { ocrAvailability } from '../ocr.ts';
import { ensureDocumentFixtures, PLAY_LIST, TERMS } from './document-fixtures.ts';
import { DATA_DIR, DOCUMENTS_DIR } from './fixtures.ts';

const OUT = join(DATA_DIR, 'documents-out');
const TEAM = 'team-test';
const USER = 'user-test';

function pngDimensions(buf: Buffer): { width: number; height: number } {
  // IHDR is the first chunk: width and height are big-endian at bytes 16..24.
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

async function fresh(name: string): Promise<string> {
  const dir = join(OUT, name);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  return dir;
}

describe('extractDocument', () => {
  it('reads the text layer of a 3-page PDF and renders each page at 110 dpi', async () => {
    const fx = await ensureDocumentFixtures(DOCUMENTS_DIR);
    const outDir = await fresh('playbook');
    const progress: Array<[number, number]> = [];
    const r = await extractDocument(fx.playbookPdf, outDir, { onProgress: (d, t) => progress.push([d, t]) });
    expect(r.pageCount).toBe(3);
    expect(r.sourceType).toBe('pdf');
    expect(r.warnings).toEqual([]);
    expect(r.pages.map((p) => p.pageNumber)).toEqual([1, 2, 3]);
    for (const p of r.pages) {
      expect(p.textSource).toBe('pdf_text');
      expect(p.ocrConfidence).toBeNull();
      expect(p.imagePath).toBe(join(outDir, 'pages', `page-${p.pageNumber}.png`));
      const png = await readFile(p.imagePath as string);
      const dims = pngDimensions(png);
      // Letter at 110 dpi: 612 * 110 / 72 = 935, 792 * 110 / 72 = 1210.
      expect(dims).toEqual({ width: 935, height: 1210 });
      expect(p.width).toBe(935);
      expect(p.height).toBe(1210);
    }
    expect(r.pages[0]?.text).toContain('Inside Zone Right');
    expect(r.pages[0]?.text).toContain('Formation: Trips Right');
    const list = r.pages[1]?.text ?? '';
    PLAY_LIST.forEach((name, i) => expect(list).toContain(`${i + 1}. ${name}`));
    const terms = r.pages[2]?.text ?? '';
    expect(terms.split('\n')[0]).toBe('Terms');
    for (const [term, def] of TERMS) expect(terms).toContain(`${term} — ${def}`);
    expect(r.ocr.used).toBe(false);
    expect(progress[0]).toEqual([0, 3]);
    expect(progress[progress.length - 1]).toEqual([3, 3]);
    // The rendered pages carry the drawn content (not blank): page 1 has a sketch and a heading.
    expect((await readFile(r.pages[0]?.imagePath as string)).length).toBeGreaterThan(10_000);
  });

  it('page images contain the text (checked by OCR when the engine is installed)', async () => {
    const fx = await ensureDocumentFixtures(DOCUMENTS_DIR);
    const outDir = await fresh('playbook-ocr-check');
    const r = await extractDocument(fx.playbookPdf, outDir, { ocr: 'off' });
    const a = ocrAvailability();
    if (!a.available) return;
    const { createOcrEngine } = await import('../ocr.ts');
    const engine = await createOcrEngine();
    try {
      const ocr = await engine.recognize(await readFile(r.pages[1]?.imagePath as string));
      expect(ocr.text).toContain('Power Left');
    } finally {
      await engine.terminate();
    }
  });

  it('an image-only page with ocr: off yields textSource none, null confidence and a warning', async () => {
    const fx = await ensureDocumentFixtures(DOCUMENTS_DIR);
    const outDir = await fresh('scan-off');
    const r = await extractDocument(fx.scanPdf, outDir, { ocr: 'off' });
    expect(r.pageCount).toBe(1);
    const p = r.pages[0];
    expect(p).toMatchObject({ pageNumber: 1, text: null, textSource: 'none', ocrConfidence: null });
    expect(existsSync(p?.imagePath as string)).toBe(true);
    expect(r.warnings).toEqual(['Page 1 has no text layer; OCR is off.']);
    expect(r.ocr).toEqual({ requested: 'off', engine: ocrAvailability().available ? 'tesseract.js' : null, used: false });
  });

  it('an image-only page with ocr: auto is read offline by tesseract.js (or reported as none when no engine)', async () => {
    const fx = await ensureDocumentFixtures(DOCUMENTS_DIR);
    const outDir = await fresh('scan-auto');
    const r = await extractDocument(fx.scanPdf, outDir, { ocr: 'auto' });
    const p = r.pages[0];
    expect(r.pageCount).toBe(1);
    const a = ocrAvailability();
    if (a.available) {
      expect(a.langPath).toContain('@tesseract.js-data/eng');
      expect(p?.textSource).toBe('ocr');
      expect(p?.text).toContain('Inside Zone Right');
      expect(p?.text).toContain('Power Left');
      expect(p?.ocrConfidence).toBeGreaterThan(0.5);
      expect(p?.ocrConfidence).toBeLessThanOrEqual(1);
      expect(r.ocr).toEqual({ requested: 'auto', engine: 'tesseract.js', used: true });
      expect(r.warnings).toEqual([]);
    } else {
      expect(p).toMatchObject({ text: null, textSource: 'none', ocrConfidence: null });
      expect(r.warnings.some((w) => w.startsWith('OCR engine not available'))).toBe(true);
    }
    // The contract's PlaybookPage (contracts package v0.4: ocrText, ocrConfidence 0..1) accepts what we produce.
    const parsed = PlaybookPageSchema.safeParse({
      id: randomUUID(),
      documentId: randomUUID(),
      pageNumber: p?.pageNumber,
      imageKey: p?.imagePath,
      ocrText: p?.text ?? null,
      ocrConfidence: p?.ocrConfidence ?? null,
    });
    expect(parsed.success, JSON.stringify(parsed.error)).toBe(true);
  });

  it('pages a .txt file 60 lines at a time, in order, with an image per page', async () => {
    const fx = await ensureDocumentFixtures(DOCUMENTS_DIR);
    const outDir = await fresh('notes-txt');
    const raw = await readFile(fx.notesTxt, 'utf8');
    const lines = raw.split('\n');
    lines.pop(); // trailing newline
    expect(lines.length).toBe(130);
    const r = await extractDocument(fx.notesTxt, outDir);
    expect(r.sourceType).toBe('text');
    expect(r.pageCount).toBe(3);
    expect(r.pages.map((p) => p.textSource)).toEqual(['pdf_text', 'pdf_text', 'pdf_text']);
    expect(r.pages[0]?.text?.split('\n')).toEqual(lines.slice(0, 60));
    expect(r.pages[1]?.text?.split('\n')).toEqual(lines.slice(60, 120));
    expect(r.pages[2]?.text?.split('\n')).toEqual(lines.slice(120, 130));
    for (const p of r.pages) {
      const dims = pngDimensions(await readFile(p.imagePath as string));
      expect(dims).toEqual({ width: 935, height: 1210 });
    }
    expect(r.warnings).toEqual([]);
  });

  it('converts a .docx through mammoth and pages the result', async () => {
    const fx = await ensureDocumentFixtures(DOCUMENTS_DIR);
    const outDir = await fresh('notes-docx');
    const r = await extractDocument(fx.notesDocx, outDir);
    expect(r.sourceType).toBe('docx');
    expect(r.pageCount).toBe(1);
    expect(r.pages[0]?.textSource).toBe('pdf_text');
    expect(r.pages[0]?.text).toContain('DEMO install notes');
    expect(r.pages[0]?.text).toContain('1. Inside Zone Right');
    expect(existsSync(r.pages[0]?.imagePath as string)).toBe(true);
  });

  it('rejects unsupported types, missing files and broken PDFs with a plain reason', async () => {
    const outDir = await fresh('rejects');
    await expect(extractDocument(join(DOCUMENTS_DIR, 'x.csv'), outDir)).rejects.toMatchObject({ code: 'unsupported_type' });
    await expect(extractDocument(join(DOCUMENTS_DIR, 'nope.pdf'), outDir)).rejects.toMatchObject({ code: 'source_missing' });
    const bad = join(outDir, 'bad.pdf');
    await writeFile(bad, 'this is not a pdf');
    const err = await extractDocument(bad, outDir).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DocumentError);
    expect((err as DocumentError).code).toBe('invalid_pdf');
    const badDocx = join(outDir, 'bad.docx');
    await writeFile(badDocx, 'not a zip');
    await expect(extractDocument(badDocx, outDir)).rejects.toMatchObject({ code: 'docx_failed' });
  });

  it('an empty text file is one page with no text and a warning', async () => {
    const outDir = await fresh('empty');
    const empty = join(outDir, 'empty.txt');
    await writeFile(empty, '');
    const r = await extractDocument(empty, outDir);
    expect(r.pageCount).toBe(1);
    expect(r.pages[0]).toMatchObject({ text: null, textSource: 'none', ocrConfidence: null });
    expect(r.warnings).toEqual(['The document is empty.']);
  });

  it('abort mid-render rejects with aborted and removes the pages already written', async () => {
    const fx = await ensureDocumentFixtures(DOCUMENTS_DIR);
    const outDir = await fresh('abort');
    const ctrl = new AbortController();
    const p = extractDocument(fx.playbookPdf, outDir, {
      signal: ctrl.signal,
      onProgress: (done) => {
        if (done === 1) ctrl.abort();
      },
    });
    await expect(p).rejects.toMatchObject({ code: 'aborted' });
    expect(await readdir(join(outDir, 'pages'))).toEqual([]);
  });

  it('paginateText splits exactly, keeps order and handles CRLF, BOM and a trailing newline', () => {
    expect(paginateText('', 60)).toEqual([[]]);
    expect(paginateText('a\nb\n', 60)).toEqual([['a', 'b']]);
    expect(paginateText('\uFEFFa\r\nb\r\nc', 2)).toEqual([['a', 'b'], ['c']]);
    const many = Array.from({ length: 121 }, (_, i) => `L${i + 1}`).join('\n');
    const pages = paginateText(many, 60);
    expect(pages.map((p) => p.length)).toEqual([60, 60, 1]);
    expect(pages[2]).toEqual(['L121']);
  });
});

describe('createDocumentHandlers', () => {
  const dataDir = OUT;

  it('extract_document writes pages/page-<n>.png and pages.json and returns the §15.5 shape', async () => {
    const fx = await ensureDocumentFixtures(DOCUMENTS_DIR);
    const outDir = join(dataDir, 'handler-playbook');
    await rm(outDir, { recursive: true, force: true });
    const store = new InMemoryJobStore();
    const runner = new JobRunner({ store, workerId: 'w-doc', leaseSec: 30 });
    registerDocumentHandlers(runner, createDocumentHandlers({ dataDir, ocr: 'off' }));
    const input = { assetId: 'asset-doc', sourcePath: fx.playbookPdf, outDir: 'handler-playbook' };
    const { job } = await runner.enqueue({ teamId: TEAM, assetId: 'asset-doc', kind: 'extract_document', input, requestedBy: USER, idempotencyKey: idempotencyKeyFor('extract_document', input, 'doc-v1'), configVersion: 'doc-v1' });
    const done = await runner.runOnce();
    expect(done?.id).toBe(job.id);
    expect(done?.status).toBe('succeeded');
    const result = done?.result as { pageCount: number; pages: Array<{ pageNumber: number; imagePath: string | null; width: number; height: number; text: string | null; textSource: string; ocrConfidence: number | null }>; warnings: string[]; pagesPath: string; pagesDir: string; renderDpi: number };
    expect(result.pageCount).toBe(3);
    expect(result.renderDpi).toBe(110);
    expect(result.warnings).toEqual([]);
    expect(result.pagesDir).toBe(join(outDir, 'pages'));
    expect(result.pagesPath).toBe(join(outDir, PAGES_FILENAME));
    expect((await readdir(join(outDir, 'pages'))).sort()).toEqual(['page-1.png', 'page-2.png', 'page-3.png']);
    for (const p of result.pages) {
      expect(p.imagePath).toBe(join(outDir, 'pages', `page-${p.pageNumber}.png`));
      expect(existsSync(p.imagePath as string)).toBe(true);
      expect(Object.keys(p).sort()).toEqual(['height', 'imagePath', 'ocrConfidence', 'pageNumber', 'text', 'textSource', 'width']);
    }
    const file = JSON.parse(await readFile(join(outDir, PAGES_FILENAME), 'utf8')) as PagesFile;
    expect(file.version).toBe(1);
    expect(file.assetId).toBe('asset-doc');
    expect(file.pageCount).toBe(3);
    expect(file.pages).toEqual(result.pages);
    expect(file.sourceType).toBe('pdf');
    // No staging left behind.
    expect((await readdir(outDir)).filter((f) => f.startsWith('.extract-'))).toEqual([]);
    expect(done?.progress.message).toBe('3 pages extracted');
  });

  it('a cancelled job leaves neither images nor pages.json nor a staging directory', async () => {
    const fx = await ensureDocumentFixtures(DOCUMENTS_DIR);
    const outDir = join(dataDir, 'handler-cancel');
    await rm(outDir, { recursive: true, force: true });
    const handlers = createDocumentHandlers({ dataDir, ocr: 'off' });
    const ctrl = new AbortController();
    const p = handlers.extract_document(
      { id: 'j-cancel', input: { assetId: 'asset-doc', sourcePath: fx.playbookPdf, outDir } },
      {
        signal: ctrl.signal,
        progress: (done) => {
          if (done === 1) ctrl.abort('cancel_requested');
        },
      },
    );
    await expect(p).rejects.toMatchObject({ code: 'aborted' });
    expect(existsSync(join(outDir, 'pages'))).toBe(false);
    expect(existsSync(join(outDir, PAGES_FILENAME))).toBe(false);
    expect(await readdir(outDir)).toEqual([]);
  });

  it('rejects a bad input shape and a missing source as non-retryable', async () => {
    const handlers = createDocumentHandlers({ dataDir });
    const ctx = { signal: new AbortController().signal, progress: () => {} };
    await expect(handlers.extract_document({ id: 'j-bad', input: { assetId: 'a' } as never }, ctx)).rejects.toMatchObject({ code: 'bad_input' });
    await expect(handlers.extract_document({ id: 'j-missing', input: { assetId: 'a', sourcePath: 'does-not-exist.pdf', outDir: 'x' } }, ctx)).rejects.toMatchObject({ code: 'source_missing' });
    await expect(handlers.extract_document({ id: 'j-type', input: { assetId: 'a', sourcePath: join(DOCUMENTS_DIR, 'demo-notes.docx').replace(/\.docx$/, '.txt'), outDir: 'x' } }, ctx)).resolves.toBeTruthy();
    const csv = join(OUT, 'x.csv');
    await writeFile(csv, 'a,b');
    await expect(handlers.extract_document({ id: 'j-csv', input: { assetId: 'a', sourcePath: csv, outDir: 'x' } }, ctx)).rejects.toMatchObject({ code: 'unsupported_type' });
  });

  it('re-running replaces the previous output as a unit', async () => {
    const fx = await ensureDocumentFixtures(DOCUMENTS_DIR);
    const outDir = join(dataDir, 'handler-rerun');
    await rm(outDir, { recursive: true, force: true });
    const handlers = createDocumentHandlers({ dataDir, ocr: 'off' });
    const ctx = { signal: new AbortController().signal, progress: () => {} };
    await handlers.extract_document({ id: 'j-1', input: { assetId: 'a', sourcePath: fx.playbookPdf, outDir } }, ctx);
    expect((await readdir(join(outDir, 'pages'))).length).toBe(3);
    const r2 = await handlers.extract_document({ id: 'j-2', input: { assetId: 'a', sourcePath: fx.scanPdf, outDir } }, ctx);
    expect(r2.pageCount).toBe(1);
    expect((await readdir(join(outDir, 'pages'))).sort()).toEqual(['page-1.png']);
  });
});
