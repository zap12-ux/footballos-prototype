import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { MediaToolError } from './ffmpeg.ts';

/**
 * Offline OCR through tesseract.js (Apache-2.0). The English model comes from the
 * `@tesseract.js-data/eng` npm package (MIT wrapper around the Apache-2.0 tessdata
 * files), read from node_modules with `langPath`; `cacheMethod: 'none'` keeps
 * tesseract.js from writing a copy next to the process. No network access: the
 * WASM core is `tesseract.js-core` on disk and a local `langPath` makes the worker
 * read `eng.traineddata.gz` with `fs.readFile` instead of fetching the CDN.
 *
 * OCR output is untrusted text: it is stored and shown, never interpreted as an
 * instruction.
 */

const require = createRequire(import.meta.url);

export const OCR_LANGUAGE = 'eng';

export interface OcrAvailability {
  available: boolean;
  /** Plain-language reason when `available` is false. */
  reason: string | null;
  /** Directory holding `eng.traineddata.gz`, when available. */
  langPath: string | null;
  engine: 'tesseract.js' | null;
}

let cachedAvailability: OcrAvailability | null = null;

/** Finds the engine and the English model on disk. Never downloads anything. */
export function ocrAvailability(): OcrAvailability {
  if (cachedAvailability) return cachedAvailability;
  let langPath: string | null = null;
  try {
    const dataRoot = dirname(require.resolve('@tesseract.js-data/eng/package.json'));
    // tesseract.js pairs its default LSTM-only core with the `4.0.0_best_int` files; fall back to the full set.
    for (const candidate of ['4.0.0_best_int', '4.0.0']) {
      const dir = join(dataRoot, candidate);
      if (existsSync(join(dir, `${OCR_LANGUAGE}.traineddata.gz`))) {
        langPath = dir;
        break;
      }
    }
  } catch {
    langPath = null;
  }
  let engineFound = false;
  try {
    require.resolve('tesseract.js/package.json');
    require.resolve('tesseract.js-core/package.json');
    engineFound = true;
  } catch {
    engineFound = false;
  }
  if (!engineFound) {
    cachedAvailability = { available: false, reason: 'OCR engine not available (tesseract.js is not installed).', langPath: null, engine: null };
  } else if (!langPath) {
    cachedAvailability = { available: false, reason: 'OCR engine not available (English language data @tesseract.js-data/eng is not installed).', langPath: null, engine: null };
  } else {
    cachedAvailability = { available: true, reason: null, langPath, engine: 'tesseract.js' };
  }
  return cachedAvailability;
}

export interface OcrPageResult {
  /** Recognised text with line breaks; empty when nothing was found. */
  text: string;
  /** Mean word confidence as reported by Tesseract, scaled to 0..1. */
  confidence: number;
}

export interface OcrEngine {
  recognize(png: Buffer): Promise<OcrPageResult>;
  terminate(): Promise<void>;
}

export interface OcrEngineOptions {
  signal?: AbortSignal;
}

/**
 * Starts one tesseract.js worker (a `worker_threads` thread) with the local English
 * model. The caller must `terminate()` it. An abort of `signal` terminates the worker,
 * which rejects any recognition in flight with `MediaToolError('aborted')`.
 */
export async function createOcrEngine(options: OcrEngineOptions = {}): Promise<OcrEngine> {
  const availability = ocrAvailability();
  if (!availability.available || !availability.langPath) {
    throw new MediaToolError('ocr_unavailable', availability.reason ?? 'OCR engine not available', [], '');
  }
  if (options.signal?.aborted) throw new MediaToolError('aborted', 'OCR aborted before the engine started', [], '');
  const tesseract = (await import('tesseract.js')).default;
  const worker = await tesseract.createWorker(OCR_LANGUAGE, tesseract.OEM.LSTM_ONLY, {
    langPath: availability.langPath,
    gzip: true,
    cacheMethod: 'none',
    logger: () => {},
    errorHandler: () => {},
  });
  let terminated = false;
  let aborted = false;
  const terminate = async (): Promise<void> => {
    if (terminated) return;
    terminated = true;
    try {
      await worker.terminate();
    } catch {
      // The thread is gone either way.
    }
  };
  const onAbort = () => {
    aborted = true;
    void terminate();
  };
  options.signal?.addEventListener('abort', onAbort, { once: true });
  return {
    async recognize(png: Buffer): Promise<OcrPageResult> {
      if (aborted || options.signal?.aborted) throw new MediaToolError('aborted', 'OCR aborted', [], '');
      if (terminated) throw new MediaToolError('ocr_unavailable', 'OCR engine already terminated', [], '');
      try {
        const r = await worker.recognize(png);
        const text = normaliseOcrText(r.data.text ?? '');
        const raw = typeof r.data.confidence === 'number' && Number.isFinite(r.data.confidence) ? r.data.confidence : 0;
        return { text, confidence: Math.min(1, Math.max(0, raw / 100)) };
      } catch (err) {
        if (aborted || options.signal?.aborted) throw new MediaToolError('aborted', 'OCR aborted', [], '');
        throw err;
      }
    },
    async terminate(): Promise<void> {
      options.signal?.removeEventListener('abort', onAbort);
      await terminate();
    },
  };
}

/** Trims trailing spaces per line, collapses runs of blank lines, trims the whole. */
export function normaliseOcrText(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t\f\v]+$/g, '').replace(/^[ \t\f\v]+/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
