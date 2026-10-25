import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { InferLabelsResult } from '@footballos/ai';
import type { Job } from '@footballos/media';
import { call, makeTestApp, seedTeamWithStaff, type TestApp } from './helpers.js';
import { FIXTURE_CLIPS, seedGame, uploadFile } from './media-helpers.js';
import { mediaAssets } from '../db/schema.js';

let t: TestApp;
let alpha: Awaited<ReturnType<typeof seedTeamWithStaff>>;
let beta: Awaited<ReturnType<typeof seedTeamWithStaff>>;
let game: { gameId: string; opponentId: string };
let assetId: string;
let seg: string[] = [];

const provenance = (id: string) => ({
  id, provider: 'anthropic' as const, model: 'demo-model', modelRevision: null, promptId: 'label-segment', promptHash: 'abc', analysisVersion: '0.1.0',
  preprocessing: { samplingFps: 1, frameCount: 2, clipSec: 2, resolution: '1280x720' }, inspected: { fromSec: 0, toSec: 2, frameTimestampsSec: [0, 1] },
  inputTokens: 500, outputTokens: 100, costUsd: 0.01, latencyMs: 900, requestedAt: '2026-10-25T12:00:00.000Z', completedAt: '2026-10-25T12:00:01.000Z',
});
const inferred = (key: string, value: string | null, abstained = false) => ({
  key: key as any, inferred: { value, abstained, rationale: abstained ? 'not visible' : `looks like ${value}`, evidence: abstained ? [] : [{ assetId, atSec: 0.5, toSec: null, frameIndex: 0, note: null }], uncertainty: abstained ? null : ('low' as const) },
});

/** Persists an inference exactly as the worker does: through the store's transactional hook. */
function persistInference(result: InferLabelsResult): void {
  const job: Job = {
    id: crypto.randomUUID(), teamId: alpha.team.id, assetId, kind: 'infer_labels', status: 'succeeded', progress: { done: 1, total: 1, message: 'done' }, attempt: 1, maxAttempts: 3,
    leaseExpiresAt: null, workerId: 'test', idempotencyKey: 'x', configVersion: 'test', error: null, requestedBy: alpha.oc.user.id, createdAt: t.clock.now.toISOString(),
    startedAt: null, finishedAt: null, canceledAt: null, input: null, result, notBeforeAt: null, cancelRequestedAt: null,
  };
  t.ctx.db.transaction((tx) => t.ctx.jobStore.hooks.onSucceeded!(job, result, tx));
}

async function labelsOf(segmentId: string, cookie = alpha.vw.cookie): Promise<Record<string, any>> {
  const res = await call(t, 'GET', `/api/v1/segments/${segmentId}/labels`, undefined, cookie);
  expect(res.status).toBe(200);
  return Object.fromEntries(res.body.items.map((l: any) => [l.key, l]));
}

beforeAll(async () => {
  t = makeTestApp({ UPLOAD_CHUNK_BYTES: String(2_000_000), MODEL_PROVIDER: 'none' });
  alpha = await seedTeamWithStaff(t, 'Alpha (demo)');
  beta = await seedTeamWithStaff(t, 'Beta (demo)');
  game = await seedGame(t, alpha.hc.cookie, alpha.team.id, alpha.season.id);
  const r = await uploadFile(t, alpha.oc.cookie, game.gameId, FIXTURE_CLIPS[0]!, { chunkSize: 2_000_000 });
  assetId = r.complete.body.asset.id;
  // validated without running ffmpeg: this suite is about records, the chain is covered in media.test.ts
  t.ctx.db.update(mediaAssets).set({ status: 'validated', durationSec: 6.374, fps: 29.97 }).where(eq(mediaAssets.id, assetId)).run();
  for (const j of r.complete.body.jobs) await t.ctx.runner.requestCancel(j.id);
});
afterAll(() => t.close());

describe('§14.4 coach-created segments', () => {
  it('creates ordered segments with default labels; overlaps are 409; viewers 403; other teams 404', async () => {
    for (const [s, e] of [[4, 6], [0, 2], [2, 4]] as const) {
      const res = await call(t, 'POST', `/api/v1/assets/${assetId}/segments`, { startSec: s, endSec: e }, alpha.pc.cookie);
      expect(res.status).toBe(201);
      expect(res.body.segment.origin).toBe('coach_created');
      expect(res.body.segment.reviewStatus).toBe('accepted');
    }
    const list = await call(t, 'GET', `/api/v1/assets/${assetId}/segments`, undefined, alpha.vw.cookie);
    expect(list.body.items.map((s: any) => [s.index, s.startSec])).toEqual([[0, 0], [1, 2], [2, 4]]);
    seg = list.body.items.map((s: any) => s.id);
    expect((await call(t, 'POST', `/api/v1/assets/${assetId}/segments`, { startSec: 1, endSec: 3 }, alpha.pc.cookie)).status).toBe(409);
    expect((await call(t, 'POST', `/api/v1/assets/${assetId}/segments`, { startSec: 6, endSec: 6.2 }, alpha.vw.cookie)).status).toBe(403);
    expect((await call(t, 'POST', `/api/v1/assets/${assetId}/segments`, { startSec: 6, endSec: 6.2 }, beta.hc.cookie)).status).toBe(404);
    expect((await call(t, 'GET', `/api/v1/assets/${assetId}/segments`, undefined, beta.hc.cookie)).status).toBe(404);
    expect((await call(t, 'GET', `/api/v1/segments/${seg[0]}/labels`, undefined, beta.hc.cookie)).status).toBe(404);
    const labels = await labelsOf(seg[0]!);
    expect(Object.keys(labels)).toHaveLength(12);
    expect(labels.play_type.accepted).toEqual({ value: null, status: 'unknown', byUserId: null, at: null });
  });
});

describe('§14.5 corrections, inference persistence, bulk accept', () => {
  it('a coach corrects a label: new accepted block, version bump, revision row; stale version 409; role and team checks', async () => {
    const l = (await labelsOf(seg[0]!)).formation_family;
    const body = { accepted: { value: 'trips right', status: 'corrected' }, reason: 'three receivers to the field', expectedVersion: 1 };
    expect((await call(t, 'PATCH', `/api/v1/labels/${l.id}`, body, alpha.vw.cookie)).status).toBe(403);
    expect((await call(t, 'PATCH', `/api/v1/labels/${l.id}`, body, beta.hc.cookie)).status).toBe(404);
    const ok = await call(t, 'PATCH', `/api/v1/labels/${l.id}`, body, alpha.pc.cookie);
    expect(ok.status).toBe(200);
    expect(ok.body.label.version).toBe(2);
    expect(ok.body.label.accepted).toMatchObject({ value: 'trips right', status: 'corrected', byUserId: alpha.pc.user.id });
    const stale = await call(t, 'PATCH', `/api/v1/labels/${l.id}`, body, alpha.pc.cookie);
    expect(stale.status).toBe(409);
    expect(stale.body.error.details.currentVersion).toBe(2);
    const revs = await call(t, 'GET', `/api/v1/labels/${l.id}/revisions`, undefined, alpha.vw.cookie);
    expect(revs.body.items).toHaveLength(1);
    expect(revs.body.items[0]).toMatchObject({ previousValue: null, newValue: 'trips right', previousStatus: 'unknown', newStatus: 'corrected', byUserId: alpha.pc.user.id, reason: 'three receivers to the field' });
    expect((await call(t, 'GET', `/api/v1/labels/${l.id}/revisions`, undefined, beta.hc.cookie)).status).toBe(404);
  });

  it('persisting an inference writes provenance and inferred blocks but never overwrites a correction', async () => {
    persistInference({
      perSegment: [
        { segmentId: seg[0]!, labels: [inferred('formation_family', 'spread'), inferred('play_type', 'run')], provenance: provenance(crypto.randomUUID()) },
        { segmentId: seg[1]!, labels: [inferred('formation_family', 'spread'), inferred('play_type', null, true)], provenance: provenance(crypto.randomUUID()) },
        { segmentId: seg[2]!, labels: [inferred('formation_family', 'i_form'), inferred('play_type', 'pass')], provenance: provenance(crypto.randomUUID()) },
      ],
      skipped: [],
      costUsd: 0.03,
    });
    const s0 = await labelsOf(seg[0]!);
    expect(s0.formation_family.accepted.value).toBe('trips right');
    expect(s0.formation_family.accepted.status).toBe('corrected');
    expect(s0.formation_family.inferred.value).toBe('spread');
    expect(s0.formation_family.provenanceId).not.toBeNull();
    expect(s0.formation_family.version).toBe(3);
    expect(s0.play_type.accepted).toMatchObject({ value: 'run', status: 'inferred' });
    const s1 = await labelsOf(seg[1]!);
    expect(s1.play_type.inferred.abstained).toBe(true);
    expect(s1.play_type.accepted.status).toBe('unknown');
    const prov = await call(t, 'GET', `/api/v1/assets/${assetId}/provenance`, undefined, alpha.vw.cookie);
    expect(prov.body.items).toHaveLength(3);
    expect(prov.body.items[0].model).toBe('demo-model');
    const all = await call(t, 'GET', `/api/v1/assets/${assetId}/labels`, undefined, alpha.vw.cookie);
    expect(all.body.items).toHaveLength(36);
    expect((await call(t, 'GET', `/api/v1/assets/${assetId}/provenance`, undefined, beta.hc.cookie)).status).toBe(404);
    expect((await call(t, 'GET', `/api/v1/assets/${assetId}/labels`, undefined, beta.hc.cookie)).status).toBe(404);
  });

  it('bulk-accept changes only inferred, non-abstained labels and skips corrected and abstained ones; audit row written', async () => {
    const body = { segmentIds: seg, keys: ['formation_family', 'play_type'] };
    expect((await call(t, 'POST', `/api/v1/assets/${assetId}/labels/bulk-accept`, body, alpha.vw.cookie)).status).toBe(403);
    expect((await call(t, 'POST', `/api/v1/assets/${assetId}/labels/bulk-accept`, body, beta.hc.cookie)).status).toBe(404);
    const res = await call(t, 'POST', `/api/v1/assets/${assetId}/labels/bulk-accept`, body, alpha.an.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ accepted: 4, skipped: 2 });
    const s0 = await labelsOf(seg[0]!);
    expect(s0.formation_family.accepted.status).toBe('corrected');
    expect(s0.play_type.accepted).toMatchObject({ value: 'run', status: 'accepted', byUserId: alpha.an.user.id });
    const s1 = await labelsOf(seg[1]!);
    expect(s1.formation_family.accepted.status).toBe('accepted');
    expect(s1.play_type.accepted.status).toBe('unknown');
    const again = await call(t, 'POST', `/api/v1/assets/${assetId}/labels/bulk-accept`, body, alpha.an.cookie);
    expect(again.body).toEqual({ accepted: 0, skipped: 6 });
    const audit = await call(t, 'GET', `/api/v1/teams/${alpha.team.id}/audit`, undefined, alpha.hc.cookie);
    expect(audit.body.items.filter((e: any) => e.action === 'labels.bulk_accepted' && e.targetId === assetId)).toHaveLength(2);
  });

  it('a re-run of inference keeps corrected and accepted values and only refreshes the inferred block', async () => {
    persistInference({
      perSegment: [{ segmentId: seg[0]!, labels: [inferred('formation_family', 'bunch'), inferred('play_type', 'pass')], provenance: provenance(crypto.randomUUID()) }],
      skipped: [],
      costUsd: 0.01,
    });
    const s0 = await labelsOf(seg[0]!);
    expect(s0.formation_family.accepted).toMatchObject({ value: 'trips right', status: 'corrected' });
    expect(s0.formation_family.inferred.value).toBe('bunch');
    expect(s0.play_type.accepted).toMatchObject({ value: 'run', status: 'accepted' });
    expect(s0.play_type.inferred.value).toBe('pass');
    expect((await call(t, 'GET', `/api/v1/assets/${assetId}/provenance`, undefined, alpha.vw.cookie)).body.items).toHaveLength(4);
  });

  it('POST /assets/:id/infer with MODEL_PROVIDER=none enqueues a job that fails truthfully and leaves labels untouched', async () => {
    const res = await call(t, 'POST', `/api/v1/assets/${assetId}/infer`, { segmentIds: [seg[0]], labelKeys: ['play_type'] }, alpha.oc.cookie);
    expect(res.status).toBe(202);
    const j = await t.ctx.runner.runOnce();
    expect(j?.kind).toBe('infer_labels');
    expect(j?.error).toEqual({ code: 'provider_unavailable', message: 'No model provider is configured', retryable: false });
    expect((await labelsOf(seg[0]!)).play_type.accepted.value).toBe('run');
  });
});

describe('§14.4 split, merge, patch', () => {
  let parts: string[];
  it('split keeps the original as superseded and renumbers; merge folds live segments back', async () => {
    const stale = await call(t, 'POST', `/api/v1/segments/${seg[2]}/split`, { atSec: 5, expectedVersion: 9 }, alpha.oc.cookie);
    expect(stale.status).toBe(409);
    expect((await call(t, 'POST', `/api/v1/segments/${seg[2]}/split`, { atSec: 7, expectedVersion: 1 }, alpha.oc.cookie)).status).toBe(400);
    expect((await call(t, 'POST', `/api/v1/segments/${seg[2]}/split`, { atSec: 5, expectedVersion: 1 }, beta.hc.cookie)).status).toBe(404);
    expect((await call(t, 'POST', `/api/v1/segments/${seg[2]}/split`, { atSec: 5, expectedVersion: 1 }, alpha.vw.cookie)).status).toBe(403);
    const split = await call(t, 'POST', `/api/v1/segments/${seg[2]}/split`, { atSec: 5, expectedVersion: 1 }, alpha.oc.cookie);
    expect(split.status).toBe(200);
    expect(split.body.segments.map((s: any) => [s.startSec, s.endSec, s.origin, s.index])).toEqual([[4, 5, 'coach_split', 2], [5, 6, 'coach_split', 3]]);
    expect(split.body.superseded.supersededBy).toEqual(split.body.segments.map((s: any) => s.id));
    expect(split.body.superseded.version).toBe(2);
    parts = split.body.segments.map((s: any) => s.id);
    const live = await call(t, 'GET', `/api/v1/assets/${assetId}/segments`, undefined, alpha.vw.cookie);
    expect(live.body.items.map((s: any) => s.id)).toEqual([seg[0], seg[1], ...parts]);
    expect(Object.keys(await labelsOf(parts[0]!))).toHaveLength(12);
    expect((await call(t, 'POST', `/api/v1/segments/${seg[2]}/split`, { atSec: 4.5, expectedVersion: 2 }, alpha.oc.cookie)).status).toBe(409); // already superseded
    const badVersion = await call(t, 'POST', `/api/v1/segments/merge`, { segmentIds: parts, expectedVersion: { [parts[0]!]: 1, [parts[1]!]: 5 } }, alpha.oc.cookie);
    expect(badVersion.status).toBe(409);
    expect((await call(t, 'POST', `/api/v1/segments/merge`, { segmentIds: parts, expectedVersion: { [parts[0]!]: 1, [parts[1]!]: 1 } }, beta.hc.cookie)).status).toBe(404);
    const merge = await call(t, 'POST', `/api/v1/segments/merge`, { segmentIds: parts, expectedVersion: { [parts[0]!]: 1, [parts[1]!]: 1 } }, alpha.oc.cookie);
    expect(merge.status).toBe(200);
    expect(merge.body.segment).toMatchObject({ startSec: 4, endSec: 6, origin: 'coach_merged', index: 2 });
    expect(merge.body.superseded.every((s: any) => s.supersededBy[0] === merge.body.segment.id)).toBe(true);
    const after = await call(t, 'GET', `/api/v1/assets/${assetId}/segments`, undefined, alpha.vw.cookie);
    expect(after.body.items).toHaveLength(3);
    seg[2] = merge.body.segment.id;
  });

  it('PATCH changes review status and bounds with version checks and overlap protection', async () => {
    const ok = await call(t, 'PATCH', `/api/v1/segments/${seg[2]}`, { expectedVersion: 1, reviewStatus: 'proposed', endSec: 6.3 }, alpha.oc.cookie);
    expect(ok.status).toBe(200);
    expect(ok.body.segment).toMatchObject({ version: 2, reviewStatus: 'proposed', endSec: 6.3 });
    expect((await call(t, 'PATCH', `/api/v1/segments/${seg[2]}`, { expectedVersion: 1, reviewStatus: 'accepted' }, alpha.oc.cookie)).status).toBe(409);
    const overlap = await call(t, 'PATCH', `/api/v1/segments/${seg[2]}`, { expectedVersion: 2, startSec: 3 }, alpha.oc.cookie);
    expect(overlap.status).toBe(409);
    expect(overlap.body.error.details.overlapsSegmentId).toBe(seg[1]);
    expect((await call(t, 'PATCH', `/api/v1/segments/${seg[2]}`, { expectedVersion: 2, reviewStatus: 'accepted' }, beta.hc.cookie)).status).toBe(404);
    expect((await call(t, 'PATCH', `/api/v1/segments/${seg[2]}`, { expectedVersion: 2, reviewStatus: 'accepted' }, alpha.vw.cookie)).status).toBe(403);
  });
});

describe('§14.6 scouting from stored labels', () => {
  it('denominators differ between reviewed_only and includes_inferred; snapshots freeze the findings', async () => {
    // merged segment (proposed, unreviewed) gets an inferred-only formation
    persistInference({ perSegment: [{ segmentId: seg[2]!, labels: [inferred('formation_family', 'spread')], provenance: provenance(crypto.randomUUID()) }], skipped: [], costUsd: 0.01 });
    const base = `/api/v1/teams/${alpha.team.id}/opponents/${game.opponentId}/scouting`;
    const reviewed = await call(t, 'GET', `${base}?unit=offense&reviewBasis=reviewed_only`, undefined, alpha.vw.cookie);
    expect(reviewed.status).toBe(200);
    expect(reviewed.body.games).toEqual([{ gameId: game.gameId, assetIds: [assetId] }]);
    expect(reviewed.body.sampleSize).toBe(2); // seg0 and seg1 are accepted; the merged segment is unreviewed
    const ff = reviewed.body.findings.filter((f: any) => f.kind === 'formation_frequency');
    expect(ff.map((f: any) => [f.statement.match(/"([^"]+)"/)![1], f.numerator, f.denominator, f.reviewBasis]).sort()).toEqual([
      ['spread', 1, 2, 'reviewed_only'], ['trips right', 1, 2, 'reviewed_only'],
    ]);
    expect(ff[0].excludedReason[seg[2]!]).toBe('unreviewed');
    const inferredToo = await call(t, 'GET', `${base}?unit=offense&reviewBasis=includes_inferred`, undefined, alpha.vw.cookie);
    expect(inferredToo.body.sampleSize).toBe(3);
    const ff2 = inferredToo.body.findings.filter((f: any) => f.kind === 'formation_frequency');
    expect(ff2.map((f: any) => [f.statement.match(/"([^"]+)"/)![1], f.numerator, f.denominator]).sort()).toEqual([['spread', 2, 3], ['trips right', 1, 3]]);
    const ptf = reviewed.body.findings.find((f: any) => f.kind === 'play_type_by_formation');
    expect(ptf).toMatchObject({ numerator: 1, denominator: 1, percent: 100 });
    expect(ptf.supportingEvidence[0].assetId).toBe(assetId);
    // defense has no eligible plays: no findings, no fabricated counts
    const defense = await call(t, 'GET', `${base}?unit=defense`, undefined, alpha.vw.cookie);
    expect(defense.body.findings).toEqual([]);
    expect(defense.body.sampleSize).toBe(0);
    expect((await call(t, 'GET', `${base}?unit=offense`, undefined, beta.hc.cookie)).status).toBe(404);
    expect((await call(t, 'GET', `/api/v1/teams/${alpha.team.id}/opponents/${crypto.randomUUID()}/scouting?unit=offense`, undefined, alpha.vw.cookie)).status).toBe(404);
    expect((await call(t, 'GET', `${base}`, undefined, alpha.vw.cookie)).status).toBe(400);
    // snapshots
    expect((await call(t, 'POST', `${base}/snapshots`, { title: 'Week 1 (demo)' }, alpha.vw.cookie)).status).toBe(403);
    expect((await call(t, 'POST', `${base}/snapshots`, { title: 'Week 1 (demo)' }, beta.hc.cookie)).status).toBe(404);
    const snap = await call(t, 'POST', `${base}/snapshots`, { title: 'Week 1 (demo)', unit: 'offense', reviewBasis: 'includes_inferred' }, alpha.oc.cookie);
    expect(snap.status).toBe(201);
    expect(snap.body.snapshot.findings.length).toBe(inferredToo.body.findings.length);
    expect(snap.body.snapshot.inputsHash).toBe(inferredToo.body.inputsHash);
    expect(snap.body.snapshot.generatedBy).toBe(alpha.oc.user.id);
    const list = await call(t, 'GET', `${base}/snapshots`, undefined, alpha.vw.cookie);
    expect(list.body.items).toHaveLength(1);
    expect((await call(t, 'GET', `${base}/snapshots`, undefined, beta.hc.cookie)).status).toBe(404);
  });
});
