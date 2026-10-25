import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createMediaHandlers, registerMediaHandlers, type MediaJobInput } from '../handlers.ts';
import { jpegDimensions } from '../frames.ts';
import { InMemoryJobStore } from '../jobs/memory-store.ts';
import { idempotencyKeyFor, JobRunner, type RunnerEvent } from '../jobs/runner.ts';
import { PlaySegmentSchema } from '@footballos/contracts';
import { probe } from '../probe.ts';
import { thumbFramePath, thumbTile, thumbTileJpeg } from '../thumbs.ts';
import { CLIPS, DATA_DIR } from './fixtures.ts';

const PLAY1 = CLIPS[0] as string;
const dataDir = join(DATA_DIR, 'handlers-test');
const TEAM = '11111111-1111-4111-8111-111111111111';
const GAME = '22222222-2222-4222-8222-222222222222';
const ASSET = '33333333-3333-4333-8333-333333333333';
const USER = '44444444-4444-4444-8444-444444444444';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe('createMediaHandlers through the JobRunner on play-1 (ffmpeg)', () => {
  const outDir = join(dataDir, 'asset-1');
  const input: MediaJobInput = { assetId: ASSET, sourcePath: PLAY1, outDir, teamId: TEAM, gameId: GAME };
  const store = new InMemoryJobStore();
  const runner = new JobRunner({ store, workerId: 'w-media', leaseSec: 30 });
  const events: RunnerEvent[] = [];
  runner.on('event', (e: RunnerEvent) => events.push(e));
  const handlers = createMediaHandlers({ dataDir, proxy: { height: 360 }, thumbnails: { everySec: 2 }, progressIntervalMs: 0 });
  registerMediaHandlers(runner, handlers);

  beforeAll(async () => {
    await rm(outDir, { recursive: true, force: true });
    await mkdir(dataDir, { recursive: true });
  });

  async function runKind(kind: 'validate' | 'proxy' | 'thumbnails' | 'segment') {
    const { job } = await runner.enqueue({ teamId: TEAM, assetId: ASSET, kind, input, requestedBy: USER, idempotencyKey: idempotencyKeyFor(kind, input, 'test-v1'), configVersion: 'test-v1' });
    const done = await runner.runOnce();
    expect(done?.id).toBe(job.id);
    return done!;
  }

  it('validate → { ok, reasons, probe, quality }', async () => {
    const job = await runKind('validate');
    expect(job.status).toBe('succeeded');
    const r = job.result as { ok: boolean; reasons: string[]; warnings: string[]; probe: { width: number } | null; quality: { stable: boolean | null; notes: string[]; unevaluable: string[] } | null };
    expect(r.ok).toBe(true);
    expect(r.reasons).toEqual([]);
    expect(r.probe?.width).toBe(1920);
    expect(r.quality).not.toBeNull();
    expect(Array.isArray(r.quality?.notes)).toBe(true);
    expect(r.quality?.unevaluable.length).toBeGreaterThan(0);
    expect(job.progress).toEqual({ done: 3, total: 3, message: 'Validated' });
  });

  it('validate rejects a file that breaks the limits without assessing quality', async () => {
    const strict = createMediaHandlers({ dataDir, limits: { maxDurationSec: 2 } });
    const r = await strict.validate({ id: 'j-strict', input }, { signal: new AbortController().signal, progress: () => {} });
    expect(r.ok).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/limit is 2 s/);
    expect(r.probe).not.toBeNull();
    expect(r.quality).toBeNull();
  });

  it('validate reports an unreadable file as rejected and a missing file as a non-retryable failure', async () => {
    const junk = join(dataDir, 'not-a-video.mp4');
    await rm(junk, { force: true });
    await (await import('node:fs/promises')).writeFile(junk, 'this is not a video');
    const r = await handlers.validate({ id: 'j-junk', input: { ...input, sourcePath: junk } }, { signal: new AbortController().signal, progress: () => {} });
    expect(r.ok).toBe(false);
    expect(r.probe).toBeNull();
    expect(r.reasons[0]).toMatch(/could not be read/);
    await expect(handlers.validate({ id: 'j-missing', input: { ...input, sourcePath: join(dataDir, 'nope.mp4') } }, { signal: new AbortController().signal, progress: () => {} })).rejects.toMatchObject({ code: 'source_missing' });
  });

  it('proxy → { proxyPath, mapping, durationDriftSec } with a file on disk and progress', async () => {
    const job = await runKind('proxy');
    expect(job.status).toBe('succeeded');
    const r = job.result as { proxyPath: string; mapping: { proxyOffsetSec: number; sourceDurationSec: number }; durationDriftSec: number; height: number };
    expect(r.proxyPath).toBe(join(outDir, 'proxy.mp4'));
    expect(existsSync(r.proxyPath)).toBe(true);
    expect(r.mapping.proxyOffsetSec).toBe(0);
    expect(r.durationDriftSec).toBeLessThan(0.5);
    const p = await probe(r.proxyPath);
    expect(p.height).toBe(360);
    expect(p.videoCodec).toBe('h264');
    const progress = events.filter((e): e is Extract<RunnerEvent, { type: 'progress' }> => e.type === 'progress' && e.job.id === job.id);
    expect(progress.length).toBeGreaterThanOrEqual(2);
    expect(progress[progress.length - 1]?.job.progress.message).toBe('Proxy ready');
    expect((await readdir(outDir)).filter((f) => f.includes('.part'))).toEqual([]);
  });

  it('thumbnails → { sheetPath, everySec, count, framesDir } and thumbTile / thumbTileJpeg read tile n', async () => {
    const job = await runKind('thumbnails');
    expect(job.status).toBe('succeeded');
    const r = job.result as { sheetPath: string; everySec: number; count: number; framesDir?: string; sidecarPath: string; mapping: { tileWidth: number; tileHeight: number; columns: number } };
    expect(r.sheetPath).toBe(join(outDir, 'thumbs.jpg'));
    expect(r.everySec).toBe(2);
    // 0, 2, 4 s of a 6.37 s clip: the fps filter emits a frame per whole period only.
    const duration = (await probe(PLAY1)).durationSec as number;
    expect(r.count).toBe(Math.floor(duration / 2));
    const last = r.count - 1;
    expect(r.framesDir).toBe(join(outDir, 'thumbs.jpg.frames'));
    expect(existsSync(r.sheetPath)).toBe(true);
    expect(existsSync(r.sidecarPath)).toBe(true);
    expect((await readdir(r.framesDir as string)).sort()).toEqual(Array.from({ length: r.count }, (_, i) => `frame-${String(i + 1).padStart(5, '0')}.jpg`));

    expect(await thumbTile(r.sheetPath, last)).toEqual({ x: last * r.mapping.tileWidth, y: 0, w: r.mapping.tileWidth, h: r.mapping.tileHeight });
    await expect(thumbTile(r.sheetPath, r.count)).rejects.toThrow(RangeError);
    expect(await thumbFramePath(r.sheetPath, last)).toBe(join(r.framesDir as string, `frame-${String(r.count).padStart(5, '0')}.jpg`));

    const fromFrame = await thumbTileJpeg(r.sheetPath, last);
    expect(fromFrame.source).toBe('frame');
    expect(jpegDimensions(fromFrame.jpeg)).toEqual({ width: r.mapping.tileWidth, height: r.mapping.tileHeight });

    // Single-frame fallback when the frames directory is gone: crop the tile from the sheet.
    await rm(r.framesDir as string, { recursive: true, force: true });
    expect(await thumbFramePath(r.sheetPath, last)).toBeNull();
    const cropped = await thumbTileJpeg(r.sheetPath, last);
    expect(cropped.source).toBe('sheet_crop');
    expect(jpegDimensions(cropped.jpeg)).toEqual({ width: r.mapping.tileWidth, height: r.mapping.tileHeight });
    expect(cropped.tile).toEqual(await thumbTile(r.sheetPath, last));
    expect((await readdir(outDir)).filter((f) => f.includes('.part'))).toEqual([]);
  });

  it('segment → { segments, confidenceNote } with contract-shaped proposals', async () => {
    const job = await runKind('segment');
    expect(job.status).toBe('succeeded');
    const r = job.result as { segments: unknown[]; confidenceNote: string; segmentsPath: string };
    expect(typeof r.confidenceNote).toBe('string');
    expect(r.confidenceNote.length).toBeGreaterThan(10);
    expect(existsSync(r.segmentsPath)).toBe(true);
    const onDisk = JSON.parse(await readFile(r.segmentsPath, 'utf8')) as { segments: unknown[] };
    expect(onDisk.segments).toEqual(r.segments);
    for (const s of r.segments) {
      const parsed = PlaySegmentSchema.parse(s);
      expect(parsed.origin).toBe('proposed');
      expect(parsed.reviewStatus).toBe('proposed');
      expect(parsed.teamId).toBe(TEAM);
      expect(parsed.gameId).toBe(GAME);
      expect(parsed.assetId).toBe(ASSET);
    }
  });

  it('duplicate enqueue of a finished kind returns the existing job', async () => {
    const { duplicate } = await runner.enqueue({ teamId: TEAM, assetId: ASSET, kind: 'proxy', input, requestedBy: USER, idempotencyKey: idempotencyKeyFor('proxy', input, 'test-v1'), configVersion: 'test-v1' });
    expect(duplicate).toBe(true);
  });
});

describe('abort', () => {
  it('cancel mid-proxy kills ffmpeg and leaves no partial output behind', async () => {
    const outDir = join(dataDir, 'asset-abort');
    await rm(outDir, { recursive: true, force: true });
    const input: MediaJobInput = { assetId: ASSET, sourcePath: PLAY1, outDir };
    const store = new InMemoryJobStore();
    const runner = new JobRunner({ store, workerId: 'w-abort', leaseSec: 30 });
    // A slow preset keeps the encoder busy long enough to cancel it.
    registerMediaHandlers(runner, createMediaHandlers({ dataDir, proxy: { height: 1080, preset: 'veryslow' } }));
    const { job } = await runner.enqueue({ teamId: TEAM, assetId: ASSET, kind: 'proxy', input, requestedBy: USER, idempotencyKey: idempotencyKeyFor('proxy', input, 'abort-v1'), configVersion: 'abort-v1' });
    const running = runner.runOnce();
    await sleep(700);
    const partialSeen = existsSync(outDir) ? (await readdir(outDir)).some((f) => f.startsWith('proxy.mp4.part-')) : false;
    expect(partialSeen).toBe(true);
    await runner.requestCancel(job.id);
    const done = await running;
    expect(done?.status).toBe('canceled');
    expect(existsSync(join(outDir, 'proxy.mp4'))).toBe(false);
    expect((await readdir(outDir)).filter((f) => f.startsWith('proxy.mp4'))).toEqual([]);
  });

  it('a handler started with an already-aborted signal does nothing', async () => {
    const outDir = join(dataDir, 'asset-preaborted');
    await rm(outDir, { recursive: true, force: true });
    const handlers = createMediaHandlers({ dataDir });
    const ctrl = new AbortController();
    ctrl.abort('cancel_requested');
    await expect(handlers.thumbnails({ id: 'j-pre', input: { assetId: ASSET, sourcePath: PLAY1, outDir } }, { signal: ctrl.signal, progress: () => {} })).rejects.toMatchObject({ code: 'aborted' });
    expect((await readdir(outDir)).length).toBe(0);
  });
});
