import { describe, expect, it } from 'vitest';
import { createHttpApi } from '../../api/http';
import { chunkRanges, createUploadClient, type UploadProgress } from '../../film/uploadClient';
import { createUploadRegistry } from '../../film/uploadRegistry';
import type { Hasher } from '../../film/sha256';
import { createFakeUploadServer, makeFile } from './fakeServer';

const context = { analyzedTeam: 'us' as const, analyzedUnit: 'mixed' as const, perspective: 'sideline_fixed' as const, teamCues: null };
const hashOf: Hasher = async (file) => ({ sha256: `client-hash-${file.size}`, skipped: false });
const noHash: Hasher = async () => ({ sha256: null, skipped: true, reason: 'test: hashing skipped' });

function setup(serverOptions: { chunkSizeBytes?: number } = {}, hasher: Hasher = hashOf) {
  const server = createFakeUploadServer(serverOptions);
  const api = createHttpApi({ fetchImpl: server.fetch });
  const registry = createUploadRegistry(null);
  const progress: UploadProgress[] = [];
  const client = createUploadClient(api, { hasher, registry, retryDelayMs: 1, onProgress: (p) => progress.push(p) });
  return { server, api, registry, client, progress };
}

describe('chunkRanges', () => {
  it('covers the file in contiguous inclusive ranges and can start from an offset', () => {
    expect(chunkRanges(10, 4)).toEqual([{ start: 0, end: 3 }, { start: 4, end: 7 }, { start: 8, end: 9 }]);
    expect(chunkRanges(10, 4, 8)).toEqual([{ start: 8, end: 9 }]);
    expect(chunkRanges(8, 4, 8)).toEqual([]);
  });
});

describe('resumable upload client against a fake §14.1 server', () => {
  it('sends the file in Content-Range chunks no larger than the server chunk size, then completes', async () => {
    const { server, client, progress } = setup({ chunkSizeBytes: 1000 });
    const file = makeFile(2500);
    const outcome = await client.start({ gameId: 'game-1', file, context }).result;
    expect(outcome.kind).toBe('completed');
    const puts = server.requests.filter((r) => r.method === 'PUT');
    expect(puts.map((r) => r.headers['content-range'])).toEqual(['bytes 0-999/2500', 'bytes 1000-1999/2500', 'bytes 2000-2499/2500']);
    expect(puts.map((r) => r.bodyBytes)).toEqual([1000, 1000, 500]);
    expect(puts.every((r) => r.headers['content-type'] === 'application/octet-stream')).toBe(true);
    // The server received exactly the file's bytes.
    const stored = server.uploads.get('up-1')!;
    expect(stored.received[0]).toBe(0);
    expect(stored.received[2499]).toBe(2499 % 251);
    expect(server.requests.at(-1)).toMatchObject({ method: 'POST', url: expect.stringMatching(/\/uploads\/up-1\/complete$/) });
    // Progress went hashing → creating → uploading … → completing → done, with byte counts.
    expect(progress.map((p) => p.phase)).toEqual(['hashing', 'creating', 'uploading', 'uploading', 'uploading', 'uploading', 'completing', 'done']);
    expect(progress.filter((p) => p.phase === 'uploading').map((p) => p.sentBytes)).toEqual([0, 1000, 2000, 2500]);
    // The client hash was sent so the server could refuse a duplicate before any byte moved.
    const create = server.requests.find((r) => r.method === 'POST')!;
    expect(create.url).toMatch(/\/games\/game-1\/uploads$/);
  });

  it('says so when the hash is skipped and still uploads', async () => {
    const { client, progress } = setup({}, noHash);
    const outcome = await client.start({ gameId: 'g', file: makeFile(100), context }).result;
    expect(outcome.kind).toBe('completed');
    expect(progress.find((p) => p.phase === 'creating')?.note).toMatch(/hashing skipped/);
  });

  it('reports a duplicate (409 with existingAssetId) before uploading and forgets the registry entry', async () => {
    const { server, client, registry, progress } = setup();
    server.knownHashes.set('client-hash-300', 'asset-existing');
    const outcome = await client.start({ gameId: 'g', file: makeFile(300), context }).result;
    expect(outcome).toMatchObject({ kind: 'duplicate', existingAssetId: 'asset-existing' });
    expect(server.requests.filter((r) => r.method === 'PUT')).toHaveLength(0);
    expect(registry.list()).toEqual([]);
    expect(progress.at(-1)?.phase).toBe('duplicate');
  });

  it('continues from the server position after a 409 with receivedBytes', async () => {
    const { server, client } = setup({ chunkSizeBytes: 100 });
    const file = makeFile(450);
    // Another client already pushed the first 200 bytes: the next PUT is refused with the real offset.
    server.jumpReceivedTo = 200;
    const outcome = await client.start({ gameId: 'g', file, context }).result;
    expect(outcome.kind).toBe('completed');
    const ranges = server.requests.filter((r) => r.method === 'PUT').map((r) => r.headers['content-range']);
    expect(ranges).toEqual(['bytes 0-99/450', 'bytes 200-299/450', 'bytes 300-399/450', 'bytes 400-449/450']);
  });

  it('resumes after a reload from GET /uploads/:id using the remembered record and the same file', async () => {
    const { server, api, registry } = setup({ chunkSizeBytes: 100 });
    const file = makeFile(350, 'game.mp4');
    const first = createUploadClient(api, { hasher: hashOf, registry, retryDelayMs: 1 });
    // Simulate an interruption: create and send one chunk by hand, then "reload".
    const created = await api.media.createUpload('g', { filename: file.name, byteSize: file.size, mimeType: file.type, context });
    await api.media.putChunk(created.upload.id, { start: 0, end: 99, total: 350 }, file.slice(0, 100));
    first.registry.remember({ uploadId: created.upload.id, assetId: created.asset.id, gameId: 'g', filename: file.name, byteSize: file.size, lastModified: file.lastModified, startedAt: new Date().toISOString() });

    const second = createUploadClient(api, { hasher: hashOf, registry, retryDelayMs: 1 });
    const [record] = second.registry.list('g');
    const outcome = await second.resume({ record, file }).result;
    expect(outcome.kind).toBe('completed');
    const ranges = server.requests.filter((r) => r.method === 'PUT').map((r) => r.headers['content-range']);
    expect(ranges).toEqual(['bytes 0-99/350', 'bytes 100-199/350', 'bytes 200-299/350', 'bytes 300-349/350']);
    expect(server.requests.some((r) => r.method === 'GET' && r.url.endsWith(`/uploads/${created.upload.id}`))).toBe(true);
    expect(registry.list()).toEqual([]);
  });

  it('refuses to resume with a different file', async () => {
    const { client, registry } = setup();
    const record = { uploadId: 'up-x', assetId: 'a', gameId: 'g', filename: 'game.mp4', byteSize: 350, lastModified: 1, startedAt: 'now' };
    registry.remember(record);
    const outcome = await client.resume({ record, file: makeFile(351, 'other.mp4') }).result;
    expect(outcome.kind).toBe('error');
    expect(String((outcome as { error: Error }).error.message)).toMatch(/not the same file/);
  });

  it('retries a chunk after a network failure with backoff', async () => {
    const { server, client, progress } = setup({ chunkSizeBytes: 100 });
    server.failNextPuts = 2;
    const outcome = await client.start({ gameId: 'g', file: makeFile(250), context }).result;
    expect(outcome.kind).toBe('completed');
    expect(progress.filter((p) => p.note?.startsWith('Connection lost'))).toHaveLength(2);
    expect(server.requests.filter((r) => r.method === 'PUT' && r.headers['content-range'] === 'bytes 0-99/250')).toHaveLength(3);
  });

  it('cancels at the next chunk boundary and keeps the registry entry so it can be resumed', async () => {
    const { server, client, registry, progress } = setup({ chunkSizeBytes: 100 });
    const handle = client.start({ gameId: 'g', file: makeFile(1000), context });
    // Cancel as soon as the first chunk is on its way.
    await new Promise<void>((resolve) => {
      const check = () => (server.requests.some((r) => r.method === 'PUT') ? resolve() : setTimeout(check, 1));
      check();
    });
    handle.cancel();
    const outcome = await handle.result;
    expect(outcome.kind).toBe('canceled');
    expect(server.requests.filter((r) => r.method === 'PUT').length).toBeLessThan(10);
    expect(server.requests.some((r) => r.url.endsWith('/complete'))).toBe(false);
    expect(registry.list('g')).toHaveLength(1);
    expect(progress.at(-1)?.phase).toBe('canceled');
  });
});
