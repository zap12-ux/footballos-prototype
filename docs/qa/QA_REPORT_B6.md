# QA report B6 — Milestone B film workflow API and worker (independent verification)

Reviewer: E (independent QA / security), worktree `.worktrees/e2-qa`, branch `wt/e2-qa` from
`integration` at `b2e1008`. `integration` moved to `122f610` while this ran; `git diff --stat
b2e1008 integration -- apps/api packages docs/team/CONTRACTS.md` is empty, so every result below
applies to the integrated code. Date: 2026-10-25. Machine: macOS 14 (Darwin 23.6.0), Node v25.9.0,
bundled `ffmpeg-static` / `ffprobe-static` (x64 builds under Rosetta), iCloud sync in the
background; generous timeouts were used and no result below is attributed to load.

Rules followed: nothing outside `docs/qa/**` and `tests/e2e/**` was edited; no fix was applied;
every command below was run and the output shown is the real one; credentials were taken from the
`seed:demo` output into a private env file and never printed; the live console on port 4800 was
used only for my own `agentctl status` / `result` calls. Scope: API and worker only (the film UI
is not integrated yet and will be assigned separately).

Verdict in one line: **the resumable upload, job chain, restart recovery, cancel/retry, truthful
provider failure, correction persistence, scouting arithmetic, media grants, cross-team scoping
and retention all behave as CONTRACTS §14 says on every check I ran** — with **1 high defect**
(a rejected upload is still served with the client-supplied `Content-Type`, a stored-XSS path on
the API origin), **2 medium defects** (a job orphaned by a crash is never recovered when the server is restarted
before its lease expires — expired leases are only recovered at worker start, so the chain stays
`running` until yet another restart; the documented `tsx` dev scripts fail in a fresh worktree) and 5 low findings / documentation mismatches.

## Reusable scripts added (plain Node >= 22, no new dependencies)

| Script | Purpose |
| --- | --- |
| `tests/e2e/b6-lib.mjs` | Shared helpers: cookie-jar client, RFC 6238 TOTP, sign-in per seeded role, chunked `PUT` upload, job polling, state file, file-system and log assertions. Credentials only from `FOS_*` env vars. |
| `tests/e2e/b6-film-workflow.mjs <scenario> --state <file>` | The B6 scenarios: `upload`, `resume-start/finish`, `restart-start/verify`, `restart-probe`, `cancel-retry`, `finish-chain`, `provider-none`, `provider-nokey`, `corrections --phase before/after`, `scouting`, `delivery`, `retention-set/recompute/verify`, `security`, `log-sweep`. Each prints PASS/FAIL lines and exits non-zero on failure. |
| `tests/e2e/b6-rerun-job.mjs <assetId> [kind]` | Forces a re-run of a succeeded chain job through the API's built job store (no HTTP route can re-run a succeeded job; see O-3). The running server's worker executes it. |
| `tests/e2e/b6-age-asset.mjs <assetId> [days]` | Moves `media_assets.created_at` back N days (via the API's own `better-sqlite3`) so a 1-day retention can be exercised today. Refuses production. |
| `tests/e2e/api-create-second-team.mjs` (extended) | Now also creates a position coach in the second team when `FOS_T2_EMAIL` / `FOS_T2_PASSWORD` are set, so the cross-team sweep runs as a genuine member of another team. |

## Environment and setup (exact commands)

```sh
npm install                                             # worktree root, exit 0
npm run build -w apps/api                               # exit 0 (builds contracts, media, ai first)
FOOTBALLOS_ENV=demo FOOTBALLOS_DATA_DIR=$PWD/.data/wt-e2 PASSWORD_SCRYPT_LOG2N=14 npm run seed:demo -w apps/api
#   exit 1: Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../packages/media/dist/types.ts'
#   imported from .../packages/media/dist/index.d.ts   (tsx resolves @footballos/media through
#   tsconfig paths to the .d.ts, whose specifiers end in .ts)                      → defect D-3
FOOTBALLOS_ENV=demo FOOTBALLOS_DATA_DIR=$PWD/.data/wt-e2 PASSWORD_SCRYPT_LOG2N=14 node apps/api/dist/scripts/seed-demo.js
#   exit 0: team "Winchester Hawks (demo)" id=071a494b…, season 2026, 8 games + bye, 6 staff; credentials printed once
```

Server (every run, through a small start script so restarts are identical):

```sh
cd apps/api && FOOTBALLOS_ENV=demo FOOTBALLOS_DATA_DIR=<worktree>/.data/wt-e2 PORT=8792 WORKER_INLINE=true \
  UPLOAD_CHUNK_BYTES=1048576 WORKER_POLL_MS=500 PASSWORD_SCRYPT_LOG2N=14 MODEL_PROVIDER=none [overrides…] node dist/server.js
# /healthz → {"ok":true,"environment":"demo","version":"0.1.0"}; log: "worker starting" recoveredJobs=0 concurrency=1
```

`UPLOAD_CHUNK_BYTES=1048576` (1 MiB) so the 3.5 MB fixture needs four chunks. Runs 1–13 of the
server were made (logs `api-run1.log` … `api-run13.log` in my scratch directory; all 12 present at
sweep time were scanned for secrets, §10). Per-scenario invocation:

```sh
source <private>/creds.sh     # FOS_URL, FOS_DATA_DIR, FOS_HC_*, FOS_OC_*, FOS_PC_*, FOS_AN_*, FOS_T2_*
node tests/e2e/b6-film-workflow.mjs <scenario> --state <scratch>/b6-state.json [--file play-N.mp4]
```

## Summary table

| # | Check (brief) | Scenario | Result |
| --- | --- | --- | --- |
| 1 | Chunked upload of play-1, resume state, out-of-order 409, oversize 413, complete → 4 jobs, duplicate 409, no second directory | `upload` | **PASS 25/25** |
| 2 | Interrupted upload: two chunks, server restart (SIGTERM), GET, resume, complete | `resume-start`, `resume-finish` | **PASS 1/1 + 7/7** |
| 3 | Worker restart: SIGKILL while `proxy` runs, lease expires, restart re-claims, chain finishes, no duplicates | `restart-start`, `restart-verify` | **PASS 2/2 + 8/8** |
| 3b | Same, but restarted *before* the lease expired (is the orphan ever recovered without another restart?) | `restart-probe` | **FAIL** (D-2): 170 s after the restart (84 s after the lease expired) the job was still `running` under the dead worker id; a third restart recovered it and the chain finished |
| 4 | Cancel queued and running jobs → `canceled`, dependents `upstream_failed`; retry → chain completes | `cancel-retry` (play-5) | **PASS 14/14** (first run on play-4: 4 FAIL caused by my own sequence, explained in §4) |
| 5a | `MODEL_PROVIDER=none` → `provider_unavailable`, `retryable:false`; manual PATCH works | `provider-none` | **PASS 10/10** |
| 5b | `MODEL_PROVIDER=anthropic`, no key, dead proxy/base URL → truthful failure, no network call | `provider-nokey` | 3/4: fails non-retryably with no network call, but the message says "No model provider is configured" instead of naming the key (D-4); with the default `MONTHLY_COST_CAP_USD=0` the failure is `budget_exceeded` instead |
| 6 | Correction persists across a `segment` re-run and an inference re-run; version increments only on real changes | `corrections` + `b6-rerun-job.mjs` | 8/9: correction, revisions and segment survive; an identical PATCH still bumps `version` and writes a revision (D-5) |
| 7 | Known label mix → numerators/denominators for both bases vs hand computation; snapshot and `inputsHash` | `scouting` | **PASS 28/28** |
| 8 | Grant → Range 206/416, tampered/expired/foreign 401, thumb tiles, token not logged; second team's user 404 on 30 routes | `delivery` | **PASS 19/19** |
| 9 | `retentionDays` head-coach-only; aged asset removed by the maintenance tick with an audit row | `retention-set/recompute/verify` | **PASS 9/9 + 2/2 + 9/9** (`retentionDays: 0` is a contract `400`, see O-1) |
| 10 | Security sweep: `../` filenames, unsafe extensions, uploaded bytes not interpreted, token logging, secrets in git | `security`, `log-sweep`, git grep | 16/18: **rejected upload streamed as `text/html` (D-1)**; bare `.mp4` filename accepted (D-7); logs clean; no secrets tracked |
| 11 | `npm test -w apps/api -w packages/media -w packages/ai` | — | **PASS api 68/68, media 79/79, ai 65/65** |
| 12 | Documented `tsx` scripts (`seed:demo`, `dev`, `worker`) in a fresh worktree | — | **FAIL** (D-3): `seed:demo`, `dev` and `worker` all exit with `ERR_MODULE_NOT_FOUND packages/media/dist/types.ts`; `migrate` works; the built `dist/` entry points work |

## 1. Chunked upload (`upload`, play-1.mp4, 3 535 378 bytes → 4 chunks)

```
PASS  POST /games/:gameId/uploads → 201 { upload(receivedBytes 0), asset(uploading, sha256 null) }
PASS  upload.chunkSizeBytes equals the server UPLOAD_CHUNK_BYTES used by this run  -- 1048576
PASS  GET /uploads/:id before any chunk → receivedBytes 0
PASS  PUT chunk 1 (contiguous) → 200 receivedBytes = chunk  -- receivedBytes=1048576
PASS  out-of-order chunk (start = 2×chunk while receivedBytes = chunk) → 409 conflict with details.receivedBytes  -- 409 conflict receivedBytes=1048576
PASS  oversize chunk (chunk+1 bytes) → 413 payload_too_large
PASS  rejected chunks did not advance receivedBytes
PASS  remaining 3 chunks contiguous → 200, receivedBytes = total  -- receivedBytes=3535378
PASS  GET /uploads/:id resume state shows receivedBytes = totalBytes
PASS  POST /uploads/:id/complete → 200 asset uploaded with the server-computed sha256  -- sha256=e458c9f265c3…
PASS  complete enqueues four chained jobs validate → proxy → thumbnails → segment (queued)
PASS  each chain job carries its idempotencyKey and configVersion  -- media-chain-1:proxy720:thumb10
PASS  completing again is idempotent (200, same four job ids)
PASS  partial file is moved out of uploads/ at completion
PASS  original stored at media/<teamId>/<assetId>/original.mp4 with mode 0600
PASS  duplicate create with the same sha256 → 409 conflict details.existingAssetId
PASS  duplicate bytes uploaded without a client hash → complete answers 409 existingAssetId
PASS  the duplicate placeholder asset is discarded (GET → 404) and its upload is gone
PASS  no second asset directory was created for the duplicate  -- media/<team>/ dirs before=1 after=1
PASS  duplicate partial file deleted
PASS  GET /games/:gameId/assets lists exactly the real asset (no duplicate rows)
PASS  play-1: chain finished (validate, proxy, thumbnails, segment all succeeded)
PASS  play-1: asset is ready with proxy and thumbnail keys
PASS  segments proposed and every segment has 12 labels in accepted.status unknown  -- segments=1 labels=12
PASS  asset probe facts filled (durationSec, width, height, fps) and quality present  -- 6.374s 1920x1080@29.97
25 passed, 0 failed, 0 skipped
```

Each 6–7 s fixture clip yields exactly one proposed segment; the whole chain takes 10–20 s on this
machine.

## 2. Interrupted upload (`resume-start` → SIGTERM → restart → `resume-finish`, play-2.mp4)

```
PASS  resume: created upload and sent exactly two chunks  -- receivedBytes=2097152
kill -TERM <pid>   # log: "shutting down" signal=SIGTERM; restarted from the same data dir
PASS  after the restart GET /uploads/:id still knows the upload and its receivedBytes  -- 200 receivedBytes=2097152
PASS  partial file survived the restart with at least receivedBytes bytes
PASS  re-sending chunk 1 after the restart → 409 with the server's receivedBytes (client resumes from it)
PASS  resumed from receivedBytes to the end  -- 200 3888587
PASS  complete after resume → 200, sha256 matches the client hash, four jobs
PASS  play-2 (resumed): chain finished … / asset is ready with proxy and thumbnail keys
7 passed, 0 failed, 0 skipped
```

## 3. Worker restart recovery (`restart-start` → SIGKILL → lease expiry → restart → `restart-verify`, play-3.mp4)

Run with `JOB_LEASE_SECONDS=15` so the wait is short (default 300).

```
PASS  caught the proxy job while running (lease held by the worker)  -- proxy attempt=1 lease=…19:34:53.870Z worker=worker-e8aae1f6
SIGKILL sent to 20837 at 19:34:38; process gone; waited 18 s; restarted
log: {"msg":"job recovered","recovered":1} {"msg":"worker starting","recoveredJobs":1}
     {"msg":"job claimed","kind":"proxy","error":{"code":"lease_expired","message":"worker worker-e8aae1f6 stopped heartbeating; re-queued","retryable":true}}
PASS  expired lease was recovered at worker start (job left the dead worker; re-queued or already re-run)
PASS  play-3 (after SIGKILL + restart): chain finished  -- segment#1 thumbnails#1 proxy:succeeded#2 validate#1
PASS  proxy job succeeded on a later attempt than the killed one (attempt >= 2) with the same job id
PASS  no duplicate jobs for the asset after recovery (still exactly the four chain jobs)
PASS  no duplicate asset rows (count before + 1)  -- before=2 after=3
PASS  segments unique and non-overlapping, labels exactly 12 per segment, no duplicates  -- segments=1 labels=12
PASS  asset directory holds one original, one proxy, one thumbnail sheet
8 passed, 0 failed, 0 skipped
```

### 3b. Restart before the lease expires (`restart-probe`, team 2, play-1.mp4, `JOB_LEASE_SECONDS=90`)

By reading, `recoverExpiredLeases()` runs only once at worker start (`startWorker` → `runner.recover()`;
the runner's loop calls `recover()` once too) and `claim()` only selects `queued`/`retry_wait`
rows, so a job whose lease is still valid at restart would stay `running` under the dead worker id
until some later restart. Verified:

```
=== probe start (team 2 user, play-1, lease 90 s) 19:45:31
PASS  probe: caught proxy running  -- lease=2026-10-25T19:47:03.172Z worker=worker-1eda330b
SIGKILL 24064 at 19:45:33; restarted immediately at 19:45:36; log at start: "job recovered" count 0
=== poll 170 s
FAIL  probe: within 170s after a restart that happened before the lease expired, the orphaned job is recovered without another restart
      -- transitions: 0s running/1/worker-1eda330b; final status=running attempt=1 worker=worker-1eda330b
         lease=2026-10-25T19:47:03.172Z (dead worker worker-1eda330b, lease expired=true)
=== third restart at 19:48:27 → log: {"msg":"job recovered","recovered":1} {"msg":"worker starting","recoveredJobs":1}
PASS  probe asset (t2): chain finished  -- proxy:succeeded#2
PASS  probe: proxy job finished by a worker other than the dead one, attempt >= 2
```

So the contract's "on start it calls `recoverExpiredLeases()`" is met, but a crash followed by a
prompt restart (what a supervisor such as launchd/systemd does) leaves the chain and the asset
(`processing`) stuck indefinitely, with `GET /jobs/:id` reporting `running` and a lease in the
past. Filed as D-2.

## 4. Cancel and retry (`cancel-retry`)

First run (play-4.mp4) — 8 PASS / 4 FAIL, all four caused by my sequence, not the product: I had
canceled `thumbnails` explicitly (error `null`) and then expected the retry of `proxy` to re-queue
it. The README says only dependents that failed *because of* the retried job (`upstream_failed`)
are re-queued; an explicitly canceled job needs its own retry. The corrected script retries those
too. Second run (play-5.mp4):

```
PASS  cancel a queued job (thumbnails) → 200 job.status canceled, canceledAt set
PASS  its dependent (segment) ends with error.code upstream_failed  -- status=canceled error={"code":"upstream_failed",…,"retryable":false}
NOTE  dependent status after cancel is 'canceled' (14.9 says dependents of a canceled job become 'failed')    → D-6
PASS  cancel on an already canceled job → 409 conflict
PASS  cancel a RUNNING job (proxy) → 200 with cancelRequestedAt set  -- status=running cancelRequestedAt=…
PASS  running job reaches canceled (handler observed signal.aborted, ffmpeg killed)  -- progress="Encoding proxy"; proxy.mp4 absent afterwards
PASS  retry on a succeeded job → 409 conflict
PASS  retry proxy → 200 queued with attempt reset to 0 and error cleared
PASS  explicitly canceled jobs are NOT re-queued by another job's retry (they keep status canceled, error null)
PASS  retry the explicitly canceled thumbnails → 200 queued
PASS  upstream_failed dependents (segment) are re-queued by the retry of the job they depend on
NOTE  analyst retry → 409 (analyst may manage jobs per §3 policy)   # 409 because the job was already queued
PASS  play-5.mp4 (after cancel + retry): chain finished / asset ready
PASS  after retry the same four job ids finished (no new job rows)
PASS  segments and labels present once after retry  -- segments=1 labels=12
14 passed, 0 failed, 0 skipped
```

The play-4 asset was left in `processing` with its `thumbnails` canceled; `finish-chain --asset 076d593c…`
later retried that one job (`200 queued`) and the chain completed (`segment#1 thumbnails#1 proxy#1
validate#1`, asset `ready`), which is the documented behavior for an explicitly canceled job.

## 5. Provider failure

### 5a `MODEL_PROVIDER=none` (`provider-none`)

```
PASS  POST /assets/:id/infer → 202 { jobs: [infer_labels] }
PASS  with MODEL_PROVIDER=none the job fails with provider_unavailable, retryable:false, "No model provider is configured"
PASS  failed inference job finished without attempts beyond the first  -- attempt=1
PASS  no ModelProvenance row was written for the failed job
PASS  labels untouched: all still unknown with inferred null
PASS  manual PATCH /labels/:id still works → 200, accepted.status corrected, value run, version+1, byUserId set
PASS  one LabelRevision unknown→corrected with the reason
PASS  stale expectedVersion → 409 with currentVersion
PASS  bulk-accept with no inferred labels → 200 { accepted: 0, skipped: n }  -- {"accepted":0,"skipped":2}
PASS  a second infer after the failed one starts a new generation (new job id, 202)
NOTE  GET /teams/:id/usage → 200 {"costUsd":0,"monthlyCostCapUsd":0,"jobsSucceeded":18,"jobsFailed":1,…}
10 passed, 0 failed, 0 skipped
```

### 5b `MODEL_PROVIDER=anthropic`, `ANTHROPIC_API_KEY` unset (`provider-nokey`)

Server restarted with `MODEL_PROVIDER=anthropic MONTHLY_COST_CAP_USD=25 HTTPS_PROXY=http://127.0.0.1:9
ANTHROPIC_BASE_URL=http://127.0.0.1:9` (both point at a dead port: any real request would surface
as `ECONNREFUSED`/proxy error). Log at start: `"modelProvider":"anthropic","modelKeyConfigured":false`.

```
PASS  MODEL_PROVIDER=anthropic without a key: infer → 202 then the job fails
PASS  failure is non-retryable and names the missing key (no network attempted: not a proxy/connection error)
      -- {"code":"provider_unavailable","message":"No model provider is configured","retryable":false}
FAIL  error names the reason truthfully (contains no_api_key or ANTHROPIC_API_KEY)                       → D-4
PASS  no provenance row, no cost recorded
lsof -nP -p <api pid> -iTCP  → no TCP socket other than the 8792 listener (no outbound connection)
```

Same with the default cap (`MONTHLY_COST_CAP_USD` unset = 0, the `.env.example` default):

```
{"code":"budget_exceeded","message":"Month-to-date model spend $0.0000 has reached the monthly cap $0.00 (MONTHLY_COST_CAP_USD)","retryable":false}
```

Both failures are truthful in the narrow sense (no work done, no call, non-retryable), but neither
tells the coach that the key is missing: the worker converts D's `ProviderUnavailableError`
(`reason: 'no_api_key'`) into `NonRetryableError('provider_unavailable', err.message)` and D's
handler message for the no-key case is the `MODEL_PROVIDER=none` sentence; and the budget check
runs before the key check. See D-4.

## 6. Correction persistence (`corrections --phase before` → `b6-rerun-job.mjs` → `--phase after`)

```
PASS  correct formation_family → corrected "trips"  -- v=2
FAIL  PATCH with an identical accepted block: observe whether version increments  -- version before=2 after=3   → D-5
node tests/e2e/b6-rerun-job.mjs a1272a15-… segment
  {"jobId":"0e57364a-…","kind":"segment","configVersion":"media-chain-1:proxy720:thumb10:qa-rerun-1792957293209","duplicate":false}
PASS  a second segment job ran for the asset and succeeded  -- segment:succeeded#1 segment:succeeded#1
PASS  after the segment re-run the corrected label row still exists on the same segment  -- v=3
PASS  accepted block intact (value, status, byUserId, at) and version unchanged
PASS  revision history intact (same count as before the re-runs)  -- 2 vs 2
PASS  the coach-touched segment was kept by the re-run; untouched proposals were replaced  -- kept=true live=1 (before 1)
PASS  labels are exactly 12 per live segment after the re-run (no duplicates, no orphans in the listing)
PASS  inference re-run (failed/provider_unavailable) left the corrected label untouched  -- v=3
```

NOT RUN: "untouched proposals are replaced by a re-run" could not be observed end to end because
each fixture clip produces exactly one proposal and the only one on play-1 was coach-touched
(kept). The replacement branch of `storeProposedSegments` is covered by reading and by the api unit
suite only. Inference re-run "as far as the provider allows" = the job fails before touching labels
(no provider); `applyInference` preservation is covered by ai unit tests (65/65), not by this run.

## 7. Counts and denominators (`scouting`)

Five live segments across the game's opponent/offense assets (one per clip; one proposal was split
into two coach parts to reach five), all other live segments of the game marked `rejected` so the
denominators are exact. Labels set with `PATCH /labels/:id`:

| Segment | reviewStatus | formation_family | play_type |
| --- | --- | --- | --- |
| s1 | accepted | trips (accepted) | pass (corrected) |
| s2 | accepted | trips (accepted) | run (accepted) |
| s3 | accepted | i_form (accepted) | unknown |
| s4 | **proposed** | trips (accepted) | pass (accepted) |
| s5 | rejected | trips (accepted) | unknown |

Hand computation. `reviewed_only`: proposed s4 is "unreviewed", rejected s5 is "rejected" →
sample 3; formation trips 2/3, i_form 1/3; play type by formation (both known): trips → pass 1/2,
run 1/2; i_form has no play type → no finding. `includes_inferred`: s4 joins → sample 4; trips 3/4,
i_form 1/4; trips → pass 2/3, run 1/3. The API answered exactly that:

```
PASS  reviewed_only: sampleSize = 3 | formation_frequency trips = 2/3 (66.7%) | i_form = 1/3 (33.3%)
PASS  reviewed_only: play_type_by_formation trips→pass = 1/2 | trips→run = 1/2 | i_form has no play_type finding
PASS  reviewed_only: rejected segment s5 never counted; listed as excluded  -- rejected
PASS  includes_inferred: sampleSize = 4 | trips = 3/4 (75%) | i_form = 1/4 (25%) | trips→pass = 2/3 | trips→run = 1/3
PASS  reviewed_only excludes the proposed segment s4 as "unreviewed"
PASS  every finding carries reviewBasis, gameIds, includedSegmentIds and percent = round(n/d)
PASS  inputsHash is stable across two identical computations (computedAt differs)  -- b784f77383055f53…
PASS  inputsHash differs between review bases
PASS  POST …/scouting/snapshots → 201 with the same findings and inputsHash as the live report
PASS  after one more accepted label the inputsHash changes and i_form→run becomes 1/1
PASS  the stored snapshot keeps its original inputsHash (snapshots are frozen)
PASS  unit outside the enum → 400 validation_error
PASS  unit=defense over offense-only film → sampleSize 0 and no findings (other_unit exclusion, nothing fabricated)
28 passed, 0 failed, 0 skipped
```

Not reachable in this run: `inferred` labels (no provider), so the two bases differ only through
segment review status; `resolveLabelValue`'s `inferred` branch is covered by the ai unit tests.

## 8. Media delivery and cross-team scoping (`delivery`)

```
PASS  GET /assets/:id/grant → 200 { streamUrl, thumbUrlTemplate, expiresAt (<= 15 min) }
PASS  stream without Range → 200 video/mp4 full proxy, Accept-Ranges bytes, Cache-Control private no-store  -- 1750875 bytes
PASS  Range bytes=100-199 → 206, Content-Range bytes 100-199/size, 100 bytes equal to the same slice of the full body
PASS  open-ended Range → 206 last 50 bytes | suffix Range bytes=-10 → 206 last 10 bytes
PASS  Range past the end → 416 with Content-Range bytes */size
PASS  tampered signature → 401 | missing token → 401 | signed-in session without a token → 401 | token of asset A on asset B → 401
PASS  expired token (exp in the past, valid signature under the dev secret) → 401
NOTE  a grant forged with the published development secret is ACCEPTED (SESSION_SECRET unset → known secret)   → O-2
PASS  thumb tile 0 → 200 image/jpeg (JPEG magic bytes) | tile 9999 → 404 | tile -1 → 400 | tampered token → 401
PASS  the grant token does not appear in the server log
PASS  second team's user gets 404 on every new route with first-team ids (30 routes)  -- all 404
PASS  second team's user reads its own team settings → 200 | first team's opponent id under the second team → 404
19 passed, 0 failed, 0 skipped
```

The 30 routes: `GET /games/:g/assets`, `POST /games/:g/uploads`, `GET|PUT /uploads/:u`,
`POST /uploads/:u/complete`, `GET|DELETE /assets/:a`, `GET /assets/:a/grant`, `GET /teams/:t/jobs`,
`GET /jobs/:j`, `POST /jobs/:j/cancel|retry`, `GET|POST /assets/:a/segments`,
`POST /segments/:s/split`, `POST /segments/merge`, `PATCH /segments/:s`, `POST /assets/:a/infer`,
`GET /segments/:s/labels`, `GET /assets/:a/labels`, `PATCH /labels/:l`, `GET /labels/:l/revisions`,
`POST /assets/:a/labels/bulk-accept`, `GET /assets/:a/provenance`, `GET …/scouting`,
`GET|POST …/scouting/snapshots`, `GET|PATCH /teams/:t/settings`, `GET /teams/:t/usage`.

## 9. Retention (`retention-set` → `b6-age-asset.mjs` → `retention-recompute` → restart → `retention-verify`)

```
PASS  GET /teams/:id/settings → retentionDays null by default (keep until deleted), uploadLimits, version 1
PASS  retentionDays 0 is rejected by the contract (400 validation_error; schema min 1)                        → O-1
PASS  position coach / coordinator / analyst PATCH settings → 403 forbidden
PASS  wrong expectedVersion → 409 currentVersion
PASS  head coach PATCH retentionDays 1 → 200 version+1
PASS  every live asset now carries retentionUntil = createdAt + 1 day
PASS  audit row settings.changed written
node tests/e2e/b6-age-asset.mjs 09adf25b-… 3     # created_at 2026-10-25 → 2026-10-22 (fixture manipulation, documented)
PASS  retentionDays 2 → 1 re-PATCH as head coach → 200/200 (recomputes retentionUntil)
PASS  aged victim asset now has retentionUntil in the past  -- retentionUntil=2026-10-23T19:44:04.753Z
restart → log: {"msg":"maintenance tick","expiredUploads":0,"retentionDeleted":1}
PASS  aged asset past retentionUntil is status deleted after the maintenance tick, proxy/thumbnail keys cleared
PASS  its original and proxy files are removed from disk
PASS  younger assets are untouched
PASS  audit row retention.applied written for the asset (actor null = system)
PASS  segments and labels of the deleted asset stay for audit
PASS  grant for a deleted asset → 404 | DELETE on an already deleted asset → 204 | position coach DELETE → 403
PASS  head coach resets retentionDays to null → 200
```

## 10. Security sweep (`security`, `log-sweep`, git)

```
PASS  filename with ../ is accepted as a plain name (storage key uses ids, not the filename)  -- storageKey=media/<team>/<asset>/original.mp4
PASS  complete → 200 and the file landed inside media/<team>/<asset>/
PASS  no file was written outside the asset directory (and /tmp/qa-escape.mp4 does not exist)   # full data-dir walk before/after
PASS  play-6 (../ filename): chain finished / ready
PASS  filename "evil.sh" | "evil.mp4.exe" | "noext" | "evil.html" → 400 validation_error
FAIL  filename ".mp4" → 400  -- 201                                                                            → D-7
NOTE  filename with a NUL byte → 201 (stored as originalFilename only; storage key is id-based)              → D-7
PASS  byteSize above MAX_UPLOAD_BYTES → 413 payload_too_large at create
PASS  PUT on a completed upload → 409 conflict
PASS  HTML bytes named .mp4 with mimeType text/html: upload accepted (mimeType is not validated at create)
PASS  validate rejects it (asset rejected: "The file could not be read as video (… ffprobe failed …)") and the chain fails upstream_failed
FAIL  a REJECTED upload must not be served; if it is, its Content-Type must not be the client-supplied text/html
      -- 200 content-type=text/html nosniff=nosniff body=<!doctype html><html><body><script>docum…               → D-1
PASS  infer on a rejected asset → 409 conflict
PASS  asset listing exposes relative storage keys only (no absolute paths)
PASS  server logs contain no session cookies, passwords, API keys, TOTP secrets or grant tokens (12 file(s), 24577 bytes)
```

Code reading (not fixed): `packages/media` runs ffmpeg/ffprobe only through `child_process.execFile`
with argument arrays (`ffmpeg.ts`), never a shell; no `eval`/`new Function`/dynamic `import()` of
uploaded content anywhere in `apps/api`, `packages/media`, `packages/ai`; storage keys are built from
ids (`storage.ts`), `absolutePath()` refuses keys outside the data dir and `keyFor()` refuses paths
outside it; directories `0700`, files `0600` (verified on the original). Logger redacts any field
named like a credential; the error handler logs `c.req.path` (no query string), so grant tokens
cannot reach the log through errors.

```
git ls-files | grep -Ei '(^|/)\.env($|\.)|\.sqlite|\.pem$|\.key$' | grep -v example      → nothing tracked
git grep -nE 'sk-ant-[A-Za-z0-9_-]{10,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|BEGIN (RSA|EC|OPENSSH) PRIVATE KEY' -- . ':!package-lock.json'
   → only the intentionally fake strings in tests/e2e/console-scenarios.mjs and tools/agent-console/src/test/routes.test.ts
git grep -nE 'ANTHROPIC_API_KEY=.+|OPENAI_API_KEY=.+' | grep -v 'KEY=$'   → packages/ai/README.md:77 placeholder "..." only
.gitignore: .data/, .env, .env.* (not .env.example)
```

## 11. Unit suites

```
npm test -w apps/api -w packages/media -w packages/ai
  @footballos/api    Test Files 7 passed (7)   Tests 68 passed (68)   Duration 38.14s
  @footballos/media  Test Files 7 passed (7)   Tests 79 passed (79)   Duration 46.35s
  @footballos/ai     Test Files 9 passed (9)   Tests 65 passed (65)   Duration 11.30s
exit 0
```

## 12. Documented developer scripts in a fresh worktree

All three `tsx` entry points of `apps/api` fail the same way in this fresh worktree (Node v25.9.0,
`npm install` + `npm run build -w apps/api` done first); `npm run migrate` (which does not import
`@footballos/media`) works.

```
FOOTBALLOS_ENV=demo FOOTBALLOS_DATA_DIR=$PWD/.data/wt-e2 npm run seed:demo -w apps/api
  Error [ERR_MODULE_NOT_FOUND]: Cannot find module '<wt>/packages/media/dist/types.ts'
  imported from <wt>/packages/media/dist/index.d.ts            (exit 1)
FOOTBALLOS_ENV=demo FOOTBALLOS_DATA_DIR=$PWD/.data/wt-e2-devcheck PORT=8799 WORKER_INLINE=true npm run dev -w apps/api
  same error; /healthz on 8799 never answered (curl → 000 after 75 s)
FOOTBALLOS_ENV=demo FOOTBALLOS_DATA_DIR=$PWD/.data/wt-e2-devcheck npm run worker -w apps/api
  same error                                                   (npm error command sh -c tsx src/worker.ts)
npm run migrate -w apps/api                                    exit 0
node apps/api/dist/scripts/seed-demo.js / node apps/api/dist/server.js     work (used for every check above)
```

Cause by reading: `apps/api/tsconfig.json` maps `@footballos/media` to `packages/media/dist/index.d.ts`
so that `tsc` can compile; `tsx` honours the same `paths` at run time and loads the `.d.ts`, whose
re-exports use `.ts` specifiers (`export * from './types.ts'`) that do not exist under `dist/`.
The README's "Run the chain locally end to end" and "Two ways to run it" recipes do not work as
written. Filed as D-3.

## Defects (not fixed; filed per owner)

| ID | Severity | Owner | Defect | Repro |
| --- | --- | --- | --- | --- |
| D-1 | **High** | B (`apps/api/src/routes/media.ts` stream route; `services/media.ts` createUpload) | A **rejected** upload is still served through a grant, with the **client-supplied `mimeType`** as `Content-Type`. HTML bytes uploaded as `page.mp4` with `mimeType: text/html` are rejected by `validate`, yet `GET /media/:id/stream?token=` answers `200 text/html` and the browser would execute the script on the API origin (`nosniff` does not stop an explicit `text/html`; no CSP). Any active member can obtain a grant for any team asset, so a position coach can plant a page that runs with the head coach's session (same origin → `fetch('/api/v1/…')` carries the cookie). | `security` scenario: upload HTML as `.mp4` with `mimeType: 'text/html'`, complete, wait for `rejected`, `GET /assets/:id/grant`, `GET streamUrl` → `200 text/html`. Suggested: `404` unless `status ∈ {validated, processing, ready}`; derive the content type from the probe (or a fixed `video/*`/`application/octet-stream`) instead of the client's `mimeType`; add `Content-Disposition: attachment` for originals and a restrictive CSP on `/media/*`. |
| D-2 | Medium | B (`apps/api/src/jobs/worker.ts` `startWorker`; C's `JobRunner` already exposes `recover()` and its doc comment says "call at startup and periodically") | Expired leases are recovered **only at worker start**. After a crash and a restart that happens before the lease expires (default 300 s; any supervisor restarts in seconds), the orphaned job stays `running` under the dead worker id forever (`claim()` only selects `queued`/`retry_wait`), its dependents never run and the asset stays `processing`. Verified with a 90 s lease: still `running` 170 s after the restart; a further restart recovered it. | `restart-probe` scenario (§3b). Suggested: call `runner.recover()` on the maintenance tick (or every `JOB_LEASE_SECONDS`), or let `claim()` also take `running` rows whose `lease_expires_at < now`. |
| D-3 | Medium | B (`apps/api/package.json` scripts / `tsconfig.json` paths) | The documented `tsx` entry points fail in a fresh worktree: `npm run seed:demo -w apps/api` → `ERR_MODULE_NOT_FOUND …/packages/media/dist/types.ts imported from packages/media/dist/index.d.ts` (tsx follows the `paths` alias to the `.d.ts`, whose specifiers are `.ts`). `npm run dev -w apps/api` and `npm run worker -w apps/api` fail identically (§12); `npm run migrate` works. The built entry points (`node dist/scripts/seed-demo.js`, `node dist/server.js`) work. | `npm install && npm run build -w apps/api && FOOTBALLOS_ENV=demo FOOTBALLOS_DATA_DIR=$PWD/.data/x npm run seed:demo -w apps/api`. |
| D-4 | Low | B (`worker.ts` infer handler) + D (`infer-labels.ts` no-key message) | With `MODEL_PROVIDER=anthropic` and no key the job error is `provider_unavailable` / "No model provider is configured" (the adapter's `reason: 'no_api_key'` is dropped and the message is the `none` sentence); with the default `MONTHLY_COST_CAP_USD=0` the budget check fires first and the error is `budget_exceeded` "$0 reached cap $0". Both hide the actual cause (missing key / cap left at 0). | §5b. Suggested: check the key before the cap; keep `reason` in the message (`no_api_key: ANTHROPIC_API_KEY is not set`). |
| D-5 | Low | B (`services/labels.ts` `correctLabel`) — or a contract decision | `PATCH /labels/:id` with an `accepted` block identical to the current one still bumps `version` and writes a `LabelRevision` (2 → 3 in §6). The brief expects `version` to increment only on real changes; §14.5 says every PATCH "writes a LabelRevision". Decide and document; a no-op PATCH could return the current label unchanged. | §6 `corrections --phase before`. |
| D-6 | Low (docs) | B / lead (`CONTRACTS.md` §14.9) | §14.9 says dependents of a failed **or canceled** job become `failed` with `upstream_failed`; the store cascades the parent's state, so dependents of a canceled job are `canceled` (with `error.code = upstream_failed`). The UI should not rely on `failed`. | §4 output. |
| D-7 | Low | B (`services/storage.ts` `extensionOf`, `CreateUploadRequestSchema`) | A bare-extension filename `.mp4` (no stem) and a filename containing a NUL byte are accepted (`201`). Storage keys are id-based so nothing is unsafe on disk, but `originalFilename` is echoed to clients and will be shown in the UI. Reject empty stems and control characters at the contract. | §10. |

## Observations (no defect filed)

- **O-1** The brief's check 9 says "set `retentionDays` to 0"; the contract (`PatchTeamSettingsRequestSchema`) allows `1..3650 | null`, so `0` is a `400`. I used `1` plus an aged asset. If "0 = delete immediately" is wanted, the contract needs changing; otherwise the brief does.
- **O-2** Without `SESSION_SECRET` the API falls back to the published development secret in `demo`; a grant (or session id) forged with it is accepted (`200`). Production refuses to start without a secret, so this is by design, but the deploy checklist must make sure `demo`/`research` installations on a LAN set one too.
- **O-3** No route re-runs a succeeded `segment`/`proxy`/`thumbnails` job (`retry` is for failed/canceled only; a second `complete` returns the existing chain). "Re-run segmentation after corrections" therefore cannot be triggered by a coach today; B3's film page will need a route (e.g. `POST /assets/:id/reprocess`) before that story can be demonstrated.
- **O-4** `POST /assets/:id/infer` on an asset whose segments were all `rejected` answers `400 "No segments to label"`; on a `rejected` asset `409`. Both are truthful.
- **O-5** `GET /teams/:id/usage` counts `jobsFailed` across all kinds (my failed `infer_labels` jobs showed up); fine, but the UI should not present it as "model failures".
- **O-6** Placeholder assets in `uploading` from abandoned creates (`x.mp4` in the cross-team sweep, the `.mp4` and NUL-byte probes) stay listed in `GET /games/:id/assets` until the 24 h GC; the film page should hide or label them.
- **O-7** The seed script needs `PASSWORD_SCRYPT_LOG2N` to match the server's (I used 14 for both); the default 17 works too but costs ~1 s per sign-in on this machine.

## Not run / out of scope

- Film UI (B3) accessibility and browser flows: not integrated at the time of this run; to be assigned separately.
- Real inference (`inferred` labels, `applyInference` on live data, bulk-accept of inferred labels, provenance rows, cost accounting): no API key by owner decision (X2); covered by ai unit tests only.
- Replacement of untouched proposals on a segment re-run with multi-play footage (fixture limitation, §6).
- Multi-worker contention (`npm run worker` as a second process); only the inline worker was exercised (the standalone worker entry is a `tsx` script, see D-3).
- `UPLOAD_TTL_HOURS` expiry GC: not exercised (24 h); code read only.

## Appendix A — state of the QA data directory at the end

Team 071a494b (Winchester Hawks demo): assets play-1, play-3, play-4, play-5, play-6 `ready`;
play-2 `deleted` by retention (files removed, segments kept); one HTML upload `rejected`; three
`uploading` placeholders awaiting GC. Team faade362 (QA Second Team): one asset from the probe.
Scratch logs: `api-run1.log` … `api-run13.log`, `run-*.log`, `b6-state.json`, `b6-state-probe.json`
(not committed; the state files hold ids only).
