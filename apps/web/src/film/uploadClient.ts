/**
 * Resumable chunked upload client (CONTRACTS §14.1).
 *
 * 1. (optional) sha256 in a Web Worker so an exact duplicate is refused before any byte moves.
 * 2. `POST /games/:gameId/uploads` → `{ upload, asset }`; `409` with `existingAssetId` = duplicate.
 * 3. `PUT /uploads/:id` with `Content-Range: bytes start-end/total` for each `file.slice`, never
 *    larger than the server's `chunkSizeBytes`. A `409` with `details.receivedBytes` means the
 *    server is elsewhere (another tab, a retried request): the client continues from there.
 *    Network failures retry with backoff. Cancel takes effect at the next chunk boundary.
 * 4. `POST /uploads/:id/complete` → `{ asset, jobs }`; a `409` duplicate here (server-side hash)
 *    is reported the same way as in step 2.
 *
 * Everything the UI shows comes from `onProgress`; the registry remembers the upload until it
 * completes, is canceled, or is refused, so a reload can resume it.
 */
import type { Api, CreateUploadInput } from '../api/api';
import { ApiError } from '../api/api';
import type { MediaAsset, ProcessingJob, Upload, UploadContext } from '../api/contracts';
import type { HashResult, Hasher } from './sha256';
import { hashFileInWorker } from './sha256';
import { createUploadRegistry, fileMatches, type InFlightUpload, type UploadRegistry } from './uploadRegistry';

export const DEFAULT_CHUNK_BYTES = 8 * 1024 ** 2;

export type UploadPhase = 'hashing' | 'creating' | 'uploading' | 'completing' | 'done' | 'duplicate' | 'canceled' | 'error';

export interface UploadProgress {
  phase: UploadPhase;
  sentBytes: number;
  totalBytes: number;
  /** Plain words about what is happening (hash skipped and why, retrying, resumed from …). */
  note: string | null;
}

export type UploadOutcome =
  | { kind: 'completed'; asset: MediaAsset; jobs: ProcessingJob[] }
  | { kind: 'duplicate'; existingAssetId: string; message: string }
  | { kind: 'canceled'; uploadId: string | null }
  | { kind: 'error'; error: unknown; uploadId: string | null };

export interface UploadHandle {
  result: Promise<UploadOutcome>;
  cancel(): void;
}

export interface UploadClientOptions {
  hasher?: Hasher;
  registry?: UploadRegistry;
  /** Used only until the server answers with its own `chunkSizeBytes`. */
  chunkBytes?: number;
  /** Backoff base for network retries (tests shorten it). */
  retryDelayMs?: number;
  maxNetworkRetries?: number;
  onProgress?: (progress: UploadProgress) => void;
}

export interface StartUploadInput {
  gameId: string;
  file: File;
  context: UploadContext;
}

export interface ResumeUploadInput {
  record: InFlightUpload;
  file: File;
}

class Canceled extends Error {
  constructor() {
    super('Upload canceled');
    this.name = 'Canceled';
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function isNetworkError(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'provider_unavailable' && error.details.retryable === true;
}

function duplicateOf(error: unknown): { existingAssetId: string; message: string } | null {
  if (error instanceof ApiError && error.status === 409 && typeof error.details.existingAssetId === 'string') {
    return { existingAssetId: error.details.existingAssetId, message: error.message };
  }
  return null;
}

/** The byte ranges `PUT` will send, from `from` to the end of the file (end is inclusive). */
export function chunkRanges(totalBytes: number, chunkBytes: number, from = 0): { start: number; end: number }[] {
  if (chunkBytes <= 0) throw new Error('chunkBytes must be positive');
  const ranges: { start: number; end: number }[] = [];
  for (let start = from; start < totalBytes; start += chunkBytes) ranges.push({ start, end: Math.min(start + chunkBytes, totalBytes) - 1 });
  return ranges;
}

export function createUploadClient(api: Api, options: UploadClientOptions = {}) {
  const hasher = options.hasher ?? hashFileInWorker;
  const registry = options.registry ?? createUploadRegistry();
  const retryDelayMs = options.retryDelayMs ?? 1000;
  const maxNetworkRetries = options.maxNetworkRetries ?? 5;
  const listeners = new Set<(progress: UploadProgress) => void>();
  const report = (progress: UploadProgress) => {
    options.onProgress?.(progress);
    listeners.forEach((l) => l(progress));
  };

  function run(start: () => Promise<{ upload: Upload; asset: MediaAsset | null; file: File; note: string | null }>, controller: AbortController): UploadHandle {
    let uploadId: string | null = null;

    const result = (async (): Promise<UploadOutcome> => {
      try {
        const { upload, file, note } = await start();
        uploadId = upload.id;
        const total = upload.totalBytes;
        const chunkBytes = upload.chunkSizeBytes > 0 ? upload.chunkSizeBytes : (options.chunkBytes ?? DEFAULT_CHUNK_BYTES);
        let offset = upload.receivedBytes;
        let networkRetries = 0;
        let sameOffsetConflicts = 0;
        report({ phase: 'uploading', sentBytes: offset, totalBytes: total, note });

        while (offset < total) {
          if (controller.signal.aborted) throw new Canceled();
          const end = Math.min(offset + chunkBytes, total) - 1;
          try {
            const { receivedBytes } = await api.media.putChunk(upload.id, { start: offset, end, total }, file.slice(offset, end + 1));
            offset = receivedBytes;
            networkRetries = 0;
            sameOffsetConflicts = 0;
            report({ phase: 'uploading', sentBytes: offset, totalBytes: total, note: null });
          } catch (error) {
            if (error instanceof ApiError && error.status === 409 && typeof error.details.receivedBytes === 'number') {
              const serverOffset = error.details.receivedBytes;
              sameOffsetConflicts = serverOffset === offset ? sameOffsetConflicts + 1 : 0;
              if (sameOffsetConflicts >= 3) throw new Error('The server keeps refusing this range; the upload cannot continue from here.');
              offset = serverOffset;
              report({ phase: 'uploading', sentBytes: offset, totalBytes: total, note: `Continuing from ${offset.toLocaleString()} bytes (the server had a different position).` });
              continue;
            }
            if (isNetworkError(error) && networkRetries < maxNetworkRetries) {
              networkRetries += 1;
              const delay = retryDelayMs * 2 ** (networkRetries - 1);
              report({ phase: 'uploading', sentBytes: offset, totalBytes: total, note: `Connection lost; retrying in ${Math.round(delay / 1000)} s (attempt ${networkRetries} of ${maxNetworkRetries}).` });
              await sleep(delay);
              continue;
            }
            throw error;
          }
        }

        if (controller.signal.aborted) throw new Canceled();
        report({ phase: 'completing', sentBytes: total, totalBytes: total, note: 'All bytes received; the server is checking the file.' });
        const completed = await api.media.completeUpload(upload.id);
        registry.forget(upload.id);
        report({ phase: 'done', sentBytes: total, totalBytes: total, note: null });
        return { kind: 'completed', asset: completed.asset, jobs: completed.jobs };
      } catch (error) {
        if (error instanceof Canceled || controller.signal.aborted) {
          report({ phase: 'canceled', sentBytes: 0, totalBytes: 0, note: 'Upload canceled. The partial file stays on the server until it expires; you can resume it from this page.' });
          return { kind: 'canceled', uploadId };
        }
        const duplicate = duplicateOf(error);
        if (duplicate) {
          if (uploadId) registry.forget(uploadId);
          report({ phase: 'duplicate', sentBytes: 0, totalBytes: 0, note: duplicate.message });
          return { kind: 'duplicate', ...duplicate };
        }
        report({ phase: 'error', sentBytes: 0, totalBytes: 0, note: error instanceof Error ? error.message : String(error) });
        return { kind: 'error', error, uploadId };
      }
    })();

    return { result, cancel: () => controller.abort() };
  }

  return {
    /** A new upload: hash (when small enough), create, send ranges, complete. */
    start(input: StartUploadInput): UploadHandle {
      const controller = new AbortController();
      return run(async () => {
        const { file, gameId, context } = input;
        report({ phase: 'hashing', sentBytes: 0, totalBytes: file.size, note: file.size >= 2 * 1024 ** 3 ? null : 'Computing the file fingerprint (sha256) to detect duplicates before sending.' });
        const hash: HashResult = await hasher(file);
        if (controller.signal.aborted) throw new Canceled();
        report({ phase: 'creating', sentBytes: 0, totalBytes: file.size, note: hash.skipped ? hash.reason : null });
        const request: CreateUploadInput = { filename: file.name, byteSize: file.size, mimeType: file.type || 'application/octet-stream', context };
        if (!hash.skipped) request.sha256 = hash.sha256;
        const created = await api.media.createUpload(gameId, request);
        registry.remember({ uploadId: created.upload.id, assetId: created.asset.id, gameId, filename: file.name, byteSize: file.size, lastModified: file.lastModified, startedAt: new Date().toISOString() });
        return { upload: created.upload, asset: created.asset, file, note: hash.skipped ? hash.reason : null };
      }, controller);
    },

    /** Resume after a reload: ask the server where it is, then continue from there. */
    resume(input: ResumeUploadInput): UploadHandle {
      const controller = new AbortController();
      return run(async () => {
        const { record, file } = input;
        if (!fileMatches(record, file)) {
          throw new ApiError('validation_error', `That is not the same file: the interrupted upload was "${record.filename}" (${record.byteSize.toLocaleString()} bytes).`, 400);
        }
        let upload: Upload;
        try {
          upload = await api.media.getUpload(record.uploadId);
        } catch (error) {
          if (error instanceof ApiError && error.status === 404) registry.forget(record.uploadId);
          throw error;
        }
        if (upload.completedAt) {
          registry.forget(record.uploadId);
          throw new ApiError('conflict', 'This upload already completed on the server.', 409, { existingAssetId: upload.assetId });
        }
        return { upload, asset: null, file, note: `Resuming from ${upload.receivedBytes.toLocaleString()} of ${upload.totalBytes.toLocaleString()} bytes.` };
      }, controller);
    },

    registry,

    /** Subscribe to progress of every upload started through this client; returns unsubscribe. */
    onProgress(listener: (progress: UploadProgress) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type UploadClient = ReturnType<typeof createUploadClient>;
