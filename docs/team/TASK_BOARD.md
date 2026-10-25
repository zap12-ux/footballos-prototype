# FootballOS task board

Statuses: Ready · In progress · Ready for review · Integrated · Verified · Blocked.
"Integrated" = merged to `integration` with the full suite green. "Verified" = exercised on
the integrated branch by the lead or QA, evidence linked. Updated by the lead only.

Last updated: 2026-10-25 (session 1). Execution mode: lead + parallel subagents in worktrees
(see DECISIONS.md D-001).

## Milestone K — Agent Build Console (required before substantial parallel product work)

| ID | Task | Owner | Status | Depends on | Allowed paths | Acceptance criteria | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| K0 | Communication contract v1 | Lead | Integrated | — | `tools/agent-console/CONTRACT.md` | Routes, states, SSE, auth, CLI, storage defined | commit 08d2a82 |
| K1 | Runtime service: Hono + SQLite migrations, auth, all routes, SSE replay, git corroboration, `agentctl`/`leadctl`, MCP stdio server, hook forwarder, fixture acceptance script, vitest | console-runtime (subagent) | Integrated | K0 | `tools/agent-console/**` | Fixture acceptance passes; unit tests pass; owner URL printed at start | Lead re-ran on integration f4be3e7: vitest 32/32, fixture acceptance 48/48, build ok |
| K2 | Graph UI: React 19 + `@xyflow/react`, nodes from registry with placeholders, drawer, question cards, needs-input queue, SSE reader with replay, drafts preserved, health/staleness | console-ui (subagent) | Integrated | K0 | `tools/agent-console-ui/**` | Tests pass; build serves from the runtime; refresh restores state | Lead re-ran on integration 93968b9: typecheck pass, vitest 33/33, build 480 KB dist. Against real server: not yet (K3) |
| K3 | Integrate K1+K2; lockfile; `npm run console`; start console; register lead and workers | Lead | Verified | K1, K2 | root, lockfile | Console opens at printed URL and shows live run | Started via `.claude/launch.json` config `agent-console` (port 4800); live run created; lead, console builders, footballos-11, backend, media registered; board loaded; browser shows nodes and labeled dependency edges |
| K4 | Real-agent acceptance run: two agents, two simultaneous questions, routed answers, acks, continued activity, refresh, duplicate submit, replay, unauthorized, superseded | Lead (QA review pending) | Verified by lead | K3 | `docs/console/**` | Scenarios in brief §9 recorded with real event log export | `docs/console/ACCEPTANCE_RUN.md`: 9 scenarios live PASS, agent-failure scenario fixture-only, 1 defect (malformed token → 400 not 401). Independent QA review still to run |

## Milestone A — Foundation and feasibility

| ID | Task | Owner | Status | Depends on | Allowed paths | Acceptance criteria | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A0 | Audit prototype; monorepo restructure; integration branch; contracts spec; task board | Lead | Integrated | — | root, `docs/team/**`, `apps/web` move | `npm run typecheck` and `npm test` green from root after move; docs present | 58/58 web tests pass after move (see STATUS below) |
| A1 | `packages/contracts`: zod schemas + types for CONTRACTS.md §3–§11, error envelope, enums; `apps/api` skeleton: Hono server, SQLite + Drizzle migrations, auth (invite, sign-in, session cookie, TOTP MFA, recovery codes), team/season/staff/schedule services, audit events, healthz, env template, seed script for a **demo** team | B (subagent `backend`) | Verified | A0 | `packages/contracts/**`, `apps/api/**` (not `apps/api/src/media/**`, `apps/api/src/ai/**`) | Server starts with `FOOTBALLOS_DATA_DIR`; migrations apply from empty; vitest covers auth denial paths, team scoping (cross-team 404), version conflicts (409), schedule CRUD + season record; `hono/client` type exported | — |
| A2 | `apps/web`: design tokens, app shell, `react-router` routes for the 10 pages (refresh-safe, back/forward), auth screens wired to A1 contract shapes, landing page with montage slot (poster fallback, pause, reduced motion), environment label, loading/saving/error states, responsive + keyboard a11y; prototype flow preserved under `/demo/film-review` with all 58 tests green | A (subagent `frontend`) | Verified | A0 (contracts by spec; swap to package when A1 lands) | `apps/web/**` | All routes render via direct URL; existing 58 tests pass; new tests for routing, auth gating, montage controls; axe-clean on landing and dashboard | Merged `wt/a-frontend` (5 commits); lead re-ran on integration: vitest 98/98, build ok. Montage is poster-only pending X5; HttpApi untested against the real API (A5) |
| A3 | `packages/media`: ffprobe validation, proxy (720p h264) + thumbnail sheet, proposed play boundaries for fixed-camera film (motion/scene heuristics), split/merge primitives, original-timestamp mapping, footage-quality assessment with explicit "cannot evaluate" list, job-runner contract (lease, heartbeat, retry, cancel, resume), CLI for the six fixture clips | C (subagent `media`) | Verified | A0 | `packages/media/**`, `fixtures/media/**` | Unit tests on the six clips: probe fields, proxy produced, thumbnails produced, segment proposals with timestamps mapped to source; job runner tests for retry/cancel/restart on a fake job | Merged as `wt/c-media` (4 commits); lead re-ran vitest on integration: 60/60. Synthetic asset: 6 proposed segments for 6 plays. Untested on a full game |
| A4 | `packages/ai`: `VisionLabeler` adapter interface, Anthropic adapter (frame sequence, ordered timestamps, abstention, provenance), OpenAI adapter stub, label prompt + output schema (contracts `Label.inferred`), deterministic scouting statistics module (counts/denominators from stored labels), evaluation harness (coach-labeled JSONL → metrics incl. abstention/coverage), model-candidate comparison doc from official docs (capabilities, media limits, pricing, retention) with sources and dates | D (subagent `ai`) | Verified | A0 | `packages/ai/**`, `docs/ai/**` | Adapter tests with a fake transport; stats tests with hand-computed expectations; harness runs on a synthetic labeled set; comparison doc cites current official pages; **no paid call made** | Merged as `wt/d-ai` (5 commits); lead re-ran on integration: typecheck clean, vitest 37/37, build + eval CLI ok; `docs/ai/MODEL_CANDIDATES.md` and `EVALUATION_PLAN.md` (targets are proposals, X4) |
| A5 | Integrate A1–A4; regenerate lockfile; wire API ↔ web for sign-in + team dashboard; smoke test | Lead | Verified | A1–A4 | root, lockfile, glue | Sign-in → dashboard works end to end locally | — |
| A6 | QA pass on integrated Milestone A and the console (auth denial, cross-team, a11y, prototype regressions, console communication and recovery) | E (subagent `qa`) | Integrated (`docs/qa/QA_REPORT_A6.md`; defects D-1..D-4 open for console runtime/UI; a11y pass on A2 still to do) | A1, A3, A4, K4 | `tests/e2e/**`, reports in `docs/qa/**` | Defects filed per owner; prototype regressions (Grade 1/2 reason prompt, Grade 3 not deficiency, No Grade distinct, review time preserved, demo/research distinct, baseline wording) re-run | — |
| A8 | SQLite online backup and verified restore tools (`@footballos/ops`), restore drill on synthetic data | F (session footballos-11) | Verified | — | `tools/ops/**`, `scripts/**`, `deploy/**` | Backup integrity-checked with sha256 sidecar; restore verifies, refuses without force, moves WAL/SHM; drill recorded | Lead re-ran `npm test -w tools/ops`: 8/8 pass on integration cd435a2; `npm run licenses`: 186 packages, 0 violations; full application restore drill still not performed |
| A7 | CI for monorepo (typecheck, tests, build for all workspaces), environment templates, dependency + license inventory script | F (session footballos-11) | Integrated (merge 1 of 2; rerun inventory after A5) | A5 for the rerun | `.github/**`, `deploy/**`, `scripts/**` | CI green on `integration`; inventory committed | — |

## Milestone B — First real end-to-end workflow (started 2026-10-25)

sign in → upload film (resumable) → validate/proxy/thumbnails → segment → infer labels
(or truthful provider-unavailable) → inspect evidence → correct labels → tendencies.
Contract: `docs/team/CONTRACTS.md` §14. Briefs: `docs/team/briefs/*-milestone-b.md`, `K5-console-fixes.md`.

| ID | Task | Owner | Status | Depends on | Allowed paths |
| --- | --- | --- | --- | --- | --- |
| B1 | Upload API (resumable ranges, sha256 dedupe, limits, TTL), assets, media grants/streaming, schema `0001` | B (subagent `backend` #2) | Verified (api 68/68 on integration; chain ran end to end on play-1) | A5 | `apps/api/**`, `packages/contracts/**` |
| B2 | `SqliteJobStore` + worker hosting media and AI handlers; cancel/retry/restart; usage/cost cap | B (same agent) | Verified (api 68/68 on integration; chain ran end to end on play-1) | B1, B2-lib, B4-lib | `apps/api/**` |
| B2-lib | `extractFrames`, `createMediaHandlers`, contracts types in `packages/media` | C (subagent `media` #2) | Verified (media vitest 79/79 on integration) | A5 | `packages/media/**` |
| B3 | Film page (chunked upload, jobs, segments split/merge, proxy player), label review with bulk accept, scouting page, typed `hc<AppType>` client | A (subagent `frontend` #2) | Integrated (web 125/125; lead browser check on the real API; QA UI pass pending) | §14 (code against contract) | `apps/web/**` |
| B4-lib | `createInferLabelsHandler`, `applyInference` (corrections survive reprocessing), `bulkAcceptPlan` | D (subagent `ai` #2) | Verified (ai vitest 65/65 on integration 9d30d6f) | A5 | `packages/ai/**`, `docs/ai/**` |
| B4 / B5 | Label routes, inference enqueue, scouting route and snapshots in the API | B (same agent) | Verified (api 68/68 on integration; chain ran end to end on play-1) | B4-lib, B5-lib | `apps/api/**` |
| B5-lib | `buildScoutingReport`, `snapshotFromReport` | D (same agent) | Verified | — | `packages/ai/**` |
| B6 | QA: interrupted upload, worker restart, provider failure, correction persistence, counts, a11y of A2/B3 | E (subagent `qa` #2) | Integrated (API/worker scope: `docs/qa/QA_REPORT_B6.md`; D-1 High stored-XSS via media stream, D-2 lease recovery, D-3 tsx scripts, D-4/5/7 low; UI a11y scope pending) | B1–B5 integrated | `tests/e2e/**`, `docs/qa/**` |
| B7 | Fix QA B6 defects D-1..D-5, D-7 (CONTRACTS §14.10) | B (subagent `backend` #3) | In progress | B6 | `apps/api/**`, `packages/contracts/**` |
| K5 | Console defects D-1..D-4, `agentctl wait --poll-until-answered` | console-fix (subagent) | Verified (console 45/45 on re-run after one load-related timing failure, ui 41/41, fixture 52/52 on integration) | K4 | `tools/agent-console/**`, `tools/agent-console-ui/**` |

## Milestone C — Coaching workflow (prepared 2026-10-25; launches after B7)

schedule/game workspace → approved playbook and personnel → grounded recommendation →
collaborative unit plan → coordinator approval → authorized sharing.
Contract: `docs/team/CONTRACTS.md` §15. Briefs: `B3-backend-milestone-c.md`, `C3-media-milestone-c.md`,
`D3-ai-milestone-c.md`, `A3-frontend-milestone-c.md`.

| ID | Task | Owner | Status | Depends on | Allowed paths |
| --- | --- | --- | --- | --- | --- |
| C1 | Schema `0002_coaching`; playbook intake/review, personnel, recommendations, plans, approval, sharing, exports in the API | B (subagent `backend` #4) | Ready | B7 | `apps/api/**`, `packages/contracts/**` |
| C2-lib | `extractDocument`, `createDocumentHandlers`, OCR if offline-installable, media `types` export | C (subagent `media` #3) | Ready | B7 | `packages/media/**`, `fixtures/documents/**` |
| C3-lib | `proposeFromPages`, `buildRecommendations`, `recommendationInputsHash`, `planReviewFlags`, grounding doc | D (subagent `ai` #3) | Ready | B7 | `packages/ai/**`, `docs/ai/**` |
| C4 | Playbook, Personnel, Game Plans (editor, approvals, comments, sharing, print/PDF), Recommendations panel, shared read-only route | A (subagent `frontend` #3) | Ready | B7 (code against §15) | `apps/web/**` |
| C5 | QA: authorization matrix for approvals/overrides/sharing, concurrent plan edits, stale flags, exports, playbook proposal honesty, a11y of B3/C4 pages | E | Ready | C1–C4 integrated | `tests/e2e/**`, `docs/qa/**` |

## Milestones D–E

Defined in the brief; tasks will be cut when C is integrated. Not started.

## Blocked items and owner input needed

| ID | Blocked item | Needs | Default if no answer |
| --- | --- | --- | --- |
| X1 | Full-game footage, playbook PDF, roster CSV with rights to use | Owner to provide files or approve download of a specific openly-licensed full game (candidates in `docs/DEMO_FOOTAGE_SOURCES.md`) | Continue on the six credited SWOSU clips as processing fixtures; full-game processing open |
| X5 | Landing montage asset: AI-generated football action clips (D-011) | Owner to choose the generation route and authorize any cost; clips delivered to `apps/web/public/montage/` | Hero shows the designed poster only; montage requirement open |
| X2 | Model API access and budget | Owner-provided Anthropic and/or OpenAI API key with billing, and a monthly cap (suggest $25 dev evaluation cap) | Adapter built and tested with a fake transport; no paid call |
| X3 | Hosting target and staff roster | Single Mac on staff LAN vs small VPS; head coach + coordinators list | Design for single host; demo team seeded with fictional staff |
| X4 | Acceptance targets for model and operations | Owner agreement before evaluation results decide release readiness | Propose targets in `docs/ai/EVALUATION_PLAN.md`; not used for release decisions until agreed |

## STATUS (session 1, Milestone B integrated)

**Working now.** Milestone B is integrated on `integration`: resumable chunked uploads with
sha256 dedupe, private storage, SQLite job store and worker hosting the media chain
(validate → proxy → thumbnails → segment) and the AI inference handler, media grants with Range
streaming, segment split/merge, labels with corrections, revisions and bulk accept, computed
scouting with snapshots, team settings; web film workflow (upload client, job polling, asset
view with proxy player and thumbnails, segment timeline, label review, provenance, scouting
page) on the typed `hc<AppType>` client; console defects D-1..D-4 fixed and the live console
rebuilt.

**Verified now (lead, on the real stack in the browser).** Chunked upload of a fixture clip →
chain completed in ~10 s → asset view with playback, tiles, verbatim quality notes → cut
accepted → "Run inference" shows the truthful "No model provider is configured" state with no
invented label → three coach corrections persisted with revision rows → opponent tendency
report computed from stored labels with denominators (1/1, reviewed-only). Suites on
integration: web 125, api 68, contracts 75, media 79, ai 65, console 45 + fixture 52,
console-ui 41, ops 8; licenses 0 violations; lockfile in sync. One prototype timing test is
load-sensitive (fails under parallel ffmpeg load, passes alone); tracked, not a product defect.

**In progress.** B6 QA on the API/worker failure paths; UI a11y pass to follow.

**Not done / limits.** No live model call (no key); montage clips pending (X5); full-game
footage still absent (X1); Milestone C (schedule workspace, playbook, personnel,
recommendations, plans, approvals, sharing) not started; `thumbEverySec` in grants and
`hono` dev dependency clean-up are open follow-ups for B/A.

**Input needed.** X1, X2, X4, X5 as before.
