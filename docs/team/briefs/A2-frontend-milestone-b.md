# Brief A2 — Product Designer / Frontend Engineer, Milestone B (task B3)

Read `COMMON.md` first, then `docs/team/CONTRACTS.md` **§14** (authoritative for every call you
make), §5–§7, and `apps/web/README.md` (your Milestone A shell is in `integration`). Worktree:
`/Users/zachariahparkhill/Projects/FootballOS/.worktrees/a2-frontend`, branch `wt/a2-frontend`.
Allowed paths: `apps/web/**`. Web dev port 5174; API proxy target `http://127.0.0.1:8789` (B's
dev API may not be running; everything must also work in `VITE_API_MODE=mock`).

## Deliverables (commit a WIP after each)
1. Typed client: `src/api/http.ts` becomes `hc<AppType>` from `hono/client` with
   `import type { AppType } from '@footballos/api'` (the package exports it); keep the
   error-envelope and pagination handling; keep the auth-state mapping (`mfaRequired` → shell's
   `mfaVerified`) that is already in `integration`. Replace `src/api/contracts.ts` with re-exports
   from `@footballos/contracts` (alias the package to its `src/index.ts` in `vite.config.ts` for
   dev/tests as `apps/api/vitest.config.ts` does). Extend `MockApi` with the §14 operations and
   demo data (assets with jobs in every state, 48 segments, labels with inferred/corrected mixes,
   provenance, a failed `provider_unavailable` job, scouting findings with `reviewBasis`).
2. **Our Team Film** page, real workflow: upload context form (§5 `context`), resumable chunked
   upload client (`PUT` ranges from the File via `slice`, `UPLOAD_CHUNK_BYTES` from settings or
   8 MiB, resume via `GET /uploads/:id` after reload using `localStorage` of in-flight uploads,
   sha256 computed in a Web Worker with `crypto.subtle` when the file is under 2 GB, otherwise
   skipped and said so), progress with cancel, duplicate (409) shown with a link to the existing
   asset; asset list with status and job progress (poll `GET /teams/:id/jobs?assetId=` every 3 s
   while any job is active; stop when idle); per-asset view: footage quality notes and
   `unevaluable` list verbatim, segment timeline with proposed/accepted/rejected states, split at
   playhead and merge adjacent (with `expectedVersion`, 409 shown as "changed elsewhere, reload"),
   video player on the proxy via `GET /assets/:id/grant` (re-fetch on expiry) seeking to
   `startSec`, thumbnail strip from `thumbUrlTemplate`.
3. **Label review** inside the asset view: table of segments × label keys showing inferred
   value, abstention, uncertainty word, accepted status, correction author/time; filters
   (status, key, abstained only); single-label correction with reason; bulk accept of
   *inferred, non-abstained* labels for a filtered set with a confirmation showing counts
   (§14.5 bulk-accept rule); revision history drawer; provenance panel (model, prompt hash,
   frames inspected with timestamps, cost) per segment; "Run inference" button → `POST
   /assets/:id/infer`, with the truthful failed state when the provider is not configured and
   manual labeling still available; never a fabricated label.
4. **Opponent Scouting** page on §14.6: opponent + unit + review-basis selectors; findings with
   numerator/denominator/percent/sample size, included games, excluded segments with reasons,
   evidence timestamps that open the asset view at that time; uncertain findings separate;
   "Save snapshot" → `POST …/snapshots`; snapshots list.
5. Settings page: wire `GET/PATCH /teams/:id/settings` (retention, limits) with `expectedVersion`.
6. Tests: upload client (chunking, resume, 409 handling, cancel) with a fake fetch; job polling
   start/stop; segment split/merge optimistic-conflict handling; bulk-accept rule; provenance
   rendering; scouting denominators and review-basis toggle; axe on film and scouting pages.
   Existing 98 tests keep passing. `npm run typecheck -w apps/web`, `npm test -w apps/web`,
   `npm run build -w apps/web`.
7. README: the film workflow, what is demo-only, keyboard interactions for the timeline.

## Acceptance (board B3)
With B's API running: upload a fixture clip in chunks, watch jobs complete, see segments and
thumbnails, correct a label, bulk accept, run inference and see the truthful provider state,
view tendencies with denominators. In mock mode the same screens work on demo data.

## Owner question you may ask (non-blocking)
Whether the segment timeline should default to showing proposed segments as already selected
for review (recommend yes). Nothing else.
