import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { call, makeTestApp, seedTeamWithStaff, type TestApp } from './helpers.js';
import { CONTEXT, FIXTURE_CLIPS, seedGame, uploadFile } from './media-helpers.js';
import { mediaAssets, modelProvenance, processingJobs } from '../db/schema.js';
import { runMaintenance } from '../jobs/worker.js';

/** Nothing listens on port 1; connection refused is immediate. */
const UNREACHABLE_OLLAMA = 'http://127.0.0.1:1';
let t: TestApp;
let alpha: Awaited<ReturnType<typeof seedTeamWithStaff>>;
let beta: Awaited<ReturnType<typeof seedTeamWithStaff>>;
let game: { gameId: string; opponentId: string };
type Chain = { assetId: string; jobs: Record<string, string> };
let A: Chain;
let B: Chain;
let C: Chain;

async function upload(file: string): Promise<Chain> {
  const r = await uploadFile(t, alpha.oc.cookie, game.gameId, file, { chunkSize: 2_000_000 });
  expect(r.complete.status).toBe(200);
  const jobs: Record<string, string> = {};
  for (const j of r.complete.body.jobs) jobs[j.kind] = j.id;
  t.clock.advanceMs(1000); // distinct createdAt so claim order is deterministic
  return { assetId: r.complete.body.asset.id, jobs };
}

async function job(id: string, cookie = alpha.oc.cookie) {
  const res = await call(t, 'GET', `/api/v1/jobs/${id}`, undefined, cookie);
  expect(res.status).toBe(200);
  return res.body.job;
}

async function waitFor(pred: () => boolean | Promise<boolean>, ms = 15_000): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await pred()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('condition not met in time');
}

beforeAll(async () => {
  // OLLAMA_HOST points at a closed port: the preflight fails fast with "unreachable" and no frame is extracted.
  t = makeTestApp({ UPLOAD_CHUNK_BYTES: String(2_000_000), JOB_MAX_ATTEMPTS: '2', OLLAMA_HOST: UNREACHABLE_OLLAMA });
  alpha = await seedTeamWithStaff(t, 'Alpha (demo)');
  beta = await seedTeamWithStaff(t, 'Beta (demo)');
  game = await seedGame(t, alpha.hc.cookie, alpha.team.id, alpha.season.id);
  A = await upload(FIXTURE_CLIPS[0]!);
  B = await upload(FIXTURE_CLIPS[1]!);
  C = await upload(FIXTURE_CLIPS[2]!);
});
afterAll(() => t.close());

describe('§14.2 jobs: cancel, retry, recovery', () => {
  it('lists team jobs with filters and pagination; other teams see 404', async () => {
    const all = await call(t, 'GET', `/api/v1/teams/${alpha.team.id}/jobs`, undefined, alpha.vw.cookie);
    expect(all.status).toBe(200);
    expect(all.body.items).toHaveLength(12);
    const page = await call(t, 'GET', `/api/v1/teams/${alpha.team.id}/jobs?limit=5`, undefined, alpha.vw.cookie);
    expect(page.body.items).toHaveLength(5);
    expect(page.body.nextCursor).not.toBeNull();
    const next = await call(t, 'GET', `/api/v1/teams/${alpha.team.id}/jobs?limit=5&cursor=${encodeURIComponent(page.body.nextCursor)}`, undefined, alpha.vw.cookie);
    expect(next.body.items).toHaveLength(5);
    expect(new Set([...page.body.items, ...next.body.items].map((j: any) => j.id)).size).toBe(10);
    const byAsset = await call(t, 'GET', `/api/v1/teams/${alpha.team.id}/jobs?assetId=${A.assetId}&status=queued,running`, undefined, alpha.vw.cookie);
    expect(byAsset.body.items.map((j: any) => j.kind).sort()).toEqual(['proxy', 'segment', 'thumbnails', 'validate']);
    expect((await call(t, 'GET', `/api/v1/teams/${alpha.team.id}/jobs`, undefined, beta.hc.cookie)).status).toBe(404);
    expect((await call(t, 'GET', `/api/v1/jobs/${A.jobs.validate}`, undefined, beta.hc.cookie)).status).toBe(404);
    expect((await call(t, 'POST', `/api/v1/jobs/${A.jobs.validate}/cancel`, undefined, beta.hc.cookie)).status).toBe(404);
    expect((await call(t, 'POST', `/api/v1/jobs/${A.jobs.validate}/retry`, undefined, beta.hc.cookie)).status).toBe(404);
  });

  it('claims the chain in order; a running proxy job is canceled mid-flight and its dependents fail with upstream_failed', async () => {
    const first = await t.ctx.runner.runOnce();
    expect(first?.id).toBe(A.jobs.validate);
    expect(first?.status).toBe('succeeded');
    expect((await call(t, 'GET', `/api/v1/assets/${A.assetId}`, undefined, alpha.oc.cookie)).body.asset.status).toBe('validated');
    // the proxy job is next; cancel it while ffmpeg is encoding
    const running = t.ctx.runner.runOnce();
    await waitFor(async () => (await t.ctx.jobStore.get(A.jobs.proxy!))?.status === 'running');
    expect((await call(t, 'POST', `/api/v1/jobs/${A.jobs.proxy}/cancel`, undefined, alpha.vw.cookie)).status).toBe(403);
    const cancel = await call(t, 'POST', `/api/v1/jobs/${A.jobs.proxy}/cancel`, undefined, alpha.oc.cookie);
    expect(cancel.status).toBe(200);
    expect(cancel.body.job.cancelRequestedAt).not.toBeNull();
    const finished = await running;
    expect(finished?.id).toBe(A.jobs.proxy);
    expect(finished?.status).toBe('canceled');
    expect((await job(A.jobs.proxy!)).canceledAt).not.toBeNull();
    for (const k of ['thumbnails', 'segment']) {
      const j = await job(A.jobs[k]!);
      expect(j.status).toBe('canceled');
      expect(j.error.code).toBe('upstream_failed');
    }
    expect(fs.existsSync(path.join(t.dataDir, 'media', alpha.team.id, A.assetId, 'proxy.mp4'))).toBe(false);
    expect((await call(t, 'POST', `/api/v1/jobs/${A.jobs.proxy}/cancel`, undefined, alpha.oc.cookie)).status).toBe(409);
  });

  it('retry re-queues the canceled job and its upstream_failed dependents with the same idempotency key; the chain then completes', async () => {
    const before = await job(A.jobs.proxy!);
    expect((await call(t, 'POST', `/api/v1/jobs/${A.jobs.validate}/retry`, undefined, alpha.oc.cookie)).status).toBe(409); // succeeded jobs are not retried
    const retry = await call(t, 'POST', `/api/v1/jobs/${A.jobs.proxy}/retry`, undefined, alpha.oc.cookie);
    expect(retry.status).toBe(200);
    expect(retry.body.job.status).toBe('queued');
    expect(retry.body.job.attempt).toBe(0);
    expect(retry.body.job.idempotencyKey).toBe(before.idempotencyKey);
    expect((await job(A.jobs.thumbnails!)).status).toBe('queued');
    expect((await job(A.jobs.segment!)).status).toBe('queued');
    for (const kind of ['proxy', 'thumbnails', 'segment']) {
      const j = await t.ctx.runner.runOnce();
      expect(j?.id, kind).toBe(A.jobs[kind]);
      expect(j?.status, kind).toBe('succeeded');
    }
    const asset = (await call(t, 'GET', `/api/v1/assets/${A.assetId}`, undefined, alpha.oc.cookie)).body.asset;
    expect(asset.status).toBe('ready');
    expect(asset.proxyStorageKey).not.toBeNull();
    expect((await job(A.jobs.proxy!)).attempt).toBe(1);
  });

  it('a non-retryable failure fails the chain and the asset; retry after fixing the cause succeeds', async () => {
    const original = path.join(t.dataDir, 'media', alpha.team.id, B.assetId, 'original.mp4');
    fs.renameSync(original, `${original}.away`);
    const failed = await t.ctx.runner.runOnce();
    expect(failed?.id).toBe(B.jobs.validate);
    expect(failed?.status).toBe('failed');
    expect(failed?.error?.code).toBe('source_missing');
    expect(failed?.error?.retryable).toBe(false);
    expect((await job(B.jobs.proxy!)).error.code).toBe('upstream_failed');
    expect((await call(t, 'GET', `/api/v1/assets/${B.assetId}`, undefined, alpha.oc.cookie)).body.asset.status).toBe('failed');
    fs.renameSync(`${original}.away`, original);
    const retry = await call(t, 'POST', `/api/v1/jobs/${B.jobs.validate}/retry`, undefined, alpha.oc.cookie);
    expect(retry.status).toBe(200);
    expect((await job(B.jobs.segment!)).status).toBe('queued');
    for (const kind of ['validate', 'proxy', 'thumbnails', 'segment']) {
      const j = await t.ctx.runner.runOnce();
      expect(j?.id, kind).toBe(B.jobs[kind]);
      expect(j?.status, kind).toBe('succeeded');
    }
    expect((await call(t, 'GET', `/api/v1/assets/${B.assetId}`, undefined, alpha.oc.cookie)).body.asset.status).toBe('ready');
  });

  it('restart recovery (§14.10, QA D-2): an orphaned running job is re-claimed once its lease expires, recovered by the maintenance tick, and failed when no attempts remain', async () => {
    const past = new Date(t.clock.now.getTime() - 60_000).toISOString();
    // (a) claim() takes a `running` row whose lease has expired: no recover(), no worker restart.
    t.ctx.db.update(processingJobs).set({ status: 'running', workerId: 'dead-worker', attempt: 1, leaseExpiresAt: past, startedAt: past }).where(eq(processingJobs.id, C.jobs.validate!)).run();
    expect((await job(C.jobs.validate!)).status).toBe('running');
    const reclaimed = await t.ctx.runner.runOnce();
    expect(reclaimed?.id).toBe(C.jobs.validate);
    expect(reclaimed?.status).toBe('succeeded');
    expect(reclaimed?.attempt).toBe(2);
    expect(reclaimed?.workerId).toBe(t.ctx.runner.workerId);
    // (b) a lease still in the future is not claimable; when the injected clock passes it, the maintenance tick re-queues the job.
    const future = new Date(t.clock.now.getTime() + 90_000).toISOString();
    t.ctx.db.update(processingJobs).set({ status: 'running', workerId: 'dead-worker', attempt: 1, leaseExpiresAt: future, startedAt: past }).where(eq(processingJobs.id, C.jobs.proxy!)).run();
    expect(await t.ctx.runner.runOnce()).toBeNull();
    expect((await runMaintenance(t.ctx)).recoveredLeases).toBe(0);
    t.clock.advanceMs(91_000);
    expect((await runMaintenance(t.ctx)).recoveredLeases).toBe(1);
    const requeued = await job(C.jobs.proxy!);
    expect(requeued.status).toBe('queued');
    expect(requeued.workerId).toBeNull();
    expect(requeued.error.code).toBe('lease_expired');
    const again = await t.ctx.runner.runOnce();
    expect(again?.id).toBe(C.jobs.proxy);
    expect(again?.status).toBe('succeeded');
    expect(again?.attempt).toBe(2);
    // (c) an expiry with no attempts left (JOB_MAX_ATTEMPTS=2) is never re-claimed; recovery ends it `failed` and the dependents upstream_failed.
    t.ctx.db.update(processingJobs).set({ status: 'running', workerId: 'dead-worker', attempt: 2, leaseExpiresAt: past }).where(eq(processingJobs.id, C.jobs.thumbnails!)).run();
    expect(await t.ctx.runner.runOnce()).toBeNull();
    const exhausted = await t.ctx.runner.recover();
    expect(exhausted.map((j) => j.id)).toEqual([C.jobs.thumbnails]);
    expect(exhausted[0]!.status).toBe('failed');
    expect((await job(C.jobs.segment!)).error.code).toBe('upstream_failed');
  });
});

describe('§14.5 inference with Ollama unreachable, §14.2 cost accounting', () => {
  it('Ollama unreachable: the infer job fails immediately with provider_unavailable, retryable false, naming the host', async () => {
    const res = await call(t, 'POST', `/api/v1/assets/${A.assetId}/infer`, {}, alpha.an.cookie);
    expect(res.status).toBe(202);
    expect(res.body.jobs).toHaveLength(1);
    expect(res.body.jobs[0].kind).toBe('infer_labels');
    const j = await t.ctx.runner.runOnce();
    expect(j?.id).toBe(res.body.jobs[0].id);
    expect(j?.status).toBe('failed');
    expect(j?.error).toMatchObject({ code: 'provider_unavailable', retryable: false });
    expect(j?.error?.message).toContain(`unreachable: Ollama is not reachable at ${UNREACHABLE_OLLAMA} (OLLAMA_HOST)`);
    expect(j?.error?.message).toContain('ollama serve');
    expect((await call(t, 'GET', `/api/v1/assets/${A.assetId}/provenance`, undefined, alpha.oc.cookie)).body.items).toHaveLength(0);
    expect((await call(t, 'GET', `/api/v1/assets/${A.assetId}`, undefined, alpha.oc.cookie)).body.asset.status).toBe('ready');
    // a second request after the failure creates a new generation rather than returning the failed job
    const again = await call(t, 'POST', `/api/v1/assets/${A.assetId}/infer`, {}, alpha.an.cookie);
    expect(again.status).toBe(202);
    expect(again.body.jobs[0].id).not.toBe(res.body.jobs[0].id);
    expect(again.body.jobs[0].status).toBe('queued');
    // while pending, the same request returns the pending job
    const dup = await call(t, 'POST', `/api/v1/assets/${A.assetId}/infer`, {}, alpha.an.cookie);
    expect(dup.body.jobs[0].id).toBe(again.body.jobs[0].id);
    expect((await call(t, 'POST', `/api/v1/assets/${A.assetId}/infer`, {}, alpha.vw.cookie)).status).toBe(403);
    expect((await call(t, 'POST', `/api/v1/assets/${A.assetId}/infer`, {}, beta.hc.cookie)).status).toBe(404);
  });

  it('usage sums model_provenance.costUsd and tokens for the month and reports no cap (local inference)', async () => {
    const zero = await call(t, 'GET', `/api/v1/teams/${alpha.team.id}/usage`, undefined, alpha.vw.cookie);
    expect(zero.body.costUsd).toBe(0);
    const at = t.clock.now.toISOString();
    const prov = (id: string, cost: number, completedAt: string) => ({
      id, teamId: alpha.team.id, assetId: A.assetId, segmentId: null, jobId: null, provider: 'ollama', model: 'qwen3-vl:4b', modelRevision: null, promptId: 'label-segment', promptHash: 'x',
      preprocessing: { samplingFps: 1, frameCount: 4, clipSec: 6, resolution: '1280x720' }, inspected: { fromSec: 0, toSec: 6, frameTimestampsSec: [0, 2, 4, 6] }, analysisVersion: '0.1.0',
      inputTokens: 1000, outputTokens: 200, costUsd: cost, latencyMs: 1500, requestedAt: completedAt, completedAt,
    });
    t.ctx.db.insert(modelProvenance).values([prov(crypto.randomUUID(), 0.25, at), prov(crypto.randomUUID(), 0.5, at), prov(crypto.randomUUID(), 9, '2026-09-30T23:59:59.000Z')]).run();
    const usage = await call(t, 'GET', `/api/v1/teams/${alpha.team.id}/usage`, undefined, alpha.vw.cookie);
    expect(usage.body.month).toBe(at.slice(0, 7));
    expect(usage.body.costUsd).toBe(0.75);
    expect(usage.body.inputTokens).toBe(2000);
    expect(usage.body.monthlyCostCapUsd).toBeNull();
    expect(usage.body.jobsSucceeded).toBeGreaterThan(0);
    expect(usage.body.jobsFailed).toBeGreaterThan(0);
    expect(usage.body.byKind[0].kind).toBe('infer_labels');
  });
});

describe('§14.10 (QA D-4) the Ollama preflight runs before any frame is extracted', () => {
  async function failedInfer(app: TestApp) {
    const staff = await seedTeamWithStaff(app, 'Gamma (demo)');
    const g = await seedGame(app, staff.hc.cookie, staff.team.id, staff.season.id);
    const r = await uploadFile(app, staff.hc.cookie, g.gameId, FIXTURE_CLIPS[0]!, { chunkSize: 2_000_000 });
    const assetId = r.complete.body.asset.id;
    app.ctx.db.update(mediaAssets).set({ status: 'validated', durationSec: 6.3, fps: 29.97 }).where(eq(mediaAssets.id, assetId)).run();
    expect((await call(app, 'POST', `/api/v1/assets/${assetId}/segments`, { startSec: 0, endSec: 3 }, staff.hc.cookie)).status).toBe(201);
    const infer = await call(app, 'POST', `/api/v1/assets/${assetId}/infer`, { labelKeys: ['play_type'] }, staff.hc.cookie);
    expect(infer.status).toBe(202);
    // the chain's validate job is older; cancel it so the infer job is reached without doing the ffmpeg work
    for (const k of ['validate', 'proxy', 'thumbnails', 'segment']) await call(app, 'POST', `/api/v1/jobs/${r.complete.body.jobs.find((j: any) => j.kind === k).id}/cancel`, undefined, staff.hc.cookie);
    const j = await app.ctx.runner.runOnce();
    expect(j?.kind).toBe('infer_labels');
    expect(j?.status).toBe('failed');
    expect(j?.error?.retryable).toBe(false);
    expect((await call(app, 'GET', `/api/v1/assets/${assetId}/provenance`, undefined, staff.hc.cookie)).body.items).toHaveLength(0);
    return j!;
  }

  it('a bare host:port in OLLAMA_HOST is accepted, and an unreachable server fails the job with the fix in the message, no provenance written', async () => {
    const app = makeTestApp({ OLLAMA_HOST: '127.0.0.1:1' });
    try {
      expect(app.ctx.config.ai.ollamaHost).toBe('http://127.0.0.1:1');
      const j = await failedInfer(app);
      expect(j.error?.code).toBe('provider_unavailable');
      expect(j.error?.message).toContain('unreachable: Ollama is not reachable at http://127.0.0.1:1 (OLLAMA_HOST)');
      expect(j.error?.message).toContain('ollama serve');
      expect(j.error?.message).toContain('manual labeling remains available');
    } finally {
      app.close();
    }
  });
});

void CONTEXT;
