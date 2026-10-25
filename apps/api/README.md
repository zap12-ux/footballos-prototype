# @footballos/api

FootballOS HTTP API: Hono 4 on `@hono/node-server`, SQLite (`better-sqlite3`) with Drizzle ORM,
invite-only authentication with TOTP MFA, team scoping, schedule services, an append-only audit
log, resumable film uploads with private storage, and a SQLite-backed job worker that hosts the
`@footballos/media` (validate, proxy, thumbnails, segment) and `@footballos/ai` (`infer_labels`)
handlers (Milestone B, CONTRACTS §14). Contracts (zod schemas and types) live in `@footballos/contracts`; this package
exports `type AppType` from `src/app.ts` so `apps/web` can build a `hono/client` client
type-only.

## Run

```sh
npm install                      # at the repository root
cp apps/api/.env.example apps/api/.env   # development defaults; edit FOOTBALLOS_DATA_DIR, PORT
npm run dev -w apps/api          # tsx watch; builds @footballos/contracts first
# or
npm run build -w apps/api && npm run start -w apps/api
curl http://127.0.0.1:8787/healthz
```

Per-worker ports and data directories are in `docs/team/WORKFLOW.md` (B: `PORT=8789`,
`FOOTBALLOS_DATA_DIR=.data/wt-b`). Environment variables are validated at start
(`src/config.ts`); in `FOOTBALLOS_ENV=production` or `NODE_ENV=production` a missing
`SESSION_SECRET` (>= 32 characters) is fatal. `FOOTBALLOS_ENV` accepts
`development | demo | research | production`.

Every `npm run <dev|build|typecheck|test|migrate|seed:demo|bootstrap|worker>` in this workspace
first builds `packages/contracts`, `packages/media` and `packages/ai` (`deps:build` through `pre*`
scripts): the API resolves contracts and ai through their `dist/` output and takes the media
package's types from `packages/media/dist/index.d.ts` (`tsconfig.json` `paths`), because its
source uses `.ts` import specifiers that Node runs natively but `tsc` cannot compile from another
project. Tests alias all three packages to source instead (`vitest.config.ts`).

## Worker and the film processing chain

Completing an upload enqueues `validate → proxy → thumbnails → segment` (one job each, idempotent
by `sha256(kind + assetId + configVersion)`, chained through `processing_jobs.depends_on_job_id`).
`POST /assets/:id/infer` enqueues `infer_labels` jobs (at most `FOOTBALLOS_AI_MAX_SEGMENTS_PER_JOB`
segments each). Jobs are run by the `JobRunner` from `@footballos/media` over `SqliteJobStore`
(`src/jobs/sqlite-store.ts`): leases (`JOB_LEASE_SECONDS`), heartbeats, bounded retries with
backoff (`JOB_MAX_ATTEMPTS`), cooperative cancel (`POST /jobs/:id/cancel` aborts the handler's
signal; ffmpeg children are killed), `POST /jobs/:id/retry` from `failed`/`canceled` (attempt
counter reset, same key, dependents that failed with `upstream_failed` re-queued), and restart
recovery (`recoverExpiredLeases()` at worker start: an expired lease goes back to `queued`, or to
`failed` when no attempts remain). Results are persisted in the same SQLite transaction that marks
the job succeeded (`src/jobs/worker.ts` `persistResult`): `validate` → asset `validated` (probe
facts, quality) or `rejected` (reasons; dependents fail with `upstream_failed`), `proxy` →
`proxyStorageKey`, `thumbnails` → `thumbnailSheetKey`, `segment` → `play_segments` rows (machine
proposals a coach has not touched are replaced on a re-run) and asset `ready`, `infer_labels` →
`model_provenance` rows plus `labels` upserts through `applyInference` (coach `accepted` /
`corrected` / `rejected` values are never overwritten).

Two ways to run it:

```sh
WORKER_INLINE=true npm run dev -w apps/api     # worker loop inside the API process (development)
npm run worker -w apps/api                     # separate process on the same FOOTBALLOS_DATA_DIR
```

The worker also runs a maintenance tick at start and every 5 minutes: expired incomplete uploads
(`UPLOAD_TTL_HOURS`) are removed with their partial files (audit `upload.expired`), and when a head
coach has set `retentionDays` in team settings, originals and proxies past it are deleted (audit
`retention.applied`). The default is **null: keep originals and proxies until the head coach
deletes them** (owner decision 2026-10-25).

`infer_labels` fails truthfully without doing work: `MODEL_PROVIDER=none` → `error.code
'provider_unavailable'`, message "No model provider is configured", `retryable: false`; a reached
`MONTHLY_COST_CAP_USD` (month-to-date sum of `model_provenance.costUsd`, also served by
`GET /teams/:teamId/usage`) → `budget_exceeded`, `retryable: false`; a provider without a key →
`provider_unavailable` from the adapter. Manual labeling stays available: every segment has one
`labels` row per `LabelKey` (`accepted.status: 'unknown'`) from the moment it exists.

Run the chain locally end to end:

```sh
export FOOTBALLOS_DATA_DIR=$PWD/.data/wt-b PORT=8789 WORKER_INLINE=true
FOOTBALLOS_ENV=demo npm run seed:demo -w apps/api      # prints credentials once
npm run dev -w apps/api
# sign in, then:
#   POST /api/v1/games/:gameId/uploads  { filename, byteSize, mimeType, sha256?, context }
#   PUT  /api/v1/uploads/:id            Content-Range: bytes 0-16777215/<total>  (raw chunk, contiguous)
#   POST /api/v1/uploads/:id/complete   → { asset, jobs }   (chain is queued; watch GET /teams/:teamId/jobs)
#   GET  /api/v1/assets/:id/grant       → { streamUrl, thumbUrlTemplate, expiresAt }
# or run the same flow in-process: npm test -w apps/api -- media.test.ts (uses apps/web/public/demo-film/play-1.mp4)
```

## Migrate

Migrations are SQL files in `apps/api/drizzle/` generated by drizzle-kit from
`src/db/schema.ts` and applied automatically at every start (`openDatabase()`), so a fresh
`FOOTBALLOS_DATA_DIR` is initialised on first run. To apply them without starting the server:

```sh
npm run migrate -w apps/api
```

To change the schema: edit `src/db/schema.ts`, run `npm run db:generate -w apps/api`, review the
new `drizzle/NNNN_*.sql` and `drizzle/meta/*`, commit both. Never edit an applied migration.
Migration order is owned by B (DECISIONS.md D-006).

## Seed the demo team

```sh
FOOTBALLOS_ENV=demo FOOTBALLOS_DATA_DIR=.data/wt-b npm run seed:demo -w apps/api
```

Creates one `environmentKind: demo` team, the fictional "Winchester Hawks (demo)", with a
current season, eight fictional opponents, an eight-game schedule plus a bye, and six fictional
staff (head coach, offensive and defensive coordinators, two position coaches, one analyst).
Passwords are generated at seed time and printed once; the head coach and coordinators are
enrolled in MFA and their TOTP secret is printed once. Nothing is stored in plain text. The
script refuses to run when `FOOTBALLOS_ENV=production` and refuses to reseed an existing demo team.

## First-run setup for a real installation

Invite-only auth means the first head coach cannot be invited by anyone. Owner decision
(2026-10-25): an interactive CLI prompt, not environment variables.

```sh
npm run bootstrap -w apps/api
```

Prompts for team name, short name, level, environment kind, IANA time zone, head coach e-mail,
display name and password (not echoed, never accepted as an argument). The head coach then
signs in, enrolls MFA (required for `head_coach` and `coordinator`) and invites the staff.

## Test

```sh
npm run typecheck -w apps/api
npm test -w apps/api
```

Vitest suites in `src/test/` each create a temporary data directory and a fresh database
(migrations applied from empty), call the Hono app in-process and remove the directory
afterwards. `media.test.ts`, `jobs.test.ts` and `labels.test.ts` upload the fixture clips from
`apps/web/public/demo-film` in chunks and run the real ffmpeg chain on `play-1.mp4` through the
runner (`runWorkerUntilIdle`), so they need the bundled ffmpeg/ffprobe and take about a minute. Covered: sign-in success/failure, rate limiting, cookie tampering, idle (12 h) and
absolute (30 d) session expiry, the MFA gate (`401` with `details.mfaRequired`), MFA enrollment
with recovery codes, invite create/accept/expiry, account recovery, role denials (`403`),
cross-team `404`, version conflicts (`409 currentVersion`), game status transitions, season
record, schedule import preview with a bad row, apply with and without `skipInvalidRows`, and
audit rows for invites, staff changes, MFA enrollment, recovery and imports.

## Routes (prefix `/api/v1`, see `docs/team/CONTRACTS.md` §12)

| Area | Implemented |
| --- | --- |
| auth | `POST /auth/sign-in`, `POST /auth/sign-out`, `GET /auth/me`, `POST /auth/mfa/setup`, `POST /auth/mfa/verify`, `POST /auth/invites/:token/accept`, `POST /auth/recovery/request`, `POST /auth/recovery/complete` |
| team | `GET /teams`, `GET /teams/:teamId`, `GET /teams/:teamId/staff`, `PATCH /teams/:teamId/staff/:membershipId`, `GET/POST /teams/:teamId/invites`, `DELETE /teams/:teamId/invites/:inviteId`, `GET /teams/:teamId/audit` |
| schedule | `GET/POST /teams/:teamId/seasons`, `GET/POST /teams/:teamId/opponents`, `GET/POST /teams/:teamId/seasons/:seasonId/games` (list carries `record`), `GET/PATCH /games/:gameId`, `POST /teams/:teamId/schedule-imports` (CSV preview), `GET /schedule-imports/:id`, `POST /schedule-imports/:id/apply`, `POST /schedule-imports/:id/discard` |
| ops | `GET /healthz` (public), `GET /teams/:teamId/usage` (month-to-date `model_provenance` cost and tokens, job counts, `monthlyCostCapUsd` from env) |
| media (§14.1) | `POST /games/:gameId/uploads`, `PUT /uploads/:uploadId` (`Content-Range`, contiguous or `409 receivedBytes`), `GET /uploads/:uploadId`, `POST /uploads/:uploadId/complete` (sha256 verify `400`, duplicate `409 existingAssetId`, enqueues the chain), `GET /games/:gameId/assets`, `GET /assets/:assetId`, `DELETE /assets/:assetId` (head coach, audit) |
| delivery (§14.3) | `GET /assets/:assetId/grant` → HMAC grant (`MEDIA_GRANT_TTL_MIN`); `GET /media/:assetId/stream?token=` (proxy else original, HTTP `Range`, `416` on bad ranges), `GET /media/:assetId/thumb/:n?token=` (tile `n` via `thumbTileJpeg`); expired/foreign token `401` |
| jobs (§14.2) | `GET /teams/:teamId/jobs?assetId=&status=&limit=&cursor=`, `GET /jobs/:jobId`, `POST /jobs/:jobId/cancel`, `POST /jobs/:jobId/retry` |
| segments (§14.4) | `GET/POST /assets/:assetId/segments`, `POST /segments/:segmentId/split`, `POST /segments/merge`, `PATCH /segments/:segmentId` (versions `409`, overlaps `409`) |
| labels (§14.5) | `POST /assets/:assetId/infer` (`202 { jobs }`), `GET /segments/:segmentId/labels`, `GET /assets/:assetId/labels`, `PATCH /labels/:labelId` (correction + `LabelRevision`), `GET /labels/:labelId/revisions`, `POST /assets/:assetId/labels/bulk-accept` (`bulkAcceptPlan`, audit), `GET /assets/:assetId/provenance` |
| scouting (§14.6) | `GET /teams/:teamId/opponents/:opponentId/scouting?unit=&reviewBasis=&gameIds=` (computed by `buildScoutingReport`), `GET/POST …/scouting/snapshots` |
| settings (§14.7) | `GET/PATCH /teams/:teamId/settings` (head coach, `expectedVersion`) |

Authorization on the new routes follows §3: any active member reads; `head_coach`, `coordinator`,
`position_coach`, `analyst` upload, edit segments, correct labels, start inference and save
snapshots (`policy.canUploadOrCorrect`); only the head coach deletes film and changes settings.
Every record-keyed route resolves the record's team first and answers `404` for other teams.

Authentication: `fos_session` cookie (httpOnly, SameSite=Lax, `Secure` when
`COOKIE_SECURE=true`), HMAC-signed session id, idle timeout `SESSION_TTL_HOURS` (12),
absolute `SESSION_ABSOLUTE_DAYS` (30). Passwords: scrypt from `node:crypto`
(N=2^17, r=8, p=1; `PASSWORD_SCRYPT_LOG2N` lowers the cost for tests). MFA: TOTP via `otplib`
plus 10 hashed single-use recovery codes. A session that still owes TOTP, or a head coach /
coordinator who has not enrolled, receives `401 unauthorized` with `details.mfaRequired: true`
(and `mfaEnrollmentRequired: true`) on every route except `/auth/me`, `/auth/mfa/*`,
`/auth/sign-out`. Sign-in and MFA attempts are rate limited in memory per client IP + e-mail.

Account recovery has no mail provider yet: in `development` and `demo` environments the token
is written to the server log (field `unredacted_recovery_token`); in `research` and
`production` it is created but not delivered (logged as "token not delivered").

Authorization (`src/http/guards.ts`): `requireMembership()` turns a missing active membership
into `404` so other teams are never revealed; `policy.*` encodes the §3 table for every owner
(plans, playbook, uploads) even where the routes do not exist yet.

## Data directory layout

```
$FOOTBALLOS_DATA_DIR/
  footballos.sqlite                          # database (WAL mode; -wal and -shm files appear while running)
  media/<teamId>/<assetId>/original.<ext>    # uploaded bytes, moved here at completion
  media/<teamId>/<assetId>/proxy.mp4         # playback proxy (job `proxy`)
  media/<teamId>/<assetId>/thumbs.jpg        # thumbnail sheet, thumbs.jpg.json sidecar, thumbs.jpg.frames/ tiles
  media/<teamId>/<assetId>/segments.json     # last segment proposal, for inspection
  uploads/<uploadId>.part                    # partial uploads until completion or expiry (UPLOAD_TTL_HOURS)
  backups/                                   # local backup target (tools/ops)
```

Directories are created `0700` and files `0600`; nothing under the data directory is world-readable
and bytes are served only through signed grants. Storage keys in the database are paths relative to
the data directory. Deleting an asset (head coach, or retention) removes the whole asset directory
and keeps the record as `status: 'deleted'`; segments and labels stay for audit.

## Backup

SQLite runs in WAL mode. A consistent copy requires a checkpoint first or the online backup API;
`tools/ops` (task A8) provides `backup-sqlite` / `restore-sqlite` with integrity checks. Manual
equivalent while the server is stopped or idle:

```sh
sqlite3 "$FOOTBALLOS_DATA_DIR/footballos.sqlite" "PRAGMA wal_checkpoint(TRUNCATE);"
cp "$FOOTBALLOS_DATA_DIR/footballos.sqlite" "$FOOTBALLOS_DATA_DIR/backups/footballos-$(date -u +%Y%m%dT%H%M%SZ).sqlite"
```

Copying only the `.sqlite` file without a checkpoint loses writes still in the `-wal` file.

## Layout

```
src/app.ts               createApp(ctx) + AppType
src/server.ts            entry point (env file, config, migrations, listen, SIGTERM)
src/config.ts            env schema and AppConfig
src/db/schema.ts         Drizzle tables; drizzle/ holds generated SQL
src/auth/                scrypt, tokens, TOTP, sessions, rate limiter
src/http/                zod validator wrapper, auth guards and §3 policy
src/services/            audit, users, teams/invites, schedule, CSV import
src/routes/              auth, teams, schedule, ops
src/scripts/             migrate, seed-demo, bootstrap
src/jobs/                SqliteJobStore, enqueue helper, worker (handler registration, result persistence, maintenance)
src/worker.ts            standalone worker entry (`npm run worker`)
src/services/media.ts    uploads, completion, chain enqueue, delete, GC, retention
src/services/storage.ts  private storage layout and permissions
src/services/grants.ts   HMAC media grants
```

Environment variables added in Milestone B (see `.env.example`): `UPLOAD_TTL_HOURS`,
`MEDIA_GRANT_TTL_MIN`, `WORKER_INLINE`, `WORKER_POLL_MS`, `PROXY_HEIGHT`, `THUMBNAIL_EVERY_SEC`,
`FOOTBALLOS_AI_MODEL` / `FOOTBALLOS_AI_EFFORT` / `FOOTBALLOS_AI_MAX_OUTPUT_TOKENS` /
`FOOTBALLOS_AI_JOB_BUDGET_USD` / `FOOTBALLOS_AI_MAX_FRAMES_PER_SEGMENT` /
`FOOTBALLOS_AI_MAX_SEGMENTS_PER_JOB` / `FOOTBALLOS_AI_REQUEST_TIMEOUT_MS` (read through
`@footballos/ai` `loadAiConfig`, replacing the former `MODEL_ID` and `MAX_FRAMES_PER_SEGMENT`),
`FOOTBALLOS_FFMPEG` / `FOOTBALLOS_FFPROBE` (host binaries instead of the bundled static builds).
