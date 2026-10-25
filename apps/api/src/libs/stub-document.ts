/**
 * Local stand-in for `@footballos/media` `extractDocument` / `createDocumentHandlers` (CONTRACTS
 * §15.5) until C's implementation lands. It reads plain-text documents honestly (one page per 60
 * lines, `textSource: 'pdf_text'`) and, for PDFs, counts pages with `pdf-lib` but reads **no**
 * text and renders **no** image: every PDF page is `textSource: 'none'` with a warning that says
 * so. It never fabricates text.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import type { CreateDocumentHandlers, DocumentHandlers, ExtractDocument, ExtractDocumentResult, ExtractedPage } from './types.js';

export const STUB_EXTRACTOR_VERSION = 'stub-extract-1';
const LINES_PER_PAGE = 60;

export const TEXT_EXTENSIONS = new Set(['txt', 'md']);

export class DocumentRejectedError extends Error {
  readonly code = 'document_rejected';
  constructor(message: string) {
    super(message);
    this.name = 'DocumentRejectedError';
  }
}

function extOf(file: string): string {
  return path.extname(file).replace(/^\./, '').toLowerCase();
}

export const extractDocumentStub: ExtractDocument = async (file, outDir) => {
  const ext = extOf(file);
  fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
  let result: ExtractDocumentResult;
  if (TEXT_EXTENSIONS.has(ext)) {
    const text = fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
    const lines = text.split('\n');
    const pages: ExtractedPage[] = [];
    for (let i = 0; i < Math.max(1, lines.length); i += LINES_PER_PAGE) {
      const chunk = lines.slice(i, i + LINES_PER_PAGE).join('\n');
      pages.push({ pageNumber: pages.length + 1, imagePath: null, width: null, height: null, text: chunk, textSource: 'pdf_text', ocrConfidence: null });
    }
    result = { pageCount: pages.length, pages, warnings: ['Plain-text document: no page images were rendered.'] };
  } else if (ext === 'pdf') {
    let pageCount: number;
    try {
      const doc = await PDFDocument.load(fs.readFileSync(file), { ignoreEncryption: true, updateMetadata: false });
      pageCount = doc.getPageCount();
    } catch (err) {
      throw new DocumentRejectedError(`The PDF could not be opened: ${err instanceof Error ? err.message : String(err)}`);
    }
    const pages: ExtractedPage[] = [];
    for (let n = 1; n <= pageCount; n++) pages.push({ pageNumber: n, imagePath: null, width: null, height: null, text: null, textSource: 'none', ocrConfidence: null });
    result = {
      pageCount,
      pages,
      warnings: ['Document extraction is running on the API stub: PDF text layers are not read and pages are not rendered until @footballos/media extractDocument is installed. No text was invented.'],
    };
  } else {
    throw new DocumentRejectedError(`Unsupported document type ".${ext}"; accepted: pdf, txt, md`);
  }
  fs.writeFileSync(path.join(outDir, 'pages.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
  return result;
};

export const createDocumentHandlersStub: CreateDocumentHandlers = ({ dataDir }) => {
  const handlers: DocumentHandlers = {
    extract_document: async (job, ctx) => {
      const src = path.isAbsolute(job.input.sourcePath) ? job.input.sourcePath : path.join(dataDir, job.input.sourcePath);
      const out = path.isAbsolute(job.input.outDir) ? job.input.outDir : path.join(dataDir, job.input.outDir);
      if (ctx.signal.aborted) throw new Error('aborted');
      await ctx.progress(0, 1, 'reading document');
      const r = await extractDocumentStub(src, out);
      await ctx.progress(1, 1, `${r.pageCount} page(s)`);
      return r;
    },
  };
  return handlers;
};
