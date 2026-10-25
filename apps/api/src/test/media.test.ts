import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { call, makeTestApp, seedTeamWithStaff, signIn, type TestApp } from './helpers.js';
import { CONTEXT, FIXTURE_CLIPS, putChunk, seedGame, sha256Of, uploadFile } from './media-helpers.js';
import { runMaintenance, runWorkerUntilIdle } from '../jobs/worker.js';
import { mediaAssets, uploads } from '../db/schema.js';

let t: TestApp;
let alpha: Awaited<ReturnType<typeof seedTeamWithStaff>>;
let beta: Awaited<ReturnType<typeof seedTeamWithStaff>>;
let game: { gameId: string; opponentId: string };
let betaGame: { gameId: string; opponentId: string };

beforeAll(async () => {
  t = makeTestApp({ UPLOAD_CHUNK_BYTES: String(2_000_000), MEDIA_GRANT_TTL_MIN: '15', UPLOAD_TTL_HOURS: '1' });
  alpha = await seedTeamWithStaff(t, 'Alpha (demo)');
  beta = await seedTeamWithStaff(t, 'Beta (demo)');
  game = await seedGame(t, alpha.hc.cookie, alpha.team.id, alpha.season.id);
  betaGame = await seedGame(t, beta.hc.cookie, beta.team.id, beta.season.id, 'Beta Opp');
});
afterAll(() => t.close());

describe('§14.1 resumable uploads', () => {
  let assetId: string;

  it('uploads play-1.mp4 in chunks, completes with a verified sha256 and enqueues the chain', async () => {
    const file = FIXTURE_CLIPS[0]!;
    const r = await uploadFile(t, alpha.oc.cookie, game.gameId, file, { chunkSize: 1_500_000, withHash: true });
    expect(r.create.status).toBe(201);
    expect(r.create.body.asset.status).toBe('uploading');
    expect(r.create.body.asset.sha256).toBeNull();
    expect(r.create.body.upload.chunkSizeBytes).toBe(2_000_000);
    expect(r.chunks.at(-1)).toBe(fs.statSync(file).size);
    expect(r.complete.status).toBe(200);
    expect(r.complete.body.asset.status).toBe('uploaded');
    expect(r.complete.body.asset.sha256).toBe(sha256Of(file));
    expect(r.complete.body.jobs.map((j: any) => j.kind)).toEqual(['validate', 'proxy', 'thumbnails', 'segment']);
    expect(r.complete.body.jobs.every((j: any) => j.status === 'queued')).toBe(true);
    assetId = r.complete.body.asset.id;
    // stored privately under media/<teamId>/<assetId>/original.mp4
    const stored = path.join(t.dataDir, 'media', alpha.team.id, assetId, 'original.mp4');
    expect(fs.existsSync(stored)).toBe(true);
    expect(fs.statSync(stored).mode & 0o077).toBe(0);
    expect(fs.existsSync(path.join(t.dataDir, 'uploads', `${r.uploadId}.part`))).toBe(false);
    // the upload record reports completion
    const up = await call(t, 'GET', `/api/v1/uploads/${r.uploadId}`, undefined, alpha.oc.cookie);
    expect(up.body.upload.completedAt).not.toBeNull();
  });

  it('rejects out-of-order chunks with 409 and receivedBytes, and resumes via GET', async () => {
    const file = FIXTURE_CLIPS[1]!;
    const bytes = fs.readFileSync(file);
    const create = await call(t, 'POST', `/api/v1/games/${game.gameId}/uploads`, { filename: 'play-2.mp4', byteSize: bytes.length, mimeType: 'video/mp4', context: CONTEXT }, alpha.pc.cookie);
    expect(create.status).toBe(201);
    const uploadId = create.body.upload.id;
    const first = await putChunk(t, alpha.pc.cookie, uploadId, bytes.subarray(0, 1_000_000), 0, bytes.length);
    expect(first.status).toBe(200);
    expect(first.body.receivedBytes).toBe(1_000_000);
    const skipped = await putChunk(t, alpha.pc.cookie, uploadId, bytes.subarray(2_000_000, 2_500_000), 2_000_000, bytes.length);
    expect(skipped.status).toBe(409);
    expect(skipped.body.error.code).toBe('conflict');
    expect(skipped.body.error.details.receivedBytes).toBe(1_000_000);
    // "page reload": ask where to resume
    const resume = await call(t, 'GET', `/api/v1/uploads/${uploadId}`, undefined, alpha.pc.cookie);
    expect(resume.status).toBe(200);
    expect(resume.body.upload.receivedBytes).toBe(1_000_000);
    let start = resume.body.upload.receivedBytes as number;
    while (start < bytes.length) {
      const r = await putChunk(t, alpha.pc.cookie, uploadId, bytes.subarray(start, Math.min(bytes.length, start + 2_000_000)), start, bytes.length);
      expect(r.status).toBe(200);
      start = r.body.receivedBytes;
    }
    const incomplete409 = await call(t, 'POST', `/api/v1/uploads/${create.body.upload.id}/complete`, {}, alpha.pc.cookie);
    expect(incomplete409.status).toBe(200);
    expect(incomplete409.body.asset.sha256).toBe(sha256Of(file));
  });

  it('refuses to complete an incomplete upload with 409 receivedBytes', async () => {
    const bytes = fs.readFileSync(FIXTURE_CLIPS[2]!);
    const create = await call(t, 'POST', `/api/v1/games/${game.gameId}/uploads`, { filename: 'partial.mp4', byteSize: bytes.length, mimeType: 'video/mp4', context: CONTEXT }, alpha.an.cookie);
    await putChunk(t, alpha.an.cookie, create.body.upload.id, bytes.subarray(0, 500_000), 0, bytes.length);
    const res = await call(t, 'POST', `/api/v1/uploads/${create.body.upload.id}/complete`, {}, alpha.an.cookie);
    expect(res.status).toBe(409);
    expect(res.body.error.details.receivedBytes).toBe(500_000);
  });

  it('detects a duplicate sha256 at create (409 existingAssetId) and at complete (partial file deleted)', async () => {
    const file = FIXTURE_CLIPS[0]!;
    const early = await call(t, 'POST', `/api/v1/games/${game.gameId}/uploads`, { filename: 'again.mp4', byteSize: 10, mimeType: 'video/mp4', sha256: sha256Of(file), context: CONTEXT }, alpha.oc.cookie);
    expect(early.status).toBe(409);
    expect(early.body.error.details.existingAssetId).toBe(assetId);
    const late = await uploadFile(t, alpha.oc.cookie, game.gameId, file, { chunkSize: 2_000_000 });
    expect(late.complete.status).toBe(409);
    expect(late.complete.body.error.details.existingAssetId).toBe(assetId);
    expect(fs.existsSync(path.join(t.dataDir, 'uploads', `${late.uploadId}.part`))).toBe(false);
    expect(t.ctx.db.select().from(mediaAssets).where(eq(mediaAssets.id, late.create.body.asset.id)).get()).toBeUndefined();
  });

  it('enforces limits: 413 over MAX_UPLOAD_BYTES, 400 unsupported container, 413 oversize chunk, 400 bad Content-Range', async () => {
    const big = await call(t, 'POST', `/api/v1/games/${game.gameId}/uploads`, { filename: 'huge.mp4', byteSize: 21474836481, mimeType: 'video/mp4', context: CONTEXT }, alpha.oc.cookie);
    expect(big.status).toBe(413);
    expect(big.body.error.code).toBe('payload_too_large');
    const avi = await call(t, 'POST', `/api/v1/games/${game.gameId}/uploads`, { filename: 'film.avi', byteSize: 1000, mimeType: 'video/x-msvideo', context: CONTEXT }, alpha.oc.cookie);
    expect(avi.status).toBe(400);
    const create = await call(t, 'POST', `/api/v1/games/${game.gameId}/uploads`, { filename: 'limits.mp4', byteSize: 5_000_000, mimeType: 'video/mp4', context: CONTEXT }, alpha.oc.cookie);
    const oversize = await putChunk(t, alpha.oc.cookie, create.body.upload.id, Buffer.alloc(2_000_001), 0, 5_000_000);
    expect(oversize.status).toBe(413);
    const bad = await t.app.request(`/api/v1/uploads/${create.body.upload.id}`, { method: 'PUT', headers: { cookie: alpha.oc.cookie, 'content-range': 'nonsense' }, body: new Uint8Array(10) });
    expect(bad.status).toBe(400);
  });

  it('viewers cannot upload (403); the head coach can delete with an audit row (204)', async () => {
    const denied = await call(t, 'POST', `/api/v1/games/${game.gameId}/uploads`, { filename: 'v.mp4', byteSize: 10, mimeType: 'video/mp4', context: CONTEXT }, alpha.vw.cookie);
    expect(denied.status).toBe(403);
    const r = await uploadFile(t, alpha.oc.cookie, game.gameId, FIXTURE_CLIPS[3]!, { chunkSize: 2_000_000 });
    const id = r.complete.body.asset.id as string;
    expect((await call(t, 'DELETE', `/api/v1/assets/${id}`, undefined, alpha.oc.cookie)).status).toBe(403);
    const del = await call(t, 'DELETE', `/api/v1/assets/${id}`, undefined, alpha.hc.cookie);
    expect(del.status).toBe(204);
    const after = await call(t, 'GET', `/api/v1/assets/${id}`, undefined, alpha.vw.cookie);
    expect(after.body.asset.status).toBe('deleted');
    expect(fs.existsSync(path.join(t.dataDir, 'media', alpha.team.id, id))).toBe(false);
    const jobs = await call(t, 'GET', `/api/v1/teams/${alpha.team.id}/jobs?assetId=${id}`, undefined, alpha.hc.cookie);
    expect(jobs.body.items.every((j: any) => j.status === 'canceled')).toBe(true);
    const audit = await call(t, 'GET', `/api/v1/teams/${alpha.team.id}/audit`, undefined, alpha.hc.cookie);
    expect(audit.body.items.some((e: any) => e.action === 'asset.deleted' && e.targetId === id)).toBe(true);
  });

  it('garbage-collects expired uploads with their partial files on the maintenance tick', async () => {
    const bytes = fs.readFileSync(FIXTURE_CLIPS[4]!);
    const create = await call(t, 'POST', `/api/v1/games/${game.gameId}/uploads`, { filename: 'stale.mp4', byteSize: bytes.length, mimeType: 'video/mp4', context: CONTEXT }, alpha.oc.cookie);
    await putChunk(t, alpha.oc.cookie, create.body.upload.id, bytes.subarray(0, 100_000), 0, bytes.length);
    const part = path.join(t.dataDir, 'uploads', `${create.body.upload.id}.part`);
    expect(fs.existsSync(part)).toBe(true);
    t.clock.advanceMs(2 * 3_600_000); // UPLOAD_TTL_HOURS=1
    expect((await call(t, 'GET', `/api/v1/uploads/${create.body.upload.id}`, undefined, alpha.oc.cookie)).status).toBe(404);
    const r = await runMaintenance(t.ctx);
    expect(r.expiredUploads).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(part)).toBe(false);
    expect(t.ctx.db.select().from(uploads).where(eq(uploads.id, create.body.upload.id)).get()).toBeUndefined();
    expect(t.ctx.db.select().from(mediaAssets).where(eq(mediaAssets.id, create.body.asset.id)).get()).toBeUndefined();
  });

  it('lists the game assets and hides other teams (404)', async () => {
    const list = await call(t, 'GET', `/api/v1/games/${game.gameId}/assets`, undefined, alpha.vw.cookie);
    expect(list.status).toBe(200);
    expect(list.body.items.some((a: any) => a.id === assetId)).toBe(true);
    expect((await call(t, 'GET', `/api/v1/games/${game.gameId}/assets`, undefined, beta.hc.cookie)).status).toBe(404);
    expect((await call(t, 'GET', `/api/v1/assets/${assetId}`, undefined, beta.hc.cookie)).status).toBe(404);
    expect((await call(t, 'POST', `/api/v1/games/${game.gameId}/uploads`, { filename: 'x.mp4', byteSize: 10, mimeType: 'video/mp4', context: CONTEXT }, beta.hc.cookie)).status).toBe(404);
  });
});

describe('§14.2 worker runs the chain on play-1.mp4 and §14.3 streams it', () => {
  let assetId: string;
  let grant: { streamUrl: string; thumbUrlTemplate: string; expiresAt: string };

  it('validate → proxy → thumbnails → segment end to end; proxy, thumbs and segments are stored', async () => {
    const list = await call(t, 'GET', `/api/v1/games/${game.gameId}/assets`, undefined, alpha.hc.cookie);
    assetId = list.body.items.find((a: any) => a.originalFilename === 'play-1.mp4').id;
    const done = await runWorkerUntilIdle(t.ctx, 50);
    const mine = done.filter((j) => j.assetId === assetId);
    expect(mine.map((j) => `${j.kind}:${j.status}`)).toEqual(['validate:succeeded', 'proxy:succeeded', 'thumbnails:succeeded', 'segment:succeeded']);
    const asset = (await call(t, 'GET', `/api/v1/assets/${assetId}`, undefined, alpha.hc.cookie)).body.asset;
    expect(asset.status).toBe('ready');
    expect(asset.width).toBe(1920);
    expect(asset.height).toBe(1080);
    expect(asset.durationSec).toBeGreaterThan(6);
    expect(asset.quality).not.toBeNull();
    expect(asset.proxyStorageKey).toBe(`media/${alpha.team.id}/${assetId}/proxy.mp4`);
    expect(asset.thumbnailSheetKey).toBe(`media/${alpha.team.id}/${assetId}/thumbs.jpg`);
    expect(fs.existsSync(path.join(t.dataDir, asset.proxyStorageKey))).toBe(true);
    expect(fs.existsSync(path.join(t.dataDir, asset.thumbnailSheetKey))).toBe(true);
    expect(fs.statSync(path.join(t.dataDir, asset.proxyStorageKey)).mode & 0o077).toBe(0);
    const segs = await call(t, 'GET', `/api/v1/assets/${assetId}/segments`, undefined, alpha.vw.cookie);
    expect(segs.status).toBe(200);
    expect(Array.isArray(segs.body.items)).toBe(true);
    const segJob = mine.find((j) => j.kind === 'segment')!;
    expect(typeof (segJob.result as any).confidenceNote).toBe('string');
    expect(segs.body.items.length).toBe((segJob.result as any).segments.length);
    for (const s of segs.body.items) {
      expect(s.origin).toBe('proposed');
      expect(s.reviewStatus).toBe('proposed');
      const labels = await call(t, 'GET', `/api/v1/segments/${s.id}/labels`, undefined, alpha.vw.cookie);
      expect(labels.body.items).toHaveLength(12);
      expect(labels.body.items.every((l: any) => l.accepted.status === 'unknown' && l.inferred === null)).toBe(true);
    }
    const jobs = await call(t, 'GET', `/api/v1/teams/${alpha.team.id}/jobs?assetId=${assetId}&status=succeeded`, undefined, alpha.vw.cookie);
    expect(jobs.body.items).toHaveLength(4);
    expect(jobs.body.items[0].progress.done).toBeGreaterThan(0);
  });

  it('issues a grant and streams the proxy with Range support', async () => {
    const g = await call(t, 'GET', `/api/v1/assets/${assetId}/grant`, undefined, alpha.vw.cookie);
    expect(g.status).toBe(200);
    grant = g.body;
    expect(grant.streamUrl).toContain(`/api/v1/media/${assetId}/stream?token=`);
    const full = await t.app.request(grant.streamUrl);
    expect(full.status).toBe(200);
    expect(full.headers.get('accept-ranges')).toBe('bytes');
    expect(full.headers.get('content-type')).toBe('video/mp4');
    // §14.10 (QA D-1): server-chosen type plus delivery headers on every byte response
    expect(full.headers.get('content-disposition')).toBe(`inline; filename="${assetId}.mp4"`);
    expect(full.headers.get('x-content-type-options')).toBe('nosniff');
    expect(full.headers.get('content-security-policy')).toBe("default-src 'none'");
    expect(full.headers.get('cache-control')).toContain('no-store');
    const size = Number(full.headers.get('content-length'));
    expect(size).toBe(fs.statSync(path.join(t.dataDir, 'media', alpha.team.id, assetId, 'proxy.mp4')).size);
    const bytes = new Uint8Array(await full.arrayBuffer());
    expect(bytes.length).toBe(size);
    const partial = await t.app.request(grant.streamUrl, { headers: { range: 'bytes=100-199' } });
    expect(partial.status).toBe(206);
    expect(partial.headers.get('content-range')).toBe(`bytes 100-199/${size}`);
    expect(partial.headers.get('content-length')).toBe('100');
    const chunk = new Uint8Array(await partial.arrayBuffer());
    expect(chunk).toEqual(bytes.subarray(100, 200));
    const tail = await t.app.request(grant.streamUrl, { headers: { range: 'bytes=-10' } });
    expect(tail.status).toBe(206);
    expect(tail.headers.get('content-range')).toBe(`bytes ${size - 10}-${size - 1}/${size}`);
    const bad = await t.app.request(grant.streamUrl, { headers: { range: `bytes=${size + 5}-` } });
    expect(bad.status).toBe(416);
    const thumb = await t.app.request(grant.thumbUrlTemplate.replace('{n}', '0'));
    expect(thumb.status).toBe(200);
    expect(thumb.headers.get('content-type')).toBe('image/jpeg');
    expect(thumb.headers.get('content-disposition')).toBe(`inline; filename="${assetId}-0.jpg"`);
    expect(thumb.headers.get('x-content-type-options')).toBe('nosniff');
    expect(thumb.headers.get('content-security-policy')).toBe("default-src 'none'");
    expect((await thumb.arrayBuffer()).byteLength).toBeGreaterThan(100);
    expect((await t.app.request(grant.thumbUrlTemplate.replace('{n}', '999'))).status).toBe(404);
  });

  it('never serves a rejected upload and never uses the client mimeType as Content-Type (§14.10, QA D-1)', async () => {
    // HTML bytes named .mp4 with mimeType text/html: accepted at create, rejected by validate.
    const html = Buffer.from('<!doctype html><html><body><script>document.title="xss"</script>not film</body></html>');
    const create = await call(t, 'POST', `/api/v1/games/${game.gameId}/uploads`, { filename: 'page.mp4', byteSize: html.length, mimeType: 'text/html', context: CONTEXT }, alpha.pc.cookie);
    expect(create.status).toBe(201);
    const htmlAsset = create.body.asset.id as string;
    expect((await putChunk(t, alpha.pc.cookie, create.body.upload.id, html, 0, html.length)).status).toBe(200);
    const complete = await call(t, 'POST', `/api/v1/uploads/${create.body.upload.id}/complete`, {}, alpha.pc.cookie);
    expect(complete.status).toBe(200);
    // Before validation runs the asset is `uploaded`: a grant exists but nothing is served.
    const earlyGrant = await call(t, 'GET', `/api/v1/assets/${htmlAsset}/grant`, undefined, alpha.pc.cookie);
    expect(earlyGrant.status).toBe(200);
    const early = await t.app.request(earlyGrant.body.streamUrl);
    expect(early.status).toBe(404);
    expect(early.headers.get('content-type')).not.toMatch(/text\/html/i);
    const done = await runWorkerUntilIdle(t.ctx, 50);
    const validate = done.find((j) => j.assetId === htmlAsset && j.kind === 'validate')!;
    expect(validate.status).toBe('succeeded');
    const asset = (await call(t, 'GET', `/api/v1/assets/${htmlAsset}`, undefined, alpha.pc.cookie)).body.asset;
    expect(asset.status).toBe('rejected');
    expect(asset.mimeType).toBe('text/html'); // the record keeps what the client said; the wire never does
    const g = await call(t, 'GET', `/api/v1/assets/${htmlAsset}/grant`, undefined, alpha.pc.cookie);
    expect(g.status).toBe(200);
    for (const url of [g.body.streamUrl, g.body.thumbUrlTemplate.replace('{n}', '0')]) {
      for (const headers of [{}, { range: 'bytes=0-9' }] as Record<string, string>[]) {
        const res = await t.app.request(url, { headers });
        expect(res.status).toBe(404);
        expect(res.headers.get('content-type')).not.toMatch(/text\/html/i);
        expect(await res.text()).not.toContain('<script>');
      }
    }
    // A validated original (no proxy yet) is typed from the probe's container, not from the client's mimeType.
    const probed = await uploadFile(t, alpha.pc.cookie, game.gameId, FIXTURE_CLIPS[3]!, { chunkSize: 2_000_000 });
    const probedId = probed.complete.body.asset.id as string;
    t.ctx.db.update(mediaAssets).set({ mimeType: 'text/html' }).where(eq(mediaAssets.id, probedId)).run();
    const first = await t.ctx.runner.runOnce(); // validate only
    expect(first?.kind).toBe('validate');
    expect(t.ctx.db.select().from(mediaAssets).where(eq(mediaAssets.id, probedId)).get()).toMatchObject({ status: 'validated', container: 'mp4', proxyStorageKey: null });
    const pg = (await call(t, 'GET', `/api/v1/assets/${probedId}/grant`, undefined, alpha.pc.cookie)).body;
    const orig = await t.app.request(pg.streamUrl, { headers: { range: 'bytes=0-15' } });
    expect(orig.status).toBe(206);
    expect(orig.headers.get('content-type')).toBe('video/mp4');
    expect(orig.headers.get('content-disposition')).toBe(`inline; filename="${probedId}.mp4"`);
    expect(orig.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await t.app.request(pg.thumbUrlTemplate.replace('{n}', '0'))).status).toBe(404); // no sheet yet
    await runWorkerUntilIdle(t.ctx, 50);
  });

  it('rejects tampered, foreign and expired grants with 401', async () => {
    const url = new URL(grant.streamUrl, 'http://x');
    const token = url.searchParams.get('token')!;
    expect((await t.app.request(`/api/v1/media/${assetId}/stream?token=${token.slice(0, -2)}00`)).status).toBe(401);
    expect((await t.app.request(`/api/v1/media/${assetId}/stream`)).status).toBe(401);
    // a grant for another asset id does not open this one
    const r = await uploadFile(t, beta.hc.cookie, betaGame.gameId, FIXTURE_CLIPS[5]!, { chunkSize: 2_000_000 });
    const betaAsset = r.complete.body.asset.id;
    const betaGrant = (await call(t, 'GET', `/api/v1/assets/${betaAsset}/grant`, undefined, beta.hc.cookie)).body;
    const betaToken = new URL(betaGrant.streamUrl, 'http://x').searchParams.get('token')!;
    expect((await t.app.request(`/api/v1/media/${assetId}/stream?token=${encodeURIComponent(betaToken)}`)).status).toBe(401);
    expect((await call(t, 'GET', `/api/v1/assets/${assetId}/grant`, undefined, beta.hc.cookie)).status).toBe(404);
    t.clock.advanceMs(16 * 60_000);
    expect((await t.app.request(grant.streamUrl)).status).toBe(401);
  });
});

describe('§14.7 settings and retention', () => {
  it('serves defaults (keep until the head coach deletes), enforces the version and head-coach role, and applies retention on the tick', async () => {
    const get = await call(t, 'GET', `/api/v1/teams/${alpha.team.id}/settings`, undefined, alpha.vw.cookie);
    expect(get.status).toBe(200);
    expect(get.body.settings.retentionDays).toBeNull();
    expect(get.body.settings.version).toBe(1);
    expect(get.body.settings.uploadLimits.uploadChunkBytes).toBe(2_000_000);
    expect((await call(t, 'PATCH', `/api/v1/teams/${alpha.team.id}/settings`, { expectedVersion: 1, retentionDays: 30 }, alpha.oc.cookie)).status).toBe(403);
    const stale = await call(t, 'PATCH', `/api/v1/teams/${alpha.team.id}/settings`, { expectedVersion: 7, retentionDays: 30 }, alpha.hc.cookie);
    expect(stale.status).toBe(409);
    expect(stale.body.error.details.currentVersion).toBe(1);
    expect((await call(t, 'GET', `/api/v1/teams/${alpha.team.id}/settings`, undefined, beta.hc.cookie)).status).toBe(404);
    const ok = await call(t, 'PATCH', `/api/v1/teams/${alpha.team.id}/settings`, { expectedVersion: 1, retentionDays: 1 }, alpha.hc.cookie);
    expect(ok.status).toBe(200);
    expect(ok.body.settings.version).toBe(2);
    expect(ok.body.settings.retentionDays).toBe(1);
    const list = await call(t, 'GET', `/api/v1/games/${game.gameId}/assets`, undefined, alpha.hc.cookie);
    const live = list.body.items.filter((a: any) => a.status !== 'deleted');
    expect(live.every((a: any) => a.retentionUntil !== null)).toBe(true);
    t.clock.advanceMs(2 * 86_400_000);
    const r = await runMaintenance(t.ctx);
    expect(r.retentionDeleted).toBe(live.length);
    // sessions idled out while the clock moved two days; sign in again
    alpha.hc.cookie = await signIn(t, alpha.hc.user.email, alpha.hc.totpSecret);
    beta.hc.cookie = await signIn(t, beta.hc.user.email, beta.hc.totpSecret);
    const after = await call(t, 'GET', `/api/v1/games/${game.gameId}/assets`, undefined, alpha.hc.cookie);
    expect(after.body.items.every((a: any) => a.status === 'deleted')).toBe(true);
    const audit = await call(t, 'GET', `/api/v1/teams/${alpha.team.id}/audit`, undefined, alpha.hc.cookie);
    expect(audit.body.items.filter((e: any) => e.action === 'retention.applied')).toHaveLength(live.length);
    // beta's film is untouched
    expect((await call(t, 'GET', `/api/v1/games/${betaGame.gameId}/assets`, undefined, beta.hc.cookie)).body.items.every((a: any) => a.status !== 'deleted')).toBe(true);
  });
});
