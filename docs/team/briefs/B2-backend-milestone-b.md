# Brief B2 — Backend / Team Platform Engineer, Milestone B (tasks B1, B2, B4-api, B5-api)

Read `COMMON.md` first, then `docs/team/CONTRACTS.md` **§14 in full** (authoritative), §5–§7,
§13, and `apps/api/README.md`. Worktree: `/Users/zachariahparkhill/Projects/FootballOS/.worktrees/b2-backend`,
branch `wt/b2-backend` (from `integration`). Allowed paths: `apps/api/**`, `packages/contracts/**`
(you own migrations and contracts). Ports/data: API 8789, worker in the same process for dev
(`WORKER_INLINE=true`), `FOOTBALLOS_DATA_DIR=.data/wt-b2` (absolute path when you export it).

## Already in integration (reuse, do not rewrite)
`apps/api` with auth, guards (`requireAuth`, `requireMembership`, `policy.*`), schedule services,
Drizzle schema + migration `0000_init`; `@footballos/contracts`; `packages/media` with `probe`,
`validate`, `makeProxy`, `makeThumbnailSheet`, `proposeSegments`, `split/merge`, `assessQuality`,
`jobs/` (`JobRunner`, `JobStore` interface, in-memory store); `packages/ai` with labelers, stats,
`JobBudget`. C and D are adding `createMediaHandlers`, `extractFrames` and
`createInferLabelsHandler`/`applyInference` in parallel (CONTRACTS §14.8); until their branches
land, code against those signatures with a local stub behind an interface and switch in the
handoff notes.

## Deliverables (in this order; commit a WIP after each)
1. Schema + migration `0001_media_labels`: `media_assets`, `uploads`, `processing_jobs` (with
   `input`, `result`, `not_before_at`, `cancel_requested_at`, `lease_expires_at`, `worker_id`,
   `idempotency_key` unique), `play_segments`, `labels`, `label_revisions`, `model_provenance`,
   `report_snapshots`, `team_settings`. Contracts additions for request/response shapes in §14.
2. Private storage layout under `FOOTBALLOS_DATA_DIR/media/<teamId>/<assetId>/{original.<ext>,
   proxy.mp4, thumbs/…}`; partial uploads under `uploads/<uploadId>.part`; never world-readable.
3. §14.1 uploads (resumable ranges, contiguity 409, sha256 verify, dedupe 409 with
   `existingAssetId`, limits, TTL garbage collection on worker tick), §14.3 grants and streaming
   with `Range`, §14.4 segments, §14.5 labels/corrections/revisions/bulk-accept/provenance, §14.6
   scouting computed via `@footballos/ai` stats, §14.7 settings. All team-scoped (cross-team 404),
   authorization per §3 (`policy.canUploadOrCorrect`), audit rows for delete/retention/bulk-accept.
4. `SqliteJobStore` implementing `packages/media` `JobStore`; `src/worker.ts` + `npm run worker`;
   `WORKER_INLINE=true` for dev; handler registration per §14.2; results persisted transactionally;
   cost accounting: `GET /teams/:teamId/usage` now sums `model_provenance.costUsd` by month and
   reports `monthlyCapUsd` from env; `infer_labels` jobs refuse to start when the cap is reached
   (`budget_exceeded`, retryable false).
5. Provider wiring: `MODEL_PROVIDER` + `createVisionLabeler` from `@footballos/ai`; with `none`
   the job fails truthfully (§14.5). Pass the API config into `loadAiConfig` so provenance records
   the model actually called; remove the duplicate `MODEL_ID`/`MAX_FRAMES_PER_SEGMENT` readers
   (F's finding) and list `FOOTBALLOS_AI_*` and `FOOTBALLOS_FFMPEG/FFPROBE` in `apps/api/.env.example`.
6. Tests (vitest, temp data dir): upload happy path with the six fixture clips, out-of-order
   chunk 409, resume via GET, duplicate sha256 409, complete enqueues the chain, worker runs the
   chain end to end on `apps/web/public/demo-film/play-1.mp4` (proxy, thumbs, segments stored),
   cancel mid-job, retry after failure, restart recovery (expired lease re-claimed), grant/stream
   with Range and expired token 401, split/merge, label correction + revision + bulk-accept
   skipping corrected, infer with `MODEL_PROVIDER=none` → failed job with provider_unavailable,
   scouting denominators from stored labels (reviewed_only vs includes_inferred), cross-team 404
   on every new route, settings 409. `npm run typecheck`, `npm test -w apps/api -w packages/contracts`.
7. README updates: worker, storage layout, retention, env vars, how to run the chain locally.

## Acceptance (board B1/B2 and API side of B4/B5)
A real file uploaded in chunks produces an asset with proxy, thumbnails and proposed segments;
labels can be corrected and the correction survives a re-run of `infer_labels`; counts and
denominators come from stored records; every failure path is truthful; tests pass on your branch.

## Owner question you may ask (non-blocking)
Retention default for original uploads (recommend: keep originals indefinitely until the head
coach deletes; proxies kept with them). Nothing else: stack, routes and limits are decided.
