import type { HashResponse } from './sha256.worker';

/** Above this size the hash is skipped: `crypto.subtle.digest` needs the whole file in memory. */
export const SHA256_LIMIT_BYTES = 2 * 1024 ** 3;

export type HashResult = { sha256: string; skipped: false } | { sha256: null; skipped: true; reason: string };

export type Hasher = (file: File) => Promise<HashResult>;

/** Vite bundles the worker from this URL; tests inject a fake hasher instead. */
function createWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  try {
    return new Worker(new URL('./sha256.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
}

/**
 * sha256 of the file in a Web Worker (CONTRACTS §14.1 duplicate detection happens on
 * `createUpload` when the hash is known). Files at or above `limitBytes` are not hashed and
 * the result says so; the server still hashes the stored file on `complete`.
 */
export const hashFileInWorker: Hasher = (file: File) =>
  new Promise<HashResult>((resolve) => {
    if (file.size >= SHA256_LIMIT_BYTES) {
      resolve({ sha256: null, skipped: true, reason: `Files of 2 GB or more are not hashed in the browser; duplicates are detected by the server after the upload completes.` });
      return;
    }
    const worker = createWorker();
    if (!worker) {
      resolve({ sha256: null, skipped: true, reason: 'This browser cannot run the hashing worker; duplicates are detected by the server after the upload completes.' });
      return;
    }
    worker.onmessage = (event: MessageEvent<HashResponse>) => {
      worker.terminate();
      if (event.data.ok) resolve({ sha256: event.data.sha256, skipped: false });
      else resolve({ sha256: null, skipped: true, reason: `Hashing failed (${event.data.reason}); duplicates are detected by the server after the upload completes.` });
    };
    worker.onerror = () => {
      worker.terminate();
      resolve({ sha256: null, skipped: true, reason: 'The hashing worker failed; duplicates are detected by the server after the upload completes.' });
    };
    worker.postMessage({ file });
  });
