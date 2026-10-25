# Brief B3 — Backend / Team Platform Engineer, Milestone C (task C1)

Read `COMMON.md` first, then `docs/team/CONTRACTS.md` **§15 in full** (authoritative), §3, §8–§11,
§14.10, and `apps/api/README.md`. Worktree: `/Users/zachariahparkhill/Projects/FootballOS/.worktrees/b4-backend`,
branch `wt/b4-backend` (from `integration`). Allowed paths: `apps/api/**`, `packages/contracts/**`.
Ports/data: API 8789, `WORKER_INLINE=true`, `FOOTBALLOS_DATA_DIR=.data/wt-b4` (absolute when exported).

## Already in integration (reuse)
Milestone B API (uploads, jobs/worker, media grants, segments, labels, scouting, settings; QA B6
fixes from B7). `packages/media` and `packages/ai` are adding `extractDocument`/
`createDocumentHandlers` and `proposeFromPages`/`buildRecommendations`/`planReviewFlags`
in parallel (CONTRACTS §15.5); code against those signatures with local stubs until their
branches land (the lead will tell you), then host the real ones.

## Deliverables (commit a WIP after each)
1. Migration `0002_coaching`: `playbook_documents`, `playbook_pages`, `playbook_versions`,
   `concepts`, `terms`, `players` (with `availability` json), `depth_charts`,
   `personnel_packages`, `recommendations`, `game_plans`, `plan_versions`, `plan_comments`,
   `share_links`; contracts additions for every request/response in §15.
2. §15.1: document uploads (reuse §14.1 with `kind:'document'`), `extract_document` job hosted
   in the worker via `createDocumentHandlers`, page images served through grants, proposals
   persisted as `proposed` concepts/terms with sources; versions, approve/reject, installed,
   version approval with supersession; permissions and audit.
3. §15.2: players CRUD, roster CSV import preview/apply (share the CSV machinery with the
   schedule import), depth chart, packages, availability.
4. §15.3: generate (via `buildRecommendations`), list with stale computation, decide with
   draft `PlanItem` creation; audit.
5. §15.4: plans with template-based first draft, draft PATCH with server copy on 409, new
   draft from approved, submit/approve/override/reopen with audit, review flags via
   `planReviewFlags`, comments, share links (token shown once, hashed at rest, expiry,
   revoke, `GET /shared/:token` without session, approved versions only), `export.html` and
   `export.pdf` with `pdf-lib`.
6. Tests (vitest, temp data dir): document upload → extraction job (use a small text PDF you
   generate with `pdf-lib` in the test, plus a `.txt`) → pages and proposals → approve
   concept → approve version → supersession; roster import with a bad row; depth chart 409;
   package availability; recommendations generate/decide/stale (change a label → stale on
   read, stored decision untouched); plan draft/submit/approve by coordinator, head-coach
   override flagged, position coach 403, concurrent PATCH 409 with server copy, reopen, new
   draft from approved, comments, share link lifecycle incl. 410 and revoke, exports produce
   HTML and a parseable PDF, cross-team 404 on every new route. `npm run typecheck -w apps/api`,
   `npm test -w apps/api -w packages/contracts`.
7. README: coaching workflow routes, roles, share-link and export notes, env additions.

## Owner question you may ask (non-blocking)
Share-link maximum lifetime (recommend 7 days, the contract's 168 h cap). Nothing else.
