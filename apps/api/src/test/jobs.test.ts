import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { call, makeTestApp, seedTeamWithStaff, type TestApp } from './helpers.js';
import { CONTEXT, FIXTURE_CLIPS, seedGame, uploadFile } from './media-helpers.js';
import { mediaAssets, modelProvenance, processingJobs } from '../db/schema.js';

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
  t = makeTestApp({ UPLOAD_CHUNK_BYTES: String(2_000_000), JOB_MAX_ATTEMPTS: '2', MODEL_PROVIDER: 'none' });
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

  it('restart recovery: a job whose worker died (expired lease) is re-queued by recover() and claimed again', async () => {
    const past = new Date(t.clock.now.getTime() - 60_000).toISOString();
    t.ctx.db.update(processingJobs).set({ status: 'running', workerId: 'dead-worker', attempt: 1, leaseExpiresAt: past, startedAt: past }).where(eq(processingJobs.id, C.jobs.validate!)).run();
    expect((await job(C.jobs.validate!)).status).toBe('running');
    expect(await t.ctx.runner.runOnce()).toBeNull(); // nothing claimable while the (expired) lease is still recorded as running
    const recovered = await t.ctx.runner.recover();
    expect(recovered.map((j) => j.id)).toEqual([C.jobs.validate]);
    expect(recovered[0]!.status).toBe('queued');
    expect(recovered[0]!.error?.code).toBe('lease_expired');
    const again = await t.ctx.runner.runOnce();
    expect(again?.id).toBe(C.jobs.validate);
    expect(again?.status).toBe('succeeded');
    expect(again?.attempt).toBe(2);
    // a second expiry with no attempts left ends `failed`
    t.ctx.db.update(processingJobs).set({ status: 'running', workerId: 'dead-worker', attempt: 2, leaseExpiresAt: past }).where(eq(processingJobs.id, C.jobs.proxy!)).run();
    const exhausted = await t.ctx.runner.recover();
    expect(exhausted[0]!.status).toBe('failed');
    expect((await job(C.jobs.thumbnails!)).error.code).toBe('upstream_failed');
  });
});

describe('§14.5 inference without a provider, §14.2 cost accounting', () => {
  it('MODEL_PROVIDER=none: the infer job fails immediately with provider_unavailable, retryable false', async () => {
    const res = await call(t, 'POST', `/api/v1/assets/${A.assetId}/infer`, {}, alpha.an.cookie);
    expect(res.status).toBe(202);
    expect(res.body.jobs).toHaveLength(1);
    expect(res.body.jobs[0].kind).toBe('infer_labels');
    const j = await t.ctx.runner.runOnce();
    expect(j?.id).toBe(res.body.jobs[0].id);
    expect(j?.status).toBe('failed');
    expect(j?.error).toEqual({ code: 'provider_unavailable', message: 'No model provider is configured', retryable: false });
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

  it('usage sums model_provenance.costUsd for the month and reports the cap from env', async () => {
    const zero = await call(t, 'GET', `/api/v1/teams/${alpha.team.id}/usage`, undefined, alpha.vw.cookie);
    expect(zero.body.costUsd).toBe(0);
    const at = t.clock.now.toISOString();
    const prov = (id: string, cost: number, completedAt: string) => ({
      id, teamId: alpha.team.id, assetId: A.assetId, segmentId: null, jobId: null, provider: 'anthropic', model: 'demo-model', modelRevision: null, promptId: 'label-segment', promptHash: 'x',
      preprocessing: { samplingFps: 1, frameCount: 4, clipSec: 6, resolution: '1280x720' }, inspected: { fromSec: 0, toSec: 6, frameTimestampsSec: [0, 2, 4, 6] }, analysisVersion: '0.1.0',
      inputTokens: 1000, outputTokens: 200, costUsd: cost, latencyMs: 1500, requestedAt: completedAt, completedAt,
    });
    t.ctx.db.insert(modelProvenance).values([prov(crypto.randomUUID(), 0.25, at), prov(crypto.randomUUID(), 0.5, at), prov(crypto.randomUUID(), 9, '2026-09-30T23:59:59.000Z')]).run();
    const usage = await call(t, 'GET', `/api/v1/teams/${alpha.team.id}/usage`, undefined, alpha.vw.cookie);
    expect(usage.body.month).toBe(at.slice(0, 7));
    expect(usage.body.costUsd).toBe(0.75);
    expect(usage.body.inputTokens).toBe(2000);
    expect(usage.body.monthlyCostCapUsd).toBe(0);
    expect(usage.body.jobsSucceeded).toBeGreaterThan(0);
    expect(usage.body.jobsFailed).toBeGreaterThan(0);
    expect(usage.body.byKind[0].kind).toBe('infer_labels');
  });
});

describe('monthly cap with a configured provider', () => {
  it('refuses to start infer_labels with budget_exceeded when the cap is reached, and reports no_api_key truthfully under the cap', async () => {
    const capped = makeTestApp({ MODEL_PROVIDER: 'anthropic', MONTHLY_COST_CAP_USD: '0' });
    try {
      const staff = await seedTeamWithStaff(capped, 'Gamma (demo)');
      const g = await seedGame(capped, staff.hc.cookie, staff.team.id, staff.season.id);
      const r = await uploadFile(capped, staff.hc.cookie, g.gameId, FIXTURE_CLIPS[0]!, { chunkSize: 2_000_000 });
      const assetId = r.complete.body.asset.id;
      capped.ctx.db.update(mediaAssets).set({ status: 'validated', durationSec: 6.3, fps: 29.97 }).where(eq(mediaAssets.id, assetId)).run();
      expect((await call(capped, 'POST', `/api/v1/assets/${assetId}/segments`, { startSec: 0, endSec: 3 }, staff.hc.cookie)).status).toBe(201);
      const infer = await call(capped, 'POST', `/api/v1/assets/${assetId}/infer`, { labelKeys: ['play_type'] }, staff.hc.cookie);
      expect(infer.status).toBe(202);
      // the chain's validate job is older; run until the infer job is reached without doing the ffmpeg work
      for (const k of ['validate', 'proxy', 'thumbnails', 'segment']) await call(capped, 'POST', `/api/v1/jobs/${r.complete.body.jobs.find((j: any) => j.kind === k).id}/cancel`, undefined, staff.hc.cookie);
      const j = await capped.ctx.runner.runOnce();
      expect(j?.kind).toBe('infer_labels');
      expect(j?.status).toBe('failed');
      expect(j?.error?.code).toBe('budget_exceeded');
      expect(j?.error?.retryable).toBe(false);
    } finally {
      capped.close();
    }
    const under = makeTestApp({ MODEL_PROVIDER: 'anthropic', MONTHLY_COST_CAP_USD: '5', ANTHROPIC_API_KEY: '' });
    try {
      const staff = await seedTeamWithStaff(under, 'Delta (demo)');
      const g = await seedGame(under, staff.hc.cookie, staff.team.id, staff.season.id);
      const r = await uploadFile(under, staff.hc.cookie, g.gameId, FIXTURE_CLIPS[0]!, { chunkSize: 2_000_000 });
      const assetId = r.complete.body.asset.id;
      under.ctx.db.update(mediaAssets).set({ status: 'validated' }).where(eq(mediaAssets.id, assetId)).run();
      await call(under, 'POST', `/api/v1/assets/${assetId}/segments`, { startSec: 0, endSec: 3 }, staff.hc.cookie);
      await call(under, 'POST', `/api/v1/assets/${assetId}/infer`, {}, staff.hc.cookie);
      for (const k of ['validate', 'proxy', 'thumbnails', 'segment']) await call(under, 'POST', `/api/v1/jobs/${r.complete.body.jobs.find((j: any) => j.kind === k).id}/cancel`, undefined, staff.hc.cookie);
      const j = await under.ctx.runner.runOnce();
      expect(j?.kind).toBe('infer_labels');
      expect(j?.status).toBe('failed');
      expect(j?.error?.code).toBe('provider_unavailable');
      expect(j?.error?.retryable).toBe(false);
      expect(j?.error?.message).toMatch(/No model provider is configured|no_api_key|API key/i);
    } finally {
      under.close();
    }
  });
});

void CONTEXT;
