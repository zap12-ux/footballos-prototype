/**
 * A fake `fetch` that behaves like the §14.1 upload routes of apps/api: create, PUT ranges
 * (contiguous only; 409 with `receivedBytes` otherwise), GET for resume, complete with the
 * duplicate check. Records every request so tests can assert headers and bodies.
 */
import type { MediaAsset, ProcessingJob, Upload } from '../../api/contracts';

export interface RecordedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  bodyBytes: number | null;
}

export interface FakeUploadServer {
  fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  requests: RecordedRequest[];
  uploads: Map<string, Upload & { received: Uint8Array }>;
  /** Hashes the server already has (duplicate detection on create and on complete). */
  knownHashes: Map<string, string>;
  chunkSizeBytes: number;
  /** Fail the next N PUTs with a network error. */
  failNextPuts: number;
  /** Pretend another client already sent bytes up to this offset before the next PUT. */
  jumpReceivedTo: number | null;
}

/** jsdom's Blob has no `arrayBuffer()`; read it the way a browser of that era would. */
function blobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer().then((b) => new Uint8Array(b));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const envelope = (status: number, code: string, message: string, details?: Record<string, unknown>) => json(status, { error: { code, message, ...(details ? { details } : {}) } });

export function createFakeUploadServer(options: { chunkSizeBytes?: number } = {}): FakeUploadServer {
  const server: FakeUploadServer = {
    requests: [],
    uploads: new Map(),
    knownHashes: new Map(),
    chunkSizeBytes: options.chunkSizeBytes ?? 1024,
    failNextPuts: 0,
    jumpReceivedTo: null,
    fetch: async (input, init = {}) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init.method ?? 'GET').toUpperCase();
      const headers: Record<string, string> = {};
      new Headers(init.headers).forEach((v, k) => (headers[k.toLowerCase()] = v));
      const body = init.body;
      const bodyBytes = body instanceof Blob ? body.size : typeof body === 'string' ? body.length : null;
      server.requests.push({ method, url, headers, bodyBytes });
      const path = url.replace(/^https?:\/\/[^/]+/, '');

      const create = /^\/api\/v1\/games\/([^/]+)\/uploads$/.exec(path);
      if (create && method === 'POST') {
        const req = JSON.parse(String(body)) as { filename: string; byteSize: number; mimeType: string; sha256?: string };
        if (req.sha256 && server.knownHashes.has(req.sha256)) return envelope(409, 'conflict', 'Duplicate file', { existingAssetId: server.knownHashes.get(req.sha256) });
        const id = `up-${server.uploads.size + 1}`;
        const upload: Upload & { received: Uint8Array } = { id, assetId: `asset-${id}`, teamId: 'team', chunkSizeBytes: server.chunkSizeBytes, receivedBytes: 0, totalBytes: req.byteSize, expiresAt: new Date(Date.now() + 3_600_000).toISOString(), completedAt: null, received: new Uint8Array(req.byteSize) };
        server.uploads.set(id, upload);
        const asset = { id: upload.assetId, originalFilename: req.filename, byteSize: req.byteSize, status: 'uploading' } as MediaAsset;
        const { received: _r, ...pub } = upload;
        return json(201, { upload: pub, asset });
      }

      const one = /^\/api\/v1\/uploads\/([^/]+)(\/complete)?$/.exec(path);
      if (one) {
        const upload = server.uploads.get(one[1]);
        if (!upload) return envelope(404, 'not_found', 'Upload not found');
        const { received: _r, ...pub } = upload;
        if (method === 'GET') return json(200, { upload: pub });
        if (method === 'PUT') {
          if (server.failNextPuts > 0) {
            server.failNextPuts -= 1;
            throw new TypeError('Failed to fetch');
          }
          if (server.jumpReceivedTo !== null) {
            upload.receivedBytes = server.jumpReceivedTo;
            server.jumpReceivedTo = null;
          }
          const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(headers['content-range'] ?? '');
          if (!m) return envelope(400, 'validation_error', 'Content-Range required');
          const [start, end, total] = [Number(m[1]), Number(m[2]), Number(m[3])];
          if (total !== upload.totalBytes) return envelope(400, 'validation_error', 'total mismatch');
          if (end - start + 1 > server.chunkSizeBytes) return envelope(413, 'payload_too_large', 'chunk too large');
          if (start !== upload.receivedBytes) return envelope(409, 'conflict', 'not contiguous', { receivedBytes: upload.receivedBytes });
          const bytes = await blobBytes(body as Blob);
          if (bytes.length !== end - start + 1) return envelope(400, 'validation_error', 'body length mismatch');
          upload.received.set(bytes, start);
          upload.receivedBytes = end + 1;
          return json(200, { receivedBytes: upload.receivedBytes });
        }
        if (method === 'POST' && one[2]) {
          if (upload.receivedBytes !== upload.totalBytes) return envelope(409, 'conflict', 'incomplete', { receivedBytes: upload.receivedBytes });
          const hash = `server-hash-of-${upload.totalBytes}`;
          if (server.knownHashes.has(hash)) return envelope(409, 'conflict', 'Duplicate file', { existingAssetId: server.knownHashes.get(hash) });
          upload.completedAt = new Date().toISOString();
          const asset = { id: upload.assetId, status: 'uploaded', byteSize: upload.totalBytes } as MediaAsset;
          const jobs = [{ id: 'job-validate', kind: 'validate', status: 'queued' } as ProcessingJob];
          return json(200, { asset, jobs });
        }
      }
      return envelope(404, 'not_found', `No route for ${method} ${path}`);
    },
  };
  return server;
}

/** A File of `size` bytes with a recognisable pattern (byte i = i mod 251). */
export function makeFile(size: number, name = 'clip.mp4', lastModified = 1_700_000_000_000): File {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) bytes[i] = i % 251;
  return new File([bytes], name, { type: 'video/mp4', lastModified });
}
