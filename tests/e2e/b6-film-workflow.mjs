#!/usr/bin/env node
// Independent QA of the Milestone B film workflow API (task B6) with real HTTP requests against a
// running `apps/api` (WORKER_INLINE=true). Plain Node >= 22, no dependencies. See b6-lib.mjs for
// the environment variables (credentials only through env). Scenarios keep ids in a JSON state
// file (`--state <path>`) so that server restarts can happen between invocations.
//
//   node tests/e2e/b6-film-workflow.mjs <scenario> --state <file> [--file play-1.mp4] [--chunk 1048576]
//
// Scenarios (brief B6 checks 1–10):
//   upload                 1. chunked upload, resume state, out-of-order 409, oversize 413, complete, chain, duplicate 409
//   resume-start           2a. upload two chunks and stop (restart the server before resume-finish)
//   resume-finish          2b. GET the upload, resume from receivedBytes, complete, chain finishes
//   restart-start          3a. start a chain and return as soon as `proxy` is running (SIGKILL the server now)
//   restart-verify         3b. after the restart: expired lease re-claimed, chain finished, no duplicates
//   cancel-retry           4. cancel mid-job → canceled + upstream_failed dependents; retry → chain completes
//   provider-none          5a. Ollama not running (OLLAMA_HOST unreachable) → infer_labels fails provider_unavailable, manual PATCH works
//   provider-nokey         5b. Ollama running without the configured model pulled → truthful model_missing failure, no frame extracted
//   corrections            6. correction persists across a segment re-run and an inference re-run
//   scouting               7. known label mix → numerators/denominators vs hand computation; snapshots
//   delivery               8. grant → Range 206, tampered/expired 401, thumb tiles, cross-team 404 sweep
//   retention-set          9a. retentionDays as head coach (0 → 400, 1 → 200, others 403)
//   retention-verify       9b. after the maintenance tick: files removed, record deleted, audit row
//   security               10. ../ filenames, token logging, rejected-upload streaming, unsafe extensions

import fs from 'node:fs';
import path from 'node:path';
import {
  API, DATA_DIR, DEFAULT_CONTEXT, DEMO_FILM, LOG, URL_, arg, assetDir, chainOf, check, client, code, details, finish, isTerminal, listAssetDirs, listJobs, logContains, note,
  pickGame, putChunks, readState, sha256Hex, signIn, sleep, summarizeJobs, uploadBytes, waitJobs, writeState,
} from './b6-lib.mjs';

const scenario = process.argv[2];
const STATE = arg('state', path.join(process.cwd(), 'b6-state.json'));
const FILE = arg('file', 'play-1.mp4');
const CHUNK = Number(arg('chunk', '1048576'));
const state = readState(STATE);
const save = () => writeState(STATE, state);
const fixture = (name) => fs.readFileSync(path.join(DEMO_FILM, name));

const scenarios = {
  upload, 'resume-start': resumeStart, 'resume-finish': resumeFinish, 'restart-start': restartStart, 'restart-verify': restartVerify,
  'restart-probe': restartProbe, 'cancel-retry': cancelRetry, 'finish-chain': finishChain, 'provider-none': providerNone, 'provider-nokey': providerNoKey, corrections, scouting, delivery,
  'retention-set': retentionSet, 'retention-recompute': retentionRecompute, 'retention-verify': retentionVerify, security, 'log-sweep': logSweep,
};
if (!scenarios[scenario]) {
  console.error(`usage: b6-film-workflow.mjs <${Object.keys(scenarios).join('|')}> --state <file>`);
  process.exit(2);
}
await scenarios[scenario]();
save();
finish();

// ---------------------------------------------------------------------------------------------
async function waitReady(c, assetId, label, timeoutMs = 900_000) {
  const jobs = await waitJobs(c, c.teamId, assetId, (js) => js.filter((j) => ['validate', 'proxy', 'thumbnails', 'segment'].includes(j.kind)).length === 4 && js.every(isTerminal), { timeoutMs });
  const chain = chainOf(jobs);
  const asset = (await c.req('GET', `/assets/${assetId}`)).body.asset;
  check(`${label}: chain finished (validate, proxy, thumbnails, segment all succeeded)`, Object.values(chain).length === 4 && Object.values(chain).every((j) => j.status === 'succeeded'), summarizeJobs(jobs));
  check(`${label}: asset is ready with proxy and thumbnail keys`, asset.status === 'ready' && !!asset.proxyStorageKey && !!asset.thumbnailSheetKey, `${asset.status} proxy=${asset.proxyStorageKey} thumbs=${asset.thumbnailSheetKey}`);
  return { jobs, chain, asset };
}

async function segmentsAndLabels(c, assetId) {
  const segs = (await c.req('GET', `/assets/${assetId}/segments`)).body.items ?? [];
  const labels = (await c.req('GET', `/assets/${assetId}/labels`)).body.items ?? [];
  return { segs, labels };
}

// 1 ------------------------------------------------------------------------------------------
async function upload() {
  const c = await signIn('pc');
  const { game } = await pickGame(c);
  state.teamId = c.teamId;
  state.gameId = game.id;
  state.opponentId = game.opponentId;
  const buf = fixture(FILE);
  const hash = sha256Hex(buf);
  const nChunks = Math.ceil(buf.length / CHUNK);
  note(`fixture ${FILE} ${buf.length} bytes sha256=${hash.slice(0, 12)}… chunk=${CHUNK} → ${nChunks} chunks`);

  const create = await c.req('POST', `/games/${game.id}/uploads`, { body: { filename: FILE, byteSize: buf.length, mimeType: 'video/mp4', sha256: hash, context: DEFAULT_CONTEXT } });
  check('POST /games/:gameId/uploads → 201 { upload(receivedBytes 0), asset(uploading, sha256 null) }', create.status === 201 && create.body.upload?.receivedBytes === 0 && create.body.asset?.status === 'uploading' && create.body.asset?.sha256 === null, `${create.status} chunkSizeBytes=${create.body.upload?.chunkSizeBytes} expiresAt=${create.body.upload?.expiresAt}`);
  const upload = create.body.upload;
  const asset = create.body.asset;
  check('upload.chunkSizeBytes equals the server UPLOAD_CHUNK_BYTES used by this run', upload.chunkSizeBytes === CHUNK, `${upload.chunkSizeBytes}`);

  const g0 = await c.req('GET', `/uploads/${upload.id}`);
  check('GET /uploads/:id before any chunk → receivedBytes 0', g0.status === 200 && g0.body.upload.receivedBytes === 0, `${g0.status}`);

  const first = await putChunks(c, upload.id, buf, CHUNK, 0, 1);
  check('PUT chunk 1 (contiguous) → 200 receivedBytes = chunk', first.last.status === 200 && first.receivedBytes === Math.min(CHUNK, buf.length), `${first.last.status} receivedBytes=${first.receivedBytes}`);

  const ooStart = 2 * CHUNK;
  const ooEnd = Math.min(3 * CHUNK, buf.length) - 1;
  const oo = await c.req('PUT', `/uploads/${upload.id}`, { raw: true, body: buf.subarray(ooStart, ooEnd + 1), headers: { 'content-range': `bytes ${ooStart}-${ooEnd}/${buf.length}`, 'content-type': 'application/octet-stream' } });
  check('out-of-order chunk (start = 2×chunk while receivedBytes = chunk) → 409 conflict with details.receivedBytes', oo.status === 409 && code(oo) === 'conflict' && details(oo)?.receivedBytes === first.receivedBytes, `${oo.status} ${code(oo)} receivedBytes=${details(oo)?.receivedBytes}`);

  const big = Buffer.alloc(CHUNK + 1, 1);
  const over = await c.req('PUT', `/uploads/${upload.id}`, { raw: true, body: big, headers: { 'content-range': `bytes ${CHUNK}-${2 * CHUNK}/${buf.length}`, 'content-type': 'application/octet-stream' } });
  check('oversize chunk (chunk+1 bytes) → 413 payload_too_large', over.status === 413 && code(over) === 'payload_too_large', `${over.status} ${code(over)}`);
  const g1 = await c.req('GET', `/uploads/${upload.id}`);
  check('rejected chunks did not advance receivedBytes', g1.body.upload.receivedBytes === first.receivedBytes, `${g1.body.upload.receivedBytes}`);

  const rest = await putChunks(c, upload.id, buf, CHUNK, first.receivedBytes);
  check(`remaining ${rest.sent} chunks contiguous → 200, receivedBytes = total`, rest.last?.status === 200 && rest.receivedBytes === buf.length, `${rest.last?.status} receivedBytes=${rest.receivedBytes}`);
  const g2 = await c.req('GET', `/uploads/${upload.id}`);
  check('GET /uploads/:id resume state shows receivedBytes = totalBytes', g2.body.upload.receivedBytes === buf.length && g2.body.upload.totalBytes === buf.length && g2.body.upload.completedAt === null, JSON.stringify(g2.body.upload).slice(0, 160));

  const done = await c.req('POST', `/uploads/${upload.id}/complete`, { body: { sha256: hash } });
  const kinds = (done.body?.jobs ?? []).map((j) => j.kind);
  check('POST /uploads/:id/complete → 200 asset uploaded with the server-computed sha256', done.status === 200 && done.body.asset?.status === 'uploaded' && done.body.asset?.sha256 === hash, `${done.status} ${done.body?.asset?.status} sha256=${done.body?.asset?.sha256?.slice(0, 12)}`);
  check('complete enqueues four chained jobs validate → proxy → thumbnails → segment (queued)', kinds.join(',') === 'validate,proxy,thumbnails,segment' && done.body.jobs.every((j) => j.status === 'queued' || j.status === 'running' || j.status === 'succeeded'), `${kinds.join(',')} ${done.body.jobs.map((j) => j.status).join(',')}`);
  check('each chain job carries its idempotencyKey and configVersion', done.body.jobs.every((j) => /^[0-9a-f]{64}$/.test(j.idempotencyKey) && j.configVersion), done.body.jobs[0]?.configVersion);
  const again = await c.req('POST', `/uploads/${upload.id}/complete`, { body: {} });
  check('completing again is idempotent (200, same four job ids)', again.status === 200 && again.body.jobs.map((j) => j.id).sort().join() === done.body.jobs.map((j) => j.id).sort().join(), `${again.status} jobs=${again.body?.jobs?.length}`);
  const partGone = DATA_DIR ? !fs.existsSync(path.join(DATA_DIR, 'uploads', `${upload.id}.part`)) : 'SKIP';
  check('partial file is moved out of uploads/ at completion', partGone, DATA_DIR ? path.join('uploads', `${upload.id}.part`) : 'FOS_DATA_DIR not set');
  const origOk = DATA_DIR ? fs.existsSync(path.join(assetDir(c.teamId, asset.id), 'original.mp4')) && (fs.statSync(path.join(assetDir(c.teamId, asset.id), 'original.mp4')).mode & 0o777) === 0o600 : 'SKIP';
  check('original stored at media/<teamId>/<assetId>/original.mp4 with mode 0600', origOk, DATA_DIR ? assetDir(c.teamId, asset.id) : 'FOS_DATA_DIR not set');

  // duplicates
  const dirsBefore = listAssetDirs(c.teamId).length;
  const dupEarly = await c.req('POST', `/games/${game.id}/uploads`, { body: { filename: 'copy-' + FILE, byteSize: buf.length, mimeType: 'video/mp4', sha256: hash, context: DEFAULT_CONTEXT } });
  check('duplicate create with the same sha256 → 409 conflict details.existingAssetId', dupEarly.status === 409 && code(dupEarly) === 'conflict' && details(dupEarly)?.existingAssetId === asset.id, `${dupEarly.status} existingAssetId=${details(dupEarly)?.existingAssetId}`);
  const dupLate = await uploadBytes(c, game.id, buf, { filename: 'copy2-' + FILE, chunkBytes: CHUNK });
  check('duplicate bytes uploaded without a client hash → complete answers 409 existingAssetId', dupLate.complete?.status === 409 && details(dupLate.complete)?.existingAssetId === asset.id, `${dupLate.complete?.status} ${code(dupLate.complete)} existingAssetId=${details(dupLate.complete)?.existingAssetId}`);
  const dupAsset = await c.req('GET', `/assets/${dupLate.asset.id}`);
  check('the duplicate placeholder asset is discarded (GET → 404) and its upload is gone', dupAsset.status === 404 && (await c.req('GET', `/uploads/${dupLate.upload.id}`)).status === 404, `${dupAsset.status}`);
  const dirsAfter = listAssetDirs(c.teamId).length;
  check('no second asset directory was created for the duplicate', DATA_DIR ? dirsAfter === dirsBefore : 'SKIP', `media/<team>/ dirs before=${dirsBefore} after=${dirsAfter}`);
  const partDupGone = DATA_DIR ? !fs.existsSync(path.join(DATA_DIR, 'uploads', `${dupLate.upload.id}.part`)) : 'SKIP';
  check('duplicate partial file deleted', partDupGone);
  const listed = await c.req('GET', `/games/${game.id}/assets`);
  check('GET /games/:gameId/assets lists exactly the real asset (no duplicate rows)', listed.body.items.filter((a) => a.sha256 === hash).length === 1, `${listed.body.items.length} assets, ${listed.body.items.map((a) => a.status).join(',')}`);

  // wait for the chain
  const r = await waitReady(c, asset.id, 'play-1');
  const { segs, labels } = await segmentsAndLabels(c, asset.id);
  check('segments proposed and every segment has 12 labels in accepted.status unknown', segs.length > 0 && labels.length === segs.length * 12 && labels.every((l) => l.accepted.status === 'unknown' && l.inferred === null), `segments=${segs.length} labels=${labels.length}`);
  check('asset probe facts filled (durationSec, width, height, fps) and quality present', r.asset.durationSec > 0 && r.asset.width > 0 && r.asset.height > 0 && r.asset.fps > 0 && r.asset.quality !== null, `${r.asset.durationSec}s ${r.asset.width}x${r.asset.height}@${r.asset.fps}`);
  state.assets = state.assets ?? {};
  state.assets[FILE] = asset.id;
  state.play1 = asset.id;
}

// 2 ------------------------------------------------------------------------------------------
async function resumeStart() {
  const c = await signIn('pc');
  const gameId = state.gameId ?? (await pickGame(c)).game.id;
  state.gameId = gameId;
  const file = arg('file', 'play-2.mp4');
  const buf = fixture(file);
  const r = await uploadBytes(c, gameId, buf, { filename: file, chunkBytes: CHUNK, stopAfterChunks: 2, complete: false });
  check('resume: created upload and sent exactly two chunks', r.create.status === 201 && r.chunks.sent === 2 && r.chunks.receivedBytes === 2 * CHUNK, `receivedBytes=${r.chunks.receivedBytes}`);
  state.resume = { uploadId: r.upload.id, assetId: r.asset.id, file, receivedBytes: r.chunks.receivedBytes, total: buf.length, sha256: sha256Hex(buf) };
  note(`stop the server now (SIGTERM or SIGKILL), restart it, then run resume-finish`);
}

async function resumeFinish() {
  const c = await signIn('pc');
  const s = state.resume;
  const buf = fixture(s.file);
  const g = await c.req('GET', `/uploads/${s.uploadId}`);
  check('after the restart GET /uploads/:id still knows the upload and its receivedBytes', g.status === 200 && g.body.upload.receivedBytes === s.receivedBytes && g.body.upload.completedAt === null, `${g.status} receivedBytes=${g.body.upload?.receivedBytes} expected=${s.receivedBytes}`);
  const partOk = DATA_DIR ? fs.existsSync(path.join(DATA_DIR, 'uploads', `${s.uploadId}.part`)) && fs.statSync(path.join(DATA_DIR, 'uploads', `${s.uploadId}.part`)).size >= s.receivedBytes : 'SKIP';
  check('partial file survived the restart with at least receivedBytes bytes', partOk);
  const stale = await c.req('PUT', `/uploads/${s.uploadId}`, { raw: true, body: buf.subarray(0, CHUNK), headers: { 'content-range': `bytes 0-${CHUNK - 1}/${buf.length}`, 'content-type': 'application/octet-stream' } });
  check('re-sending chunk 1 after the restart → 409 with the server\'s receivedBytes (client resumes from it)', stale.status === 409 && details(stale)?.receivedBytes === s.receivedBytes, `${stale.status} receivedBytes=${details(stale)?.receivedBytes}`);
  const rest = await putChunks(c, s.uploadId, buf, CHUNK, g.body.upload.receivedBytes);
  check('resumed from receivedBytes to the end', rest.last?.status === 200 && rest.receivedBytes === buf.length, `${rest.last?.status} ${rest.receivedBytes}`);
  const done = await c.req('POST', `/uploads/${s.uploadId}/complete`, { body: { sha256: s.sha256 } });
  check('complete after resume → 200, sha256 matches the client hash, four jobs', done.status === 200 && done.body.asset?.sha256 === s.sha256 && done.body.jobs?.length === 4, `${done.status} ${code(done) ?? ''} ${done.body?.asset?.status}`);
  await waitReady(c, s.assetId, 'play-2 (resumed)');
  state.assets = state.assets ?? {};
  state.assets[s.file] = s.assetId;
  state.play2 = s.assetId;
}

// 3 ------------------------------------------------------------------------------------------
async function restartStart() {
  const c = await signIn('pc');
  const gameId = state.gameId ?? (await pickGame(c)).game.id;
  state.gameId = gameId;
  const file = arg('file', 'play-3.mp4');
  const buf = fixture(file);
  const assetsBefore = (await c.req('GET', `/games/${gameId}/assets`)).body.items.length;
  const r = await uploadBytes(c, gameId, buf, { filename: file, chunkBytes: CHUNK });
  check('restart: upload completed and chain queued', r.complete?.status === 200 && r.complete.body.jobs.length === 4, `${r.complete?.status}`);
  const t0 = Date.now();
  let jobs = [];
  let caught = null;
  while (Date.now() - t0 < 300_000) {
    jobs = await listJobs(c, c.teamId, r.asset.id);
    const proxy = jobs.find((j) => j.kind === 'proxy');
    if (proxy?.status === 'running') { caught = proxy; break; }
    if (proxy && isTerminal(proxy)) break;
    await sleep(60);
  }
  check('caught the proxy job while running (lease held by the worker)', !!caught, caught ? `proxy attempt=${caught.attempt} lease=${caught.leaseExpiresAt} worker=${caught.workerId}` : summarizeJobs(jobs));
  state.restart = { assetId: r.asset.id, file, proxyJobId: jobs.find((j) => j.kind === 'proxy')?.id, caughtAt: new Date().toISOString(), leaseExpiresAt: caught?.leaseExpiresAt, workerId: caught?.workerId, assetsBefore, jobIds: jobs.map((j) => j.id) };
  note('SIGKILL the server now, wait for the lease to expire, restart, then run restart-verify');
}

async function restartVerify() {
  const c = await signIn('pc');
  const s = state.restart;
  const proxyBefore = (await c.req('GET', `/jobs/${s.proxyJobId}`)).body.job;
  note(`proxy job right after the restart: status=${proxyBefore.status} attempt=${proxyBefore.attempt} error=${JSON.stringify(proxyBefore.error)} worker=${proxyBefore.workerId}`);
  const recovered = proxyBefore.status !== 'running' || proxyBefore.workerId !== s.workerId;
  check('expired lease was recovered at worker start (job left the dead worker; re-queued or already re-run)', recovered, `status=${proxyBefore.status} attempt=${proxyBefore.attempt} error.code=${proxyBefore.error?.code}`);
  const r = await waitReady(c, s.assetId, 'play-3 (after SIGKILL + restart)');
  const proxy = r.chain.proxy;
  check('proxy job succeeded on a later attempt than the killed one (attempt >= 2) with the same job id', proxy.id === s.proxyJobId && proxy.attempt >= 2 && proxy.status === 'succeeded', `attempt=${proxy.attempt} workerId=${proxy.workerId}`);
  const all = await listJobs(c, c.teamId, s.assetId);
  check('no duplicate jobs for the asset after recovery (still exactly the four chain jobs)', all.length === 4 && all.map((j) => j.id).sort().join() === [...s.jobIds].sort().join(), summarizeJobs(all));
  const assets = (await c.req('GET', `/games/${state.gameId}/assets`)).body.items;
  check('no duplicate asset rows (count before + 1)', assets.length === s.assetsBefore + 1, `before=${s.assetsBefore} after=${assets.length}`);
  const { segs, labels } = await segmentsAndLabels(c, s.assetId);
  const uniqSeg = new Set(segs.map((x) => x.id)).size;
  const uniqLabel = new Set(labels.map((l) => `${l.segmentId}:${l.key}`)).size;
  check('segments unique and non-overlapping, labels exactly 12 per segment, no duplicates', segs.length > 0 && uniqSeg === segs.length && labels.length === segs.length * 12 && uniqLabel === labels.length && segs.every((x, i) => i === 0 || x.startSec >= segs[i - 1].endSec), `segments=${segs.length} labels=${labels.length}`);
  const dirs = DATA_DIR ? fs.readdirSync(assetDir(c.teamId, s.assetId)) : [];
  check('asset directory holds one original, one proxy, one thumbnail sheet', DATA_DIR ? dirs.filter((f) => f.startsWith('original.')).length === 1 && dirs.filter((f) => f === 'proxy.mp4').length === 1 && dirs.includes('thumbs.jpg') : 'SKIP', dirs.join(','));
  state.assets = state.assets ?? {};
  state.assets[s.file] = s.assetId;
  state.play3 = s.assetId;
}

// 3b: what happens when the server is restarted BEFORE the lease expires (no periodic recovery?)
async function restartProbe() {
  const role = arg('role', 'pc');
  const phase = arg('phase', 'start');
  const c = await signIn(role);
  if (phase === 'start') {
    const { game } = await pickGame(c);
    const file = arg('file', 'play-1.mp4');
    const buf = fixture(file);
    const r = await uploadBytes(c, game.id, buf, { filename: file, chunkBytes: CHUNK });
    check(`probe: upload of ${file} as ${role} completed and chain queued`, r.complete?.status === 200, `${r.complete?.status} ${code(r.complete) ?? ''}`);
    let caught = null;
    const t0 = Date.now();
    let jobs = [];
    while (Date.now() - t0 < 300_000) {
      jobs = await listJobs(c, c.teamId, r.asset.id);
      const proxy = jobs.find((j) => j.kind === 'proxy');
      if (proxy?.status === 'running') { caught = proxy; break; }
      if (proxy && isTerminal(proxy)) break;
      await sleep(60);
    }
    check('probe: caught proxy running', !!caught, caught ? `lease=${caught.leaseExpiresAt} worker=${caught.workerId}` : summarizeJobs(jobs));
    state.probe = { role, teamId: c.teamId, gameId: game.id, assetId: r.asset.id, proxyJobId: caught?.id ?? jobs.find((j) => j.kind === 'proxy')?.id, leaseExpiresAt: caught?.leaseExpiresAt, workerId: caught?.workerId };
    note('SIGKILL the server and restart it immediately (before the lease expires), then run restart-probe --phase poll --seconds <lease + 60>');
  } else if (phase === 'poll') {
    const s = state.probe;
    const seconds = Number(arg('seconds', '180'));
    const t0 = Date.now();
    let last = null;
    const seen = [];
    while (Date.now() - t0 < seconds * 1000) {
      const j = (await c.req('GET', `/jobs/${s.proxyJobId}`)).body.job;
      const sig = `${j.status}/${j.attempt}/${j.workerId}`;
      if (sig !== last) { seen.push(`${Math.round((Date.now() - t0) / 1000)}s ${sig}`); last = sig; }
      if (isTerminal(j) || (j.status === 'queued')) break;
      await sleep(2000);
    }
    const j = (await c.req('GET', `/jobs/${s.proxyJobId}`)).body.job;
    const leaseExpired = new Date(s.leaseExpiresAt) < new Date();
    check(`probe: within ${seconds}s after a restart that happened before the lease expired, the orphaned job is recovered without another restart`, leaseExpired && j.workerId !== s.workerId && j.status !== 'running', `transitions: ${seen.join(' → ')}; final status=${j.status} attempt=${j.attempt} worker=${j.workerId} lease=${j.leaseExpiresAt} (dead worker ${s.workerId}, lease expired=${leaseExpired})`);
    state.probe.pollResult = { final: j.status, worker: j.workerId, seen };
  } else {
    const s = state.probe;
    const r = await waitReady(c, s.assetId, `probe asset (${s.role})`);
    check('probe: proxy job finished by a worker other than the dead one, attempt >= 2', r.chain.proxy.workerId !== s.workerId && r.chain.proxy.attempt >= 2, `attempt=${r.chain.proxy.attempt} worker=${r.chain.proxy.workerId}`);
  }
}

// 4 ------------------------------------------------------------------------------------------
async function cancelRetry() {
  const c = await signIn('pc');
  const gameId = state.gameId ?? (await pickGame(c)).game.id;
  state.gameId = gameId;
  const file = arg('file', 'play-4.mp4');
  const buf = fixture(file);
  const r = await uploadBytes(c, gameId, buf, { filename: file, chunkBytes: CHUNK });
  check('cancel: upload completed and chain queued', r.complete?.status === 200, `${r.complete?.status}`);
  const assetId = r.asset.id;
  // a) cancel a queued dependent immediately: deterministic
  const segJob = r.complete.body.jobs.find((j) => j.kind === 'segment');
  const thumbsJob = r.complete.body.jobs.find((j) => j.kind === 'thumbnails');
  const cThumbs = await c.req('POST', `/jobs/${thumbsJob.id}/cancel`);
  check('cancel a queued job (thumbnails) → 200 job.status canceled, canceledAt set', cThumbs.status === 200 && cThumbs.body.job.status === 'canceled' && !!cThumbs.body.job.canceledAt, `${cThumbs.status} ${cThumbs.body.job?.status}`);
  const segAfter = (await c.req('GET', `/jobs/${segJob.id}`)).body.job;
  check('its dependent (segment) ends with error.code upstream_failed', segAfter.error?.code === 'upstream_failed' && isTerminal(segAfter), `status=${segAfter.status} error=${JSON.stringify(segAfter.error)}`);
  note(`dependent status after cancel is '${segAfter.status}' (14.9 says dependents of a canceled job become 'failed'; store cascades the parent's state)`);
  const again = await c.req('POST', `/jobs/${thumbsJob.id}/cancel`);
  check('cancel on an already canceled job → 409 conflict', again.status === 409 && code(again) === 'conflict', `${again.status}`);
  // b) cancel the proxy while it is running (best effort: catch it)
  let caught = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 300_000) {
    const jobs = await listJobs(c, c.teamId, assetId);
    const proxy = jobs.find((j) => j.kind === 'proxy');
    if (proxy?.status === 'running') { caught = proxy; break; }
    if (proxy && isTerminal(proxy)) break;
    await sleep(40);
  }
  if (caught) {
    const cr = await c.req('POST', `/jobs/${caught.id}/cancel`);
    check('cancel a RUNNING job (proxy) → 200 with cancelRequestedAt set', cr.status === 200 && (cr.body.job.cancelRequestedAt || cr.body.job.status === 'canceled'), `${cr.status} status=${cr.body.job?.status} cancelRequestedAt=${cr.body.job?.cancelRequestedAt}`);
    const jobs = await waitJobs(c, c.teamId, assetId, (js) => isTerminal(js.find((j) => j.kind === 'proxy')), { timeoutMs: 120_000, everyMs: 200 });
    const proxy = jobs.find((j) => j.kind === 'proxy');
    check('running job reaches canceled (handler observed signal.aborted, ffmpeg killed)', proxy.status === 'canceled', `status=${proxy.status} error=${JSON.stringify(proxy.error)} progress=${JSON.stringify(proxy.progress)}`);
    const proxyFile = DATA_DIR ? fs.existsSync(path.join(assetDir(c.teamId, assetId), 'proxy.mp4')) : null;
    note(`proxy.mp4 present after cancel: ${proxyFile} (partial outputs are the handler's concern)`);
  } else {
    check('cancel a RUNNING job (proxy)', 'SKIP', 'proxy finished before it could be caught running');
  }
  // retry: proxy (if canceled) else thumbnails
  const jobsNow = await listJobs(c, c.teamId, assetId);
  const toRetry = jobsNow.find((j) => j.kind === 'proxy' && j.status === 'canceled') ?? jobsNow.find((j) => j.kind === 'thumbnails');
  const badRetry = await c.req('POST', `/jobs/${jobsNow.find((j) => j.kind === 'validate').id}/retry`);
  check('retry on a succeeded job → 409 conflict', badRetry.status === 409, `${badRetry.status} ${code(badRetry)}`);
  const rt = await c.req('POST', `/jobs/${toRetry.id}/retry`);
  check(`retry ${toRetry.kind} → 200 queued with attempt reset to 0 and error cleared`, rt.status === 200 && rt.body.job.status === 'queued' && rt.body.job.attempt === 0 && rt.body.job.error === null, `${rt.status} ${rt.body.job?.status} attempt=${rt.body.job?.attempt}`);
  const after = await listJobs(c, c.teamId, assetId);
  // Only dependents that failed BECAUSE of the retried job (upstream_failed) are re-queued; the
  // explicitly canceled thumbnails job keeps its state and needs its own retry (README §Worker).
  const explicit = after.filter((j) => j.status === 'canceled' && j.error === null);
  check('explicitly canceled jobs are NOT re-queued by another job\'s retry (they keep status canceled, error null)', explicit.every((j) => j.kind === 'thumbnails') && explicit.length === (toRetry.kind === 'proxy' ? 1 : 0), summarizeJobs(after));
  for (const j of explicit) {
    const r2 = await c.req('POST', `/jobs/${j.id}/retry`);
    check(`retry the explicitly canceled ${j.kind} → 200 queued`, r2.status === 200 && r2.body.job.status === 'queued', `${r2.status}`);
  }
  const after2 = await listJobs(c, c.teamId, assetId);
  const requeued = after2.filter((j) => ['thumbnails', 'segment'].includes(j.kind)).every((j) => ['queued', 'running', 'succeeded'].includes(j.status));
  check('upstream_failed dependents (segment) are re-queued by the retry of the job they depend on', requeued, summarizeJobs(after2));
  const asViewer = await signIn('an');
  const rtViewer = await asViewer.req('POST', `/jobs/${toRetry.id}/retry`);
  note(`analyst retry → ${rtViewer.status} (analyst may manage jobs per §3 policy: ${rtViewer.status !== 403})`);
  await waitReady(c, assetId, `${file} (after cancel + retry)`);
  const finalJobs = await listJobs(c, c.teamId, assetId);
  check('after retry the same four job ids finished (no new job rows)', finalJobs.length === 4, summarizeJobs(finalJobs));
  const { segs, labels } = await segmentsAndLabels(c, assetId);
  check('segments and labels present once after retry', segs.length > 0 && labels.length === segs.length * 12, `segments=${segs.length} labels=${labels.length}`);
  state.assets = state.assets ?? {};
  state.assets[file] = assetId;
  state.play4 = assetId;
}

/** Retries every canceled/failed job of an asset (--asset <id> or state.play4) and waits for `ready`. */
async function finishChain() {
  const c = await signIn('pc');
  const assetId = arg('asset', state.play4);
  const jobs = await listJobs(c, c.teamId, assetId);
  for (const j of jobs.filter((x) => (x.status === 'canceled' || x.status === 'failed') && x.error === null)) {
    const r = await c.req('POST', `/jobs/${j.id}/retry`);
    check(`finish-chain: retry ${j.kind} → 200 queued`, r.status === 200 && r.body.job.status === 'queued', `${r.status}`);
  }
  await waitReady(c, assetId, 'finish-chain');
}

// 5 ------------------------------------------------------------------------------------------
async function inferAndWait(c, assetId, body = {}) {
  const r = await c.req('POST', `/assets/${assetId}/infer`, { body });
  if (r.status !== 202) return { r, job: null };
  const id = r.body.jobs[0].id;
  let job = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 120_000) {
    job = (await c.req('GET', `/jobs/${id}`)).body.job;
    if (isTerminal(job)) break;
    await sleep(300);
  }
  return { r, job };
}

async function providerNone() {
  const c = await signIn('pc');
  const assetId = state.play1 ?? Object.values(state.assets ?? {})[0];
  const { r, job } = await inferAndWait(c, assetId);
  check('POST /assets/:id/infer → 202 { jobs: [infer_labels] }', r.status === 202 && r.body.jobs?.[0]?.kind === 'infer_labels', `${r.status} ${r.body?.jobs?.length} job(s)`);
  check('with Ollama unreachable the job fails with provider_unavailable, retryable:false, "unreachable: Ollama is not reachable at …"', job?.status === 'failed' && job.error?.code === 'provider_unavailable' && job.error?.retryable === false && /unreachable: Ollama is not reachable at/.test(job.error?.message ?? ''), JSON.stringify(job?.error));
  check('failed inference job finished without attempts beyond the first', job?.attempt === 1, `attempt=${job?.attempt}`);
  const prov = await c.req('GET', `/assets/${assetId}/provenance`);
  check('no ModelProvenance row was written for the failed job', prov.status === 200 && prov.body.items.length === 0, `${prov.body.items?.length}`);
  const { segs, labels } = await segmentsAndLabels(c, assetId);
  check('labels untouched: all still unknown with inferred null', labels.every((l) => l.accepted.status === 'unknown' && l.inferred === null), `${labels.length}`);
  const seg = segs[0];
  const label = labels.find((l) => l.segmentId === seg.id && l.key === 'play_type');
  const p = await c.req('PATCH', `/labels/${label.id}`, { body: { accepted: { value: 'run', status: 'corrected' }, reason: 'manual (no provider)', expectedVersion: label.version } });
  check('manual PATCH /labels/:id still works → 200, accepted.status corrected, value run, version+1, byUserId set', p.status === 200 && p.body.label.accepted.status === 'corrected' && p.body.label.accepted.value === 'run' && p.body.label.version === label.version + 1 && p.body.label.accepted.byUserId === c.user.id, `${p.status} v=${p.body.label?.version}`);
  const rev = await c.req('GET', `/labels/${label.id}/revisions`);
  check('one LabelRevision unknown→corrected with the reason', rev.body.items.length === 1 && rev.body.items[0].previousStatus === 'unknown' && rev.body.items[0].newStatus === 'corrected' && rev.body.items[0].reason === 'manual (no provider)', JSON.stringify(rev.body.items[0]).slice(0, 200));
  const stale = await c.req('PATCH', `/labels/${label.id}`, { body: { accepted: { value: 'pass', status: 'corrected' }, expectedVersion: label.version } });
  check('stale expectedVersion → 409 with currentVersion', stale.status === 409 && details(stale)?.currentVersion === label.version + 1, `${stale.status}`);
  const bulk = await c.req('POST', `/assets/${assetId}/labels/bulk-accept`, { body: { segmentIds: [seg.id], keys: ['play_type', 'formation_family'] } });
  check('bulk-accept with no inferred labels → 200 { accepted: 0, skipped: n }', bulk.status === 200 && bulk.body.accepted === 0 && bulk.body.skipped >= 1, JSON.stringify(bulk.body));
  const again = await c.req('POST', `/assets/${assetId}/infer`, { body: {} });
  check('a second infer after the failed one starts a new generation (new job id, 202)', again.status === 202 && again.body.jobs[0].id !== job.id, `${again.status}`);
  const usage = await c.req('GET', `/teams/${c.teamId}/usage`);
  note(`GET /teams/:id/usage → ${usage.status} ${JSON.stringify(usage.body).slice(0, 200)}`);
  state.provider = { labelId: label.id, segmentId: seg.id, assetId };
}

async function providerNoKey() {
  const c = await signIn('pc');
  const assetId = state.play1 ?? Object.values(state.assets ?? {})[0];
  const { r, job } = await inferAndWait(c, assetId);
  check('Ollama running without the model pulled: infer → 202 then the job fails', r.status === 202 && job?.status === 'failed', `${r.status} ${job?.status}`);
  check('failure is non-retryable and is not a connection error (the server answered)', job?.error?.retryable === false && !/ECONNREFUSED|unreachable|fetch failed|timeout/i.test(job?.error?.message ?? ''), JSON.stringify(job?.error));
  check('error names the reason truthfully (model_missing and the `ollama pull` command)', /model_missing/.test(JSON.stringify(job?.error)) && /ollama pull/.test(JSON.stringify(job?.error)), JSON.stringify(job?.error));
  const prov = await c.req('GET', `/assets/${assetId}/provenance`);
  check('no provenance row, no cost recorded', prov.body?.items?.length === 0, `${prov.body?.items?.length}`);
  const usage = await c.req('GET', `/teams/${c.teamId}/usage`);
  note(`usage after the failed job: ${JSON.stringify(usage.body).slice(0, 200)}`);
  state.providerNoKey = { ...(state.providerNoKey ?? {}), [`cap${usage.body?.monthlyCostCapUsd}`]: { jobId: job?.id, error: job?.error } };
}

// 6 ------------------------------------------------------------------------------------------
async function corrections() {
  const c = await signIn('pc');
  const assetId = state.play1 ?? Object.values(state.assets ?? {})[0];
  const phase = arg('phase', 'before');
  if (phase === 'before') {
    const { segs, labels } = await segmentsAndLabels(c, assetId);
    const seg = segs[Math.min(1, segs.length - 1)];
    const other = segs.find((s) => s.id !== seg.id) ?? seg;
    const l = labels.find((x) => x.segmentId === seg.id && x.key === 'formation_family');
    const p1 = await c.req('PATCH', `/labels/${l.id}`, { body: { accepted: { value: 'trips', status: 'corrected' }, reason: 'QA correction', expectedVersion: l.version } });
    check('correct formation_family → corrected "trips"', p1.status === 200 && p1.body.label.accepted.value === 'trips', `${p1.status} v=${p1.body.label?.version}`);
    const p2 = await c.req('PATCH', `/labels/${l.id}`, { body: { accepted: { value: 'trips', status: 'corrected' }, reason: 'same value again', expectedVersion: p1.body.label.version } });
    check('PATCH with an identical accepted block: observe whether version increments (brief expects increments only on real changes)', p2.status === 200 && p2.body.label.version === p1.body.label.version, `${p2.status} version before=${p1.body.label.version} after=${p2.body.label?.version} (FAIL = version bumped and a revision written without a change)`);
    const revs = await c.req('GET', `/labels/${l.id}/revisions`);
    state.corr = { assetId, segmentId: seg.id, otherSegmentId: other.id, labelId: l.id, version: p2.body.label.version, accepted: p2.body.label.accepted, revisions: revs.body.items.length, liveSegments: segs.map((s) => s.id), labelCount: labels.length };
    note(`now re-run the segment job (tests/e2e/b6-rerun-job.mjs) and inference, then run corrections --phase after`);
  } else {
    const s = state.corr;
    const jobs = await waitJobs(c, c.teamId, s.assetId, (js) => js.every(isTerminal), { timeoutMs: 600_000 });
    const rerun = jobs.filter((j) => j.kind === 'segment');
    check('a second segment job ran for the asset and succeeded (forced through the job store, see b6-rerun-job.mjs)', rerun.length >= 2 && rerun.every((j) => j.status === 'succeeded'), summarizeJobs(rerun));
    const l = (await c.req('GET', `/segments/${s.segmentId}/labels`)).body.items?.find((x) => x.id === s.labelId);
    check('after the segment re-run the corrected label row still exists on the same segment', !!l, l ? `v=${l.version}` : 'label gone');
    check('accepted block intact (value, status, byUserId, at) and version unchanged', !!l && JSON.stringify(l.accepted) === JSON.stringify(s.accepted) && l.version === s.version, l ? JSON.stringify(l.accepted) : '');
    const revs = await c.req('GET', `/labels/${s.labelId}/revisions`);
    check('revision history intact (same count as before the re-runs)', revs.status === 200 && revs.body.items.length === s.revisions, `${revs.body?.items?.length} vs ${s.revisions}`);
    const seg = await c.req('GET', `/assets/${s.assetId}/segments`);
    const live = seg.body.items.map((x) => x.id);
    check('the coach-touched segment was kept by the re-run; untouched proposals were replaced', live.includes(s.segmentId) && (!live.includes(s.otherSegmentId) || s.otherSegmentId === s.segmentId), `kept=${live.includes(s.segmentId)} otherReplaced=${!live.includes(s.otherSegmentId)} live=${live.length} (before ${s.liveSegments.length})`);
    const { labels } = await segmentsAndLabels(c, s.assetId);
    const uniq = new Set(labels.map((x) => `${x.segmentId}:${x.key}`)).size;
    check('labels are exactly 12 per live segment after the re-run (no duplicates, no orphans in the listing)', labels.length === live.length * 12 && uniq === labels.length, `labels=${labels.length} live=${live.length}`);
    const inf = await inferAndWait(c, s.assetId);
    const l2 = (await c.req('GET', `/segments/${s.segmentId}/labels`)).body.items?.find((x) => x.id === s.labelId);
    check(`inference re-run (${inf.job?.status}/${inf.job?.error?.code ?? 'ok'}) left the corrected label untouched`, !!l2 && JSON.stringify(l2.accepted) === JSON.stringify(s.accepted) && l2.version === s.version, l2 ? `v=${l2.version}` : '');
  }
}

// 7 ------------------------------------------------------------------------------------------
async function scouting() {
  const c = await signIn('pc');
  const assetId = state.play1 ?? Object.values(state.assets ?? {})[0];
  const teamId = c.teamId;
  const opponentId = state.opponentId;
  const { segs, labels } = await segmentsAndLabels(c, assetId);
  if (segs.length < 3) {
    // make sure there are at least five live segments by adding coach segments at the end of the film
    const asset = (await c.req('GET', `/assets/${assetId}`)).body.asset;
    note(`only ${segs.length} proposed segments; coach-created segments are added (asset ${asset.durationSec}s)`);
  }
  const byKey = (segId, key) => labels.find((l) => l.segmentId === segId && l.key === key);
  const setLabel = async (segId, key, value, status) => {
    const l = (await c.req('GET', `/segments/${segId}/labels`)).body.items.find((x) => x.key === key);
    const r = await c.req('PATCH', `/labels/${l.id}`, { body: { accepted: { value, status }, expectedVersion: l.version } });
    if (r.status !== 200) throw new Error(`PATCH label ${key} on ${segId}: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body.label;
  };
  // Five live segments from the opponent/offense assets of this game (every fixture clip proposes
  // one or two); s4 must still be `proposed` so the review bases differ. Untouched (all-unknown)
  // segments are preferred so earlier scenarios' labels do not leak into the counts.
  const gameAssets = (await c.req('GET', `/games/${state.gameId}/assets`)).body.items.filter((a) => a.status === 'ready' && a.context.analyzedTeam === 'opponent' && a.context.analyzedUnit === 'offense');
  let pool = [];
  for (const a of gameAssets) {
    const { segs: ss, labels: ls } = await segmentsAndLabels(c, a.id);
    for (const s of ss) pool.push({ ...s, untouched: ls.filter((l) => l.segmentId === s.id).every((l) => l.accepted.status === 'unknown') });
  }
  pool.sort((a, b) => Number(b.untouched) - Number(a.untouched));
  const asset = (await c.req('GET', `/assets/${assetId}`)).body.asset;
  while (pool.length < 5) {
    const own = pool.filter((s) => s.assetId === assetId);
    const last = own[own.length - 1];
    const startSec = last ? last.endSec + 0.1 : 0;
    const endSec = startSec + 0.5;
    const cr = await c.req('POST', `/assets/${assetId}/segments`, { body: { startSec, endSec } });
    if (cr.status === 201) { pool.push({ ...cr.body.segment, untouched: true }); continue; }
    note(`could not append a coach segment (${cr.status} ${code(cr)}: clip fully covered); splitting an untouched proposal instead`);
    const victim = pool.filter((s) => s.untouched && s.reviewStatus === 'proposed').sort((a, b) => (b.endSec - b.startSec) - (a.endSec - a.startSec))[0];
    if (!victim || pool.filter((s) => s.reviewStatus === 'proposed').length < 2) { note('no splittable proposal left'); break; }
    const sp = await c.req('POST', `/segments/${victim.id}/split`, { body: { atSec: (victim.startSec + victim.endSec) / 2, expectedVersion: victim.version } });
    if (sp.status !== 200) { note(`split failed: ${sp.status} ${JSON.stringify(sp.body).slice(0, 120)}`); break; }
    check('split of a proposed segment → 200 two parts (coach-made, accepted) + superseded original', sp.body.segments?.length === 2 && sp.body.superseded?.supersededBy?.length === 2 && sp.body.segments.every((p) => p.reviewStatus === 'accepted'), `${sp.status} parts=${sp.body.segments?.map((p) => `${p.startSec}-${p.endSec}`).join(',')}`);
    pool = pool.filter((s) => s.id !== victim.id).concat(sp.body.segments.map((p) => ({ ...p, untouched: true })));
  }
  const proposedIdx = pool.map((s, i) => (s.reviewStatus === 'proposed' ? i : -1)).filter((i) => i >= 0);
  const s4 = pool[proposedIdx[proposedIdx.length - 1]] ?? pool[3];
  const others = pool.filter((s) => s.id !== s4.id);
  const [s1, s2, s3, s5] = others;
  const live = [s1, s2, s3, s4, s5];
  check('at least five live segments to label (across the game\'s opponent/offense assets)', live.every(Boolean) && new Set(live.map((s) => s.id)).size === 5, `${pool.length} in pool from ${gameAssets.length} assets; s4 proposed=${s4?.reviewStatus === 'proposed'}; untouched=${live.filter((s) => s?.untouched).length}/5 (asset ${asset.durationSec}s)`);
  note(`segments: s1=${s1.id.slice(0, 8)} s2=${s2.id.slice(0, 8)} s3=${s3.id.slice(0, 8)} s4=${s4.id.slice(0, 8)}(${s4.reviewStatus}) s5=${s5.id.slice(0, 8)}`);
  const assetIdOf = Object.fromEntries(live.map((s) => [s.id, s.assetId]));
  const setReview = async (segId, reviewStatus) => {
    const s = (await c.req('GET', `/assets/${assetIdOf[segId]}/segments`)).body.items.find((x) => x.id === segId);
    const r = await c.req('PATCH', `/segments/${segId}`, { body: { reviewStatus, expectedVersion: s.version } });
    if (r.status !== 200) throw new Error(`PATCH segment ${segId}: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body.segment;
  };
  // other segments of the same assets that earlier scenarios already labeled would distort the
  // denominators: every pool segment outside s1..s5 is marked rejected so it is excluded (and listed).
  const outside = pool.filter((s) => !live.some((l) => l.id === s.id));
  for (const s of outside) await setReview(s.id, 'rejected');
  if (outside.length) note(`${outside.length} other live segment(s) marked rejected to keep the denominators exact`);
  // Known mix (hand computation in QA_REPORT_B6.md §7):
  //   s1 accepted segment: formation trips (accepted), play_type pass (corrected)
  //   s2 accepted segment: formation trips (accepted), play_type run (accepted)
  //   s3 accepted segment: formation i_form (accepted), play_type unknown
  //   s4 proposed segment: formation trips (accepted), play_type pass (accepted)   → counts only under includes_inferred
  //   s5 rejected segment: formation trips (accepted)                               → never counts
  await setReview(s1.id, 'accepted');
  await setReview(s2.id, 'accepted');
  await setReview(s3.id, 'accepted');
  if (s4.reviewStatus !== 'proposed') { note(`s4 is ${s4.reviewStatus} (coach-created segments are accepted); a proposed one is needed for the basis split`); }
  await setReview(s5.id, 'rejected');
  await setLabel(s1.id, 'formation_family', 'trips', 'accepted');
  await setLabel(s1.id, 'play_type', 'pass', 'corrected');
  await setLabel(s2.id, 'formation_family', 'trips', 'accepted');
  await setLabel(s2.id, 'play_type', 'run', 'accepted');
  await setLabel(s3.id, 'formation_family', 'i_form', 'accepted');
  await setLabel(s4.id, 'formation_family', 'trips', 'accepted');
  await setLabel(s4.id, 'play_type', 'pass', 'accepted');
  await setLabel(s5.id, 'formation_family', 'trips', 'accepted');
  const s4Proposed = s4.reviewStatus === 'proposed';
  const q = async (basis) => c.req('GET', `/teams/${teamId}/opponents/${opponentId}/scouting?unit=offense&reviewBasis=${basis}`);
  const ro = await q('reviewed_only');
  check('GET …/scouting reviewed_only → 200 with findings, games, sampleSize, computeVersion, inputsHash', ro.status === 200 && Array.isArray(ro.body.findings) && Array.isArray(ro.body.games) && typeof ro.body.inputsHash === 'string', `${ro.status} findings=${ro.body.findings?.length} sampleSize=${ro.body.sampleSize}`);
  const liveNonRejected = live.length - 1;
  const expectedRO = { sampleSize: 3, formation: { trips: [2, 3], i_form: [1, 3] }, ptByFormation: { 'trips/pass': [1, 2], 'trips/run': [1, 2] } };
  const expectedII = { sampleSize: liveNonRejected, formation: { trips: [s4Proposed ? 3 : 3, s4Proposed ? 4 : 4], i_form: [1, 4] }, ptByFormation: { 'trips/pass': [2, 3], 'trips/run': [1, 3] } };
  const find = (body, kind, pred) => body.findings.filter((f) => f.kind === kind).find(pred);
  const num = (f) => (f ? `${f.numerator}/${f.denominator}=${f.percent}%` : 'missing');
  const checkBasis = (label, body, exp) => {
    check(`${label}: sampleSize = ${exp.sampleSize}`, body.sampleSize === exp.sampleSize, `${body.sampleSize}`);
    for (const [form, [n, d]] of Object.entries(exp.formation)) {
      const f = find(body, 'formation_frequency', (x) => x.statement.includes(`"${form}"`));
      check(`${label}: formation_frequency ${form} = ${n}/${d}`, f?.numerator === n && f?.denominator === d && f.percent === Math.round((n / d) * 1000) / 10 && f.sampleSize === d && f.includedSegmentIds.length === d, num(f));
    }
    for (const [k, [n, d]] of Object.entries(exp.ptByFormation)) {
      const [form, pt] = k.split('/');
      const f = find(body, 'play_type_by_formation', (x) => x.statement.includes(`"${form}"`) && x.statement.includes(`"${pt}"`));
      check(`${label}: play_type_by_formation ${form}→${pt} = ${n}/${d}`, f?.numerator === n && f?.denominator === d, num(f));
    }
    const s3f = find(body, 'play_type_by_formation', (x) => x.statement.includes('"i_form"'));
    check(`${label}: i_form has no play_type finding (play type unknown on s3 → excluded, never fabricated)`, !s3f, s3f ? num(s3f) : 'none');
    const anyIncludesRejected = body.findings.some((f) => f.includedSegmentIds.includes(s5.id));
    check(`${label}: rejected segment s5 never counted; listed as excluded`, !anyIncludesRejected && body.findings.every((f) => f.excludedReason[s5.id] === 'rejected'), `${body.findings[0]?.excludedReason?.[s5.id]}`);
    check(`${label}: every finding carries reviewBasis, gameIds, includedSegmentIds and percent = round(n/d)`, body.findings.every((f) => f.reviewBasis === body.reviewBasis && f.gameIds.includes(state.gameId) && f.percent === Math.round((f.numerator / f.denominator) * 1000) / 10), `${body.findings.length} findings`);
  };
  checkBasis('reviewed_only', ro.body, expectedRO);
  const ii = await q('includes_inferred');
  if (s4Proposed) checkBasis('includes_inferred', ii.body, expectedII);
  else check('includes_inferred basis split', 'SKIP', 's4 was not a proposed segment');
  check('reviewed_only excludes the proposed segment s4 as "unreviewed"', ro.body.findings.every((f) => f.excludedReason[s4.id] === 'unreviewed' && !f.includedSegmentIds.includes(s4.id)), `${ro.body.findings[0]?.excludedReason?.[s4.id]}`);
  check('games[] lists the game with this asset among its opponent film', ro.body.games.some((g) => g.gameId === state.gameId && g.assetIds.includes(assetId)), JSON.stringify(ro.body.games).slice(0, 200));
  const ro2 = await q('reviewed_only');
  check('inputsHash is stable across two identical computations (computedAt differs)', ro2.body.inputsHash === ro.body.inputsHash && ro2.body.computedAt >= ro.body.computedAt, `${ro.body.inputsHash.slice(0, 16)}…`);
  check('inputsHash differs between review bases', ii.body.inputsHash !== ro.body.inputsHash);
  const snap = await c.req('POST', `/teams/${teamId}/opponents/${opponentId}/scouting/snapshots`, { body: { title: 'QA snapshot offense', unit: 'offense', reviewBasis: 'reviewed_only' } });
  check('POST …/scouting/snapshots → 201 with the same findings and inputsHash as the live report', snap.status === 201 && snap.body.snapshot.inputsHash === ro.body.inputsHash && snap.body.snapshot.findings.length === ro.body.findings.length && snap.body.snapshot.generatedBy === c.user.id, `${snap.status} ${snap.body.snapshot?.inputsHash?.slice(0, 16)}…`);
  const snapList = await c.req('GET', `/teams/${teamId}/opponents/${opponentId}/scouting/snapshots`);
  check('GET …/scouting/snapshots lists it', snapList.body.items.some((s) => s.id === snap.body.snapshot.id), `${snapList.body.items.length}`);
  // change one label → hash changes
  const changed = await setLabel(s3.id, 'play_type', 'run', 'accepted');
  const ro3 = await q('reviewed_only');
  check('after one more accepted label the inputsHash changes and i_form→run becomes 1/1', ro3.body.inputsHash !== ro.body.inputsHash && find(ro3.body, 'play_type_by_formation', (x) => x.statement.includes('"i_form"') && x.statement.includes('"run"'))?.numerator === 1, `v=${changed.version} ${num(find(ro3.body, 'play_type_by_formation', (x) => x.statement.includes('"i_form"')))}`);
  const snapAfter = await c.req('GET', `/teams/${teamId}/opponents/${opponentId}/scouting/snapshots`);
  check('the stored snapshot keeps its original inputsHash (snapshots are frozen)', snapAfter.body.items.find((s) => s.id === snap.body.snapshot.id)?.inputsHash === ro.body.inputsHash);
  const badUnit = await c.req('GET', `/teams/${teamId}/opponents/${opponentId}/scouting?unit=kicking`);
  check('unit outside the enum → 400 validation_error', badUnit.status === 400 && code(badUnit) === 'validation_error', `${badUnit.status}`);
  const def = await c.req('GET', `/teams/${teamId}/opponents/${opponentId}/scouting?unit=defense&reviewBasis=includes_inferred`);
  check('unit=defense over offense-only film → sampleSize 0 and no findings (other_unit exclusion, nothing fabricated)', def.body.sampleSize === 0 && def.body.findings.length === 0, `sampleSize=${def.body.sampleSize} findings=${def.body.findings.length}`);
  state.scouting = { s1: s1.id, s2: s2.id, s3: s3.id, s4: s4.id, s5: s5.id, s4Proposed, inputsHash: ro.body.inputsHash, snapshotId: snap.body.snapshot?.id };
}

// 8 ------------------------------------------------------------------------------------------
async function delivery() {
  const c = await signIn('pc');
  const assetId = state.play1 ?? Object.values(state.assets ?? {})[0];
  const g = await c.req('GET', `/assets/${assetId}/grant`);
  check('GET /assets/:id/grant → 200 { streamUrl, thumbUrlTemplate, expiresAt (<= 15 min) }', g.status === 200 && g.body.streamUrl && g.body.thumbUrlTemplate?.includes('{n}') && new Date(g.body.expiresAt) - Date.now() <= 15 * 60_000 + 5000, `${g.status} expiresAt=${g.body.expiresAt}`);
  const token = new URL(g.body.streamUrl, URL_).searchParams.get('token');
  const streamUrl = URL_ + g.body.streamUrl;
  const anon = client();
  const full = await anon.req('GET', streamUrl, { absolute: true, binary: true });
  check('stream without Range → 200 video/mp4 full proxy, Accept-Ranges bytes, Cache-Control private no-store', full.status === 200 && full.headers.get('content-type') === 'video/mp4' && full.headers.get('accept-ranges') === 'bytes' && /no-store/.test(full.headers.get('cache-control') ?? '') && full.body.length === Number(full.headers.get('content-length')), `${full.status} ${full.body.length} bytes`);
  const size = full.body.length;
  const part = await anon.req('GET', streamUrl, { absolute: true, binary: true, headers: { range: 'bytes=100-199' } });
  check('Range bytes=100-199 → 206, Content-Range bytes 100-199/size, 100 bytes equal to the same slice of the full body', part.status === 206 && part.headers.get('content-range') === `bytes 100-199/${size}` && part.body.length === 100 && part.body.equals(full.body.subarray(100, 200)), `${part.status} ${part.headers.get('content-range')}`);
  const open = await anon.req('GET', streamUrl, { absolute: true, binary: true, headers: { range: `bytes=${size - 50}-` } });
  check('open-ended Range → 206 last 50 bytes', open.status === 206 && open.body.length === 50 && open.headers.get('content-range') === `bytes ${size - 50}-${size - 1}/${size}`, `${open.status}`);
  const suffix = await anon.req('GET', streamUrl, { absolute: true, binary: true, headers: { range: 'bytes=-10' } });
  check('suffix Range bytes=-10 → 206 last 10 bytes', suffix.status === 206 && suffix.body.length === 10, `${suffix.status}`);
  const bad = await anon.req('GET', streamUrl, { absolute: true, binary: true, headers: { range: `bytes=${size + 10}-` } });
  check('Range past the end → 416 with Content-Range bytes */size', bad.status === 416 && bad.headers.get('content-range') === `bytes */${size}`, `${bad.status} ${bad.headers.get('content-range')}`);
  const tampered = token.slice(0, -4) + (token.endsWith('0000') ? '1111' : '0000');
  const t1 = await anon.req('GET', `${API}/media/${assetId}/stream?token=${encodeURIComponent(tampered)}`, { absolute: true });
  check('tampered signature → 401 unauthorized', t1.status === 401 && code(t1) === 'unauthorized', `${t1.status}`);
  const noTok = await anon.req('GET', `${API}/media/${assetId}/stream`, { absolute: true });
  check('missing token → 401 (session cookie is not enough: the route is token-only)', noTok.status === 401, `${noTok.status}`);
  const withSession = await c.req('GET', `/media/${assetId}/stream`);
  check('signed-in session without a token → 401 too', withSession.status === 401, `${withSession.status}`);
  const otherAsset = Object.values(state.assets ?? {}).find((id) => id !== assetId);
  if (otherAsset) {
    const cross = await anon.req('GET', `${API}/media/${otherAsset}/stream?token=${encodeURIComponent(token)}`, { absolute: true });
    check('token bound to asset A used on asset B → 401', cross.status === 401, `${cross.status}`);
  }
  // expired token: sign one with the development fallback secret (the server runs without SESSION_SECRET)
  const { createHmac } = await import('node:crypto');
  const devSecret = 'footballos-development-only-session-secret-not-for-production';
  const mk = (expMs) => { const payload = `${c.teamId}.${assetId}.${expMs}`; return `${Buffer.from(payload).toString('base64url')}.${createHmac('sha256', devSecret).update(`media-grant:${payload}`).digest('hex')}`; };
  const expired = await anon.req('GET', `${API}/media/${assetId}/stream?token=${encodeURIComponent(mk(Date.now() - 60_000))}`, { absolute: true });
  check('expired token (exp in the past, valid signature under the dev secret) → 401', expired.status === 401, `${expired.status} ${code(expired)}`);
  const forged = await anon.req('GET', `${API}/media/${assetId}/stream?token=${encodeURIComponent(mk(Date.now() + 60_000))}`, { absolute: true, binary: true });
  note(`a grant forged with the published development secret is ${forged.status === 200 ? 'ACCEPTED (SESSION_SECRET unset → known secret; fine for demo, fatal in production by config)' : `rejected (${forged.status})`}`);
  const thumb0 = await anon.req('GET', URL_ + g.body.thumbUrlTemplate.replace('{n}', '0'), { absolute: true, binary: true });
  check('thumb tile 0 → 200 image/jpeg (JPEG magic bytes)', thumb0.status === 200 && thumb0.headers.get('content-type') === 'image/jpeg' && thumb0.body[0] === 0xff && thumb0.body[1] === 0xd8, `${thumb0.status} ${thumb0.body.length} bytes`);
  const thumbFar = await anon.req('GET', URL_ + g.body.thumbUrlTemplate.replace('{n}', '9999'), { absolute: true });
  check('thumb tile beyond the sheet → 404', thumbFar.status === 404, `${thumbFar.status}`);
  const thumbNeg = await anon.req('GET', URL_ + g.body.thumbUrlTemplate.replace('{n}', '-1'), { absolute: true });
  check('negative tile index → 400/404 (never 500)', thumbNeg.status === 400 || thumbNeg.status === 404, `${thumbNeg.status}`);
  const thumbBad = await anon.req('GET', URL_ + g.body.thumbUrlTemplate.replace('{n}', '0').replace(/token=[^&]+/, `token=${encodeURIComponent(tampered)}`), { absolute: true });
  check('thumb with a tampered token → 401', thumbBad.status === 401, `${thumbBad.status}`);
  const leak = logContains(token);
  check('the grant token does not appear in the server log', leak === null ? 'SKIP' : !leak, leak === null ? 'FOS_LOG not set' : `searched ${process.env.FOS_LOG}`);
  state.delivery = { tokenTail: token.slice(-8) };

  // cross-team sweep from a user of the second team
  if (!process.env.FOS_T2_EMAIL) { check('cross-team sweep', 'SKIP', 'FOS_T2_EMAIL not set'); return; }
  const t2 = await signIn('t2');
  const teamId = c.teamId;
  const { segs, labels } = await segmentsAndLabels(c, assetId);
  const seg = segs[0];
  const label = labels[0];
  const jobs = await listJobs(c, teamId, assetId);
  const job = jobs[0];
  const up = await c.req('POST', `/games/${state.gameId}/uploads`, { body: { filename: 'x.mp4', byteSize: 10, mimeType: 'video/mp4', context: DEFAULT_CONTEXT } });
  const uploadId = up.body.upload.id;
  const routes = [
    ['GET', `/games/${state.gameId}/assets`], ['POST', `/games/${state.gameId}/uploads`, { filename: 'x.mp4', byteSize: 10, mimeType: 'video/mp4', context: DEFAULT_CONTEXT }],
    ['GET', `/uploads/${uploadId}`], ['PUT', `/uploads/${uploadId}`, null, { raw: Buffer.alloc(10), range: 'bytes 0-9/10' }], ['POST', `/uploads/${uploadId}/complete`, {}],
    ['GET', `/assets/${assetId}`], ['DELETE', `/assets/${assetId}`], ['GET', `/assets/${assetId}/grant`],
    ['GET', `/teams/${teamId}/jobs`], ['GET', `/jobs/${job.id}`], ['POST', `/jobs/${job.id}/cancel`], ['POST', `/jobs/${job.id}/retry`],
    ['GET', `/assets/${assetId}/segments`], ['POST', `/assets/${assetId}/segments`, { startSec: 0, endSec: 1 }], ['POST', `/segments/${seg.id}/split`, { atSec: (seg.startSec + seg.endSec) / 2, expectedVersion: seg.version }],
    ['POST', `/segments/merge`, { segmentIds: [seg.id, segs[1]?.id ?? seg.id], expectedVersion: { [seg.id]: seg.version, [segs[1]?.id ?? seg.id]: segs[1]?.version ?? seg.version } }], ['PATCH', `/segments/${seg.id}`, { reviewStatus: 'accepted', expectedVersion: seg.version }],
    ['POST', `/assets/${assetId}/infer`, {}], ['GET', `/segments/${seg.id}/labels`], ['GET', `/assets/${assetId}/labels`], ['PATCH', `/labels/${label.id}`, { accepted: { value: 'x', status: 'corrected' }, expectedVersion: label.version }],
    ['GET', `/labels/${label.id}/revisions`], ['POST', `/assets/${assetId}/labels/bulk-accept`, { segmentIds: [seg.id], keys: ['play_type'] }], ['GET', `/assets/${assetId}/provenance`],
    ['GET', `/teams/${teamId}/opponents/${state.opponentId}/scouting?unit=offense`], ['GET', `/teams/${teamId}/opponents/${state.opponentId}/scouting/snapshots`], ['POST', `/teams/${teamId}/opponents/${state.opponentId}/scouting/snapshots`, { title: 'x' }],
    ['GET', `/teams/${teamId}/settings`], ['PATCH', `/teams/${teamId}/settings`, { expectedVersion: 1, retentionDays: 1 }], ['GET', `/teams/${teamId}/usage`],
  ];
  const bad404 = [];
  for (const [method, p, body, extra] of routes) {
    const r = extra?.raw ? await t2.req(method, p, { raw: true, body: extra.raw, headers: { 'content-range': extra.range, 'content-type': 'application/octet-stream' } }) : await t2.req(method, p, body !== undefined && body !== null ? { body } : {});
    if (r.status !== 404) bad404.push(`${method} ${p.split('?')[0]} → ${r.status} ${code(r) ?? ''}`);
  }
  check(`second team's user gets 404 on every new route with first-team ids (${routes.length} routes)`, bad404.length === 0, bad404.join('; ') || 'all 404');
  const own = await t2.req('GET', `/teams/${t2.teamId}/settings`);
  check("second team's user reads its own team settings → 200", own.status === 200, `${own.status}`);
  const t2Scout = await t2.req('GET', `/teams/${t2.teamId}/opponents/${state.opponentId}/scouting?unit=offense`);
  check("first team's opponent id under the second team → 404", t2Scout.status === 404, `${t2Scout.status}`);
}

// 9 ------------------------------------------------------------------------------------------
async function retentionSet() {
  const hc = await signIn('hc');
  const pc = await signIn('pc');
  const teamId = hc.teamId;
  const g = await hc.req('GET', `/teams/${teamId}/settings`);
  check('GET /teams/:id/settings → retentionDays null by default (keep until deleted), uploadLimits, version', g.status === 200 && g.body.settings.retentionDays === null && g.body.settings.uploadLimits?.maxUploadBytes > 0 && g.body.settings.version >= 1, JSON.stringify(g.body.settings).slice(0, 200));
  const v = g.body.settings.version;
  const zero = await hc.req('PATCH', `/teams/${teamId}/settings`, { body: { expectedVersion: v, retentionDays: 0 } });
  check('retentionDays 0 is rejected by the contract (400 validation_error; schema min 1)', zero.status === 400 && code(zero) === 'validation_error', `${zero.status} ${code(zero)}`);
  const asPc = await pc.req('PATCH', `/teams/${teamId}/settings`, { body: { expectedVersion: v, retentionDays: 1 } });
  check('position coach PATCH settings → 403 forbidden', asPc.status === 403 && code(asPc) === 'forbidden', `${asPc.status} ${code(asPc)}`);
  const oc = await signIn('oc');
  const asOc = await oc.req('PATCH', `/teams/${teamId}/settings`, { body: { expectedVersion: v, retentionDays: 1 } });
  check('coordinator PATCH settings → 403 forbidden', asOc.status === 403, `${asOc.status}`);
  const an = await signIn('an');
  const asAn = await an.req('PATCH', `/teams/${teamId}/settings`, { body: { expectedVersion: v, retentionDays: 1 } });
  check('analyst PATCH settings → 403 forbidden', asAn.status === 403, `${asAn.status}`);
  const stale = await hc.req('PATCH', `/teams/${teamId}/settings`, { body: { expectedVersion: v + 5, retentionDays: 1 } });
  check('wrong expectedVersion → 409 currentVersion', stale.status === 409 && details(stale)?.currentVersion === v, `${stale.status}`);
  const one = await hc.req('PATCH', `/teams/${teamId}/settings`, { body: { expectedVersion: v, retentionDays: 1 } });
  check('head coach PATCH retentionDays 1 → 200 version+1', one.status === 200 && one.body.settings.retentionDays === 1 && one.body.settings.version === v + 1, `${one.status} ${JSON.stringify(one.body.settings).slice(0, 120)}`);
  const assets = (await hc.req('GET', `/games/${state.gameId}/assets`)).body.items.filter((a) => a.status !== 'deleted');
  const okUntil = assets.every((a) => a.retentionUntil && Math.abs(new Date(a.retentionUntil) - new Date(a.createdAt) - 86_400_000) < 2000);
  check('every live asset now carries retentionUntil = createdAt + 1 day', okUntil, assets.map((a) => `${a.id.slice(0, 8)}:${a.retentionUntil}`).join(' '));
  const audit = await hc.req('GET', `/teams/${teamId}/audit?limit=50`);
  check('audit row settings.changed written', audit.body.items.some((e) => e.action === 'settings.changed'), `${audit.body.items?.length} rows`);
  const victim = state.play2 ?? assets[assets.length - 1].id;
  state.retention = { victim, version: one.body.settings.version, before: assets.map((a) => a.id) };
  note(`victim asset for the retention run: ${victim}. Age it (b6-age-asset.mjs), re-PATCH settings 2 → 1 to recompute retentionUntil, restart the server, then run retention-verify`);
}

/** After b6-age-asset.mjs: PATCH retentionDays 2 then back to 1 so the server recomputes retentionUntil from the aged createdAt. */
async function retentionRecompute() {
  const hc = await signIn('hc');
  const teamId = hc.teamId;
  let v = (await hc.req('GET', `/teams/${teamId}/settings`)).body.settings.version;
  const a = await hc.req('PATCH', `/teams/${teamId}/settings`, { body: { expectedVersion: v, retentionDays: 2 } });
  v = a.body.settings?.version ?? v;
  const b = await hc.req('PATCH', `/teams/${teamId}/settings`, { body: { expectedVersion: v, retentionDays: 1 } });
  check('retentionDays 2 → 1 re-PATCH as head coach → 200/200', a.status === 200 && b.status === 200, `${a.status}/${b.status} version=${b.body.settings?.version}`);
  const victim = (await hc.req('GET', `/assets/${state.retention.victim}`)).body.asset;
  check('aged victim asset now has retentionUntil in the past (createdAt + 1 day)', new Date(victim.retentionUntil) < new Date(), `createdAt=${victim.createdAt} retentionUntil=${victim.retentionUntil} status=${victim.status}`);
  note('restart the server (maintenance tick runs at worker start), then run retention-verify');
}

async function retentionVerify() {
  const hc = await signIn('hc');
  const s = state.retention;
  const a = (await hc.req('GET', `/assets/${s.victim}`)).body.asset;
  check('aged asset past retentionUntil is status deleted after the maintenance tick, proxy/thumbnail keys cleared', a.status === 'deleted' && a.proxyStorageKey === null && a.thumbnailSheetKey === null, `${a.status} retentionUntil=${a.retentionUntil}`);
  const dir = assetDir(hc.teamId, s.victim);
  check('its original and proxy files are removed from disk', DATA_DIR ? !fs.existsSync(dir) : 'SKIP', dir);
  const others = (await hc.req('GET', `/games/${state.gameId}/assets`)).body.items.filter((x) => x.id !== s.victim && s.before.includes(x.id));
  check('younger assets are untouched', others.every((x) => x.status !== 'deleted'), others.map((x) => `${x.id.slice(0, 8)}:${x.status}`).join(' '));
  const audit = await hc.req('GET', `/teams/${hc.teamId}/audit?limit=100`);
  const row = audit.body.items.find((e) => e.action === 'retention.applied' && e.targetId === s.victim);
  check('audit row retention.applied written for the asset (actor null = system)', !!row && (row.actorUserId === null || row.actorUserId === undefined), row ? JSON.stringify(row).slice(0, 200) : 'missing');
  const segs = await hc.req('GET', `/assets/${s.victim}/segments`);
  check('segments and labels of the deleted asset stay for audit', segs.status === 200 && segs.body.items.length > 0, `${segs.body.items?.length}`);
  const grant = await hc.req('GET', `/assets/${s.victim}/grant`);
  check('grant for a deleted asset → 404', grant.status === 404, `${grant.status}`);
  const del = await hc.req('DELETE', `/assets/${s.victim}`);
  check('DELETE on an already deleted asset → 204 (idempotent)', del.status === 204, `${del.status}`);
  const back = await hc.req('PATCH', `/teams/${hc.teamId}/settings`, { body: { expectedVersion: (await hc.req('GET', `/teams/${hc.teamId}/settings`)).body.settings.version, retentionDays: null } });
  check('head coach resets retentionDays to null → 200 (remaining assets keep retentionUntil null)', back.status === 200 && back.body.settings.retentionDays === null, `${back.status}`);
  const pc = await signIn('pc');
  const pcDel = await pc.req('DELETE', `/assets/${state.play1}`);
  check('position coach DELETE /assets/:id → 403', pcDel.status === 403, `${pcDel.status}`);
}

// 10 -----------------------------------------------------------------------------------------
async function security() {
  const c = await signIn('pc');
  const gameId = state.gameId;
  const teamId = c.teamId;
  const before = DATA_DIR ? new Set(walk(DATA_DIR)) : null;
  const evil = '../../../../tmp/qa-escape.mp4';
  const buf = fixture('play-6.mp4');
  const r = await uploadBytes(c, gameId, buf, { filename: evil, chunkBytes: CHUNK });
  check('filename with ../ is accepted as a plain name (storage key uses ids, not the filename)', r.create.status === 201 && r.asset.storageKey === `media/${teamId}/${r.asset.id}/original.mp4` && r.asset.originalFilename === evil, `${r.create.status} storageKey=${r.asset?.storageKey}`);
  check('complete → 200 and the file landed inside media/<team>/<asset>/', r.complete?.status === 200 && (DATA_DIR ? fs.existsSync(path.join(assetDir(teamId, r.asset.id), 'original.mp4')) : true), `${r.complete?.status}`);
  if (DATA_DIR) {
    const after = new Set(walk(DATA_DIR));
    const outside = [...after].filter((p) => !before.has(p) && !p.startsWith(path.join(DATA_DIR, 'media', teamId, r.asset.id)) && !p.includes('footballos.sqlite') && !p.startsWith(path.join(DATA_DIR, 'uploads')));
    check('no file was written outside the asset directory (and /tmp/qa-escape.mp4 does not exist)', outside.length === 0 && !fs.existsSync('/tmp/qa-escape.mp4'), outside.join(',') || 'none');
  }
  await waitReady(c, r.asset.id, 'play-6 (../ filename)');
  state.assets = state.assets ?? {};
  state.assets['play-6.mp4'] = r.asset.id;
  for (const name of ['evil.sh', 'evil.mp4.exe', 'noext', 'evil.html', '.mp4']) {
    const bad = await c.req('POST', `/games/${gameId}/uploads`, { body: { filename: name, byteSize: 10, mimeType: 'video/mp4', context: DEFAULT_CONTEXT } });
    check(`filename "${name}" → 400 (extension not in ALLOWED_VIDEO_CONTAINERS)`, bad.status === 400 && code(bad) === 'validation_error', `${bad.status} ${code(bad)}`);
  }
  const nul = await c.req('POST', `/games/${gameId}/uploads`, { body: { filename: 'a\u0000b.mp4', byteSize: 10, mimeType: 'video/mp4', context: DEFAULT_CONTEXT } });
  note(`filename with a NUL byte → ${nul.status} (stored as originalFilename only; storage key is id-based)`);
  if (nul.status === 201) await c.req('POST', `/uploads/${nul.body.upload.id}/complete`, { body: {} });
  const huge = await c.req('POST', `/games/${gameId}/uploads`, { body: { filename: 'big.mp4', byteSize: 21474836480 + 1, mimeType: 'video/mp4', context: DEFAULT_CONTEXT } });
  check('byteSize above MAX_UPLOAD_BYTES → 413 payload_too_large at create', huge.status === 413 && code(huge) === 'payload_too_large', `${huge.status} ${code(huge)}`);
  const badRange = await c.req('PUT', `/uploads/${r.upload.id}`, { raw: true, body: Buffer.alloc(1), headers: { 'content-range': 'bytes 0-0/1', 'content-type': 'application/octet-stream' } });
  check('PUT on a completed upload → 409 conflict', badRange.status === 409, `${badRange.status} ${code(badRange)}`);

  // uploaded bytes are never interpreted: an HTML "video" is rejected by validate; can it still be streamed as text/html?
  const html = Buffer.from('<!doctype html><html><body><script>document.title="qa-xss"</script>QA HTML masquerading as film</body></html>');
  const h = await uploadBytes(c, gameId, html, { filename: 'page.mp4', chunkBytes: CHUNK, mimeType: 'text/html' });
  check('HTML bytes named .mp4 with mimeType text/html: upload accepted (mimeType is not validated at create)', h.create.status === 201 && h.complete?.status === 200, `${h.create.status}/${h.complete?.status}`);
  const jobs = await waitJobs(c, teamId, h.asset.id, (js) => js.some((j) => j.kind === 'validate' && isTerminal(j)), { timeoutMs: 120_000 });
  const asset = (await c.req('GET', `/assets/${h.asset.id}`)).body.asset;
  check('validate rejects it (asset rejected with a reason) and the rest of the chain fails upstream_failed', asset.status === 'rejected' && jobs.filter((j) => j.kind !== 'validate').every((j) => j.error?.code === 'upstream_failed'), `${asset.status}: ${asset.rejectionReason} | ${summarizeJobs(jobs)}`);
  const grant = await c.req('GET', `/assets/${h.asset.id}/grant`);
  if (grant.status === 200) {
    const anon = client();
    const s = await anon.req('GET', URL_ + grant.body.streamUrl, { absolute: true });
    check('a REJECTED upload must not be served; if it is, its Content-Type must not be the client-supplied text/html (stored XSS on the API origin)', s.status === 404 || (s.status === 200 && !/text\/html/i.test(s.headers.get('content-type') ?? '')), `${s.status} content-type=${s.headers.get('content-type')} nosniff=${s.headers.get('x-content-type-options')} body=${String(s.text).slice(0, 40)}`);
  } else {
    check('grant for a rejected asset → 404', grant.status === 404, `${grant.status}`);
  }
  const inferRejected = await c.req('POST', `/assets/${h.asset.id}/infer`, { body: {} });
  check('infer on a rejected asset → 409 conflict', inferRejected.status === 409, `${inferRejected.status}`);
  // audit/listing never exposes storage internals beyond the relative key
  const list = await c.req('GET', `/games/${gameId}/assets`);
  check('asset listing exposes relative storage keys only (no absolute paths)', list.body.items.every((a) => !a.storageKey?.startsWith('/') && !(a.proxyStorageKey ?? '').startsWith('/')), `${list.body.items.length} assets`);
  state.security = { escapeAsset: r.asset.id, htmlAsset: h.asset.id };
}

/** Scans the server log(s) named by FOS_LOG (comma-separated) for credential material. */
async function logSweep() {
  const files = (LOG || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (files.length === 0) { check('log sweep', 'SKIP', 'FOS_LOG not set'); return; }
  let total = 0;
  const hits = [];
  for (const f of files) {
    const log = fs.readFileSync(f, 'utf8');
    total += log.length;
    if (/fos_session=[A-Za-z0-9]/.test(log)) hits.push(`${path.basename(f)}: session cookie value`);
    if (/"password":"[^"]+"/.test(log)) hits.push(`${path.basename(f)}: password field`);
    if (/token=[A-Za-z0-9_%.-]{40,}/.test(log)) hits.push(`${path.basename(f)}: grant token in a URL`);
    if (/"(ANTHROPIC|OPENAI)_API_KEY":"[^"]+"/.test(log) || /sk-ant-|sk-proj-/.test(log)) hits.push(`${path.basename(f)}: API key`);
    if (/[A-Z2-7]{32}/.test(log.replace(/"idempotencyKey":"[0-9a-f]+"/g, ''))) hits.push(`${path.basename(f)}: base32 TOTP-secret-like string`);
    const tails = [state.delivery?.tokenTail].filter(Boolean);
    for (const t of tails) if (log.includes(t)) hits.push(`${path.basename(f)}: grant token tail ${t}`);
  }
  check(`server logs contain no session cookies, passwords, API keys, TOTP secrets or grant tokens (${files.length} file(s), ${total} bytes)`, hits.length === 0, hits.join('; ') || 'clean');
  const sample = fs.readFileSync(files[0], 'utf8').split('\n').filter(Boolean).slice(-3).map((l) => l.slice(0, 160));
  note(`log sample: ${sample.join(' | ')}`);
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
