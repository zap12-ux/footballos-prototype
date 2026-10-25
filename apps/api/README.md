# @footballos/api

FootballOS HTTP API: Hono 4 on `@hono/node-server`, SQLite (`better-sqlite3`) with Drizzle ORM,
invite-only authentication with TOTP MFA, team scoping, schedule services, an append-only audit
log, resumable film uploads with private storage, a SQLite-backed job worker that hosts the
`@footballos/media` (validate, proxy, thumbnails, segment, extract_document) and `@footballos/ai`
(`infer_labels`) handlers (Milestone B, CONTRACTS §14), and the coaching workflow of Milestone C
(CONTRACTS §15): playbook intake and review, personnel, grounded recommendations, unit game plans
with approval, sharing and exports. Contracts (zod schemas and types) live in `@footballos/contracts`; this package
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
scripts): the API resolves contracts and ai through their `dist/` output and the media package
through its `exports` entry (`types` → `dist/index.d.ts`, `import` → `src/index.ts`, added in
Milestone C), so the former `tsconfig.json` `paths` workaround is gone; `tsconfig.tsx.json` only
extends the base config now. Tests alias all three packages to source (`vitest.config.ts`).

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

The worker also runs a maintenance tick at start and every `WORKER_MAINTENANCE_SEC` seconds
(default 60): expired job leases are recovered first (`JobRunner.recover()`: a job orphaned by a
worker that died goes back to `queued`, or ends `failed` when no attempts remain / `canceled` when a
cancel was pending), then expired incomplete uploads (`UPLOAD_TTL_HOURS`) are removed with their
partial files (audit `upload.expired`), and when a head coach has set `retentionDays` in team
settings, originals and proxies past it are deleted (audit `retention.applied`). Independently of the
tick, `claim()` also takes a `running` row whose lease has expired (no cancel pending, attempts
remaining), so a crash followed by an immediate supervisor restart no longer leaves the chain stuck
until a further restart (CONTRACTS §14.10, QA B6 D-2). The retention default is **null: keep
originals and proxies until the head coach deletes them** (owner decision 2026-10-25).

`infer_labels` fails truthfully without doing work, checking in this order (§14.10, QA B6 D-4):
`MODEL_PROVIDER=none` → `error.code 'provider_unavailable'`, message "No model provider is
configured"; a provider whose key is missing → `provider_unavailable`, message
`no_api_key: MODEL_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set; manual labeling remains
available`; then a reached `MONTHLY_COST_CAP_USD` (month-to-date sum of `model_provenance.costUsd`,
also served by `GET /teams/:teamId/usage`) → `budget_exceeded`. All three are `retryable: false` and
happen before any frame is extracted or any request is made; adapter failures keep the adapter's
`reason` in the message. Manual labeling stays available: every segment has one `labels` row per
`LabelKey` (`accepted.status: 'unknown'`) from the moment it exists.

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

## Coaching workflow (Milestone C, CONTRACTS §15)

Schema `0003_coaching` adds `playbook_documents`, `playbook_pages`, `playbook_versions`, `concepts`,
`terms`, `players` (with `availability` json), `roster_imports`, `depth_charts`, `personnel_packages`,
`recommendations`, `game_plans`, `plan_versions`, `plan_comments`, `share_links`, and rebuilds
`media_assets` with a nullable `game_id` (documents are team-level; film stays game-bound). The
rebuild is why `openDatabase()` now runs migrations with `PRAGMA foreign_keys=OFF` (a no-op inside
drizzle's migration transaction otherwise) and refuses to start when `PRAGMA foreign_key_check`
reports violations afterwards. Rehearsed on a copy of the integration database: row counts
unchanged, no violations.

### Playbook (§15.1)
- `POST /teams/:teamId/playbook/documents { filename, byteSize, mimeType, sha256?, unit, title? }`
  → `201 { document, upload, asset }`; then the usual `PUT /uploads/:id` chunks and
  `POST /uploads/:id/complete`, which enqueues one `extract_document` job (idempotent per sha256 +
  `DOCUMENT_RENDER_DPI` + `DOCUMENT_OCR` + prompt version). `POST /games/:gameId/uploads` also
  accepts `kind:'document'` with `unit` (game-bound document). Accepted types:
  `ALLOWED_DOCUMENT_TYPES` (default `pdf,txt,md`; `docx` works through `mammoth` when added), size
  cap `MAX_DOCUMENT_BYTES` (default 100 MB). Uploaders: any staff who can upload film.
- The worker runs `createDocumentHandlers` (`@footballos/media`: pdfjs render + text layer, offline
  tesseract OCR when its data package is installed) and then `proposeFromPages` (`@footballos/ai`:
  text heuristics; a page image goes to a model **only** when `MODEL_PROVIDER=anthropic` with a key
  and under the monthly cap). Results are persisted in the job's transaction: `playbook_pages`
  (`imageKey`, `ocrText`, `textSource: pdf_text|ocr|none`, `ocrConfidence`, size), `ModelProvenance`
  rows for any model call, and every proposal as a **`proposed`** concept or term (`basis`, `note`,
  `sources: [{ documentId, pageNumber, bbox: null, excerpt }]`) in the unit's newest draft playbook
  version (created as "Draft from <title>" when none exists). The document ends `review` (proposals
  to look at), `extracted` (nothing proposable: e.g. scanned pages without OCR, which the
  `extraction` summary says plainly) or `failed` (unreadable / encrypted PDF, reason in
  `extraction.note`). Nothing is approved by the extractor.
- `GET /teams/:teamId/playbook/documents?unit=`, `GET /playbook/documents/:id` → `{ document, pages }`,
  `GET /playbook/documents/:id/grant` → `{ pageUrlTemplate, expiresAt }` (HMAC grant bound to team +
  asset, `MEDIA_GRANT_TTL_MIN`) and `GET /playbook/pages/:pageId/image?token=` (PNG, `nosniff`,
  restrictive CSP, no session), `DELETE /playbook/documents/:id` (head coach; file and pages removed,
  asset record kept as `deleted`, concepts keep their source refs; audit `playbook.document_deleted`).
- Versions: `GET/POST /teams/:teamId/playbook/versions?unit=&seasonId=`, `GET /playbook/versions/:id`,
  `GET /playbook/versions/:id/concepts|terms?status=`, `POST /playbook/versions/:id/concepts|terms`
  (coach-created: `approved`, `sources: []`, `basis: 'none'`), `PATCH /concepts/:id` and
  `PATCH /terms/:id` (`expectedVersion`; `status`, `name`, `kind`, `description`, `installed`, `note`;
  a rejected concept is never installed; only drafts change: `409 reason:'not_draft'`),
  `POST /playbook/versions/:id/approve` → `{ version, superseded }` (the previous approved version of
  the unit and season becomes `superseded`; audit `playbook.approved` with `override` when the head
  coach did it). Who: coordinator of the unit or head coach (`policy.canApproveExtraction`).

### Personnel (§15.2)
- `GET/POST /teams/:teamId/seasons/:seasonId/players?status=` (default hides `inactive`; `all`),
  `GET/PATCH /players/:id` (`expectedVersion`; `availability: [{ week, status: available|limited|out, note }]`
  replaces the list), `DELETE /players/:id` (head coach; soft: `inactive`).
- Roster import shares the CSV parser and the preview/apply shape with schedule imports:
  `POST /teams/:teamId/seasons/:seasonId/roster-imports { filename, content, mapping? }` auto-maps
  headers (jersey/number/#, first, last or a single name column "Last, First", positions, class,
  status, notes), validates per row (`errors[]`) and marks rows that match an existing player on
  jersey + last name (`matchesPlayerId`); `POST /roster-imports/:id/apply { skipInvalidRows }` →
  `{ createdPlayerIds, updatedPlayerIds, skippedRows }` (`409` with errors unless skipping);
  `GET /roster-imports/:id`, `POST /roster-imports/:id/discard`.
- `GET/PUT /teams/:teamId/seasons/:seasonId/depth-chart?unit=` (`PUT { slots, expectedVersion? }`:
  omit the version on the first write, afterwards a mismatch is `409` with `currentVersion` and the
  current chart), `GET/POST …/packages?unit=&week=` (the list carries `availability[]`: a package with
  a player `out` for `week`, `unavailable` or off the roster is flagged with the reason),
  `PATCH /packages/:id`. Edits: head coach and coordinators; everyone views. Audit:
  `roster.edited`, `roster_import.applied`, `player.deleted`, `depth_chart.updated`, `package.changed`.

### Recommendations (§15.3)
- `POST /games/:gameId/recommendations/generate { unit }` (coordinator of the unit / head coach) →
  `201 { items, blockedReasons, inputsHash, supersededIds, skipped, packages }` from
  `buildRecommendations` over the reviewed-only scouting report of the opponent's counterpart unit
  (a defense plan uses the opponent-offense report), the approved playbook version of the game's
  season (installed concepts only) and current personnel for the game week. With no approved
  playbook, no personnel or no findings the result is `[]` plus plain `blockedReasons`. Each stored
  row keeps `inputsHash` and the component hashes. Re-generating supersedes undecided (`proposed`)
  rows (`rejected`, `staleReason:'regenerated'`) and leaves decided ones. Audit
  `recommendation.generated`.
- `GET /games/:gameId/recommendations?unit=`, `GET /recommendations/:id`: `status` is reported as
  `stale` with a `staleReason` naming what changed (film labels, approved playbook, personnel or
  availability) when the stored `inputsHash` no longer matches the current inputs; the stored
  decision is in `storedStatus` and is never rewritten by a read.
- `POST /recommendations/:id/decide { decision: accept|edit|reject|defer, editedStatement?, note?, expectedVersion? }`
  → `{ recommendation, planVersionId, planItemId }`. `accept`/`edit` append a `PlanItem` with
  `sourceRecommendationId` to the unit's current **draft** plan version (created from the template or
  from the approved version when none is open; `409` while a version is `in_review`), in the section
  matching the first grounded concept's kind. Audit `recommendation.decided`.

### Unit game plans, approval, sharing, export (§15.4)
- `GET /games/:gameId/plans/:unit` → `{ plan, versions, current, reviewFlags }`; first access creates
  the plan with draft version 1 from the §11 template. `current` is the open draft / in_review
  version, else the approved one. `reviewFlags` are computed on read for the approved and open
  versions by `planReviewFlags` against the hashes recorded when the version was created or
  approved (`baselineHashes`) and the recommendations behind its items; never stored.
- `PATCH /plan-versions/:id { sections, expectedVersion }` (head coach, or coordinator /
  position coach assigned to the unit) → `{ version }`; mismatch → `409` with `currentVersion` and
  the **server copy** (`details.current`) for merging; non-draft → `409 reason:'not_draft'`; section
  keys must belong to the unit's template.
- `POST /plan-versions/:id/draft` (new draft `basedOn` an approved version; `409 reason:'draft_exists'`
  when one is open), `POST /plan-versions/:id/submit` → `in_review`, `POST /plan-versions/:id/approve
  { note? }` (coordinator of the unit; head coach → `override: true`, audit `plan.override_approved`;
  the previous approved version becomes `superseded`), `POST /plan-versions/:id/reopen` (in_review →
  draft; coordinator / head coach). Approved versions are immutable.
- Comments: `GET/POST /plan-versions/:id/comments { sectionKey?, itemId?, body }` (any member; the
  anchors must exist in that version), `POST /plan-comments/:id/resolve`.
- Sharing: `POST /plan-versions/:id/share { expiresInHours ≤ 72 }` (any member; **approved** versions
  only) → `201 { link, url, token }`: the token (32 random bytes, base64url) is shown **once**; only its
  sha256 is stored. Default and maximum lifetime 72 h (owner decision 2026-10-25, D-013); longer
  requests are `400`. `GET /shared/:token` (no session) → `{ version, team, game, unit, expiresAt }`
  for approved versions; `410 gone` (`details.reason: expired|revoked`) afterwards; unknown tokens
  `404`. `DELETE /share-links/:id` (creator or head coach), `GET /plan-versions/:id/share-links`,
  `GET /teams/:teamId/share-links` (head coach). Audit `plan.shared`, `plan.share_revoked`. The URL
  uses `PUBLIC_ORIGIN` + `/shared/<token>` (the web app's read-only route).
- Export: `GET /plan-versions/:id/export.html` (self-contained HTML with a print stylesheet, no
  scripts, no external fonts) and `GET /plan-versions/:id/export.pdf` (`pdf-lib`, Helvetica, title
  block with team, opponent, week, unit, version, status, approved by/at; one section per template
  key; footer "Generated by FootballOS <date> · version n"). Both accept a session (any member) or
  `?token=` of a share link **for that approved version**; a share token never reaches a draft.

Roles on these routes follow CONTRACTS §3 (`src/http/guards.ts` `policy`): every member views and
comments; staff who upload film also upload documents; head coach and coordinators edit personnel;
coordinator of the unit or head coach approves extraction, creates playbook versions, generates and
decides recommendations and reopens plans; plan drafts are edited by the head coach and by
coordinators / position coaches assigned to the unit; approval is by the unit's coordinator or the
head coach (recorded as an override). Every record-keyed route resolves the team first and answers
`404` across teams.

Environment added in Milestone C (`.env.example`): `MAX_DOCUMENT_BYTES`, `ALLOWED_DOCUMENT_TYPES`,
`DOCUMENT_RENDER_DPI`, `DOCUMENT_OCR`. Dependency added: `pdf-lib` 1.17.1 (MIT) for PDF export (and
for generating test PDFs).

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
| playbook (§15.1) | see "Coaching workflow" above |
| personnel (§15.2) | see "Coaching workflow" above |
| recommendations (§15.3) | see "Coaching workflow" above |
| plans / sharing / export (§15.4) | see "Coaching workflow" above |

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

## Behaviour fixed after QA B6 (CONTRACTS §14.10)

- **Media delivery (D-1).** `GET /media/:assetId/stream` and `/thumb/:n` serve only assets whose
  status is `validated`, `processing` or `ready`; `uploading`, `uploaded`, `rejected`, `failed` and
  `deleted` answer `404`. The `Content-Type` is chosen by the server: the proxy is `video/mp4`, an
  original is typed from the validate probe's container (`media_assets.container`, migration
  `0002_asset_container`: mp4 → `video/mp4`, mov → `video/quicktime`, mkv → `video/x-matroska`, …),
  tiles are `image/jpeg`; the client-supplied `mimeType` is stored on the record but never used on
  the wire. Every byte response carries `Content-Disposition: inline; filename="<assetId>.<ext>"`,
  `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'` and
  `Cache-Control: private, no-store`.
- **Lease recovery (D-2).** See "Worker and the film processing chain" above
  (`WORKER_MAINTENANCE_SEC`, `claim()` of expired `running` rows).
- **tsx entry points (D-3).** `dev`, `worker`, `migrate`, `seed:demo`, `bootstrap` run with
  `--tsconfig tsconfig.tsx.json` (see "Run").
- **Provider failures (D-4).** Provider check before the cost cap; the no-key message names
  `no_api_key` and the environment variable (see above).
- **No-op corrections (D-5).** `PATCH /labels/:id` whose `accepted` value and status equal the
  current ones changes nothing: no version bump, no `LabelRevision`, response
  `200 { label, changed: false }` (`PatchLabelResponse`); a real change answers `changed: true`.
  The `expectedVersion` check still applies first.
- **Filenames (D-7).** `originalFilename` is sanitized on intake (`sanitizeFilename` in
  `@footballos/contracts`): control characters are removed, the name is trimmed, must be 1–255
  characters and must have a stem before the extension (`.mp4` is rejected); a NUL byte is a
  `400 validation_error`. Storage keys never use the filename.

## Data directory layout

```
$FOOTBALLOS_DATA_DIR/
  footballos.sqlite                          # database (WAL mode; -wal and -shm files appear while running)
  media/<teamId>/<assetId>/original.<ext>    # uploaded bytes, moved here at completion
  media/<teamId>/<assetId>/proxy.mp4         # playback proxy (job `proxy`)
  media/<teamId>/<assetId>/thumbs.jpg        # thumbnail sheet, thumbs.jpg.json sidecar, thumbs.jpg.frames/ tiles
  media/<teamId>/<assetId>/segments.json     # last segment proposal, for inspection
  media/<teamId>/<assetId>/pages/page-<n>.png  # rendered playbook pages (job `extract_document`), pages.json sidecar
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
src/services/grants.ts   HMAC media grants (also used for playbook page images)
src/libs/index.ts        the §15.5 library functions the API hosts (media extractDocument handlers, ai proposals/recommendations/flags)
src/services/playbook.ts documents, extraction persistence, versions, concepts, terms
src/services/personnel.ts players, roster import (roster-import.ts), depth chart, packages, availability
src/services/recommendations.ts inputs, generation, stale computation, decisions
src/services/plans.ts    plans, versions, transitions, comments, review flags; share.ts share links; plan-export.ts HTML/PDF
```

Environment variables added in Milestone B (see `.env.example`): `UPLOAD_TTL_HOURS`,
`MEDIA_GRANT_TTL_MIN`, `WORKER_INLINE`, `WORKER_POLL_MS`, `WORKER_MAINTENANCE_SEC`, `PROXY_HEIGHT`, `THUMBNAIL_EVERY_SEC`,
`FOOTBALLOS_AI_MODEL` / `FOOTBALLOS_AI_EFFORT` / `FOOTBALLOS_AI_MAX_OUTPUT_TOKENS` /
`FOOTBALLOS_AI_JOB_BUDGET_USD` / `FOOTBALLOS_AI_MAX_FRAMES_PER_SEGMENT` /
`FOOTBALLOS_AI_MAX_SEGMENTS_PER_JOB` / `FOOTBALLOS_AI_REQUEST_TIMEOUT_MS` (read through
`@footballos/ai` `loadAiConfig`, replacing the former `MODEL_ID` and `MAX_FRAMES_PER_SEGMENT`),
`FOOTBALLOS_FFMPEG` / `FOOTBALLOS_FFPROBE` (host binaries instead of the bundled static builds).
