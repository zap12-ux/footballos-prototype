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
| A1 | `packages/contracts`: zod schemas + types for CONTRACTS.md §3–§11, error envelope, enums; `apps/api` skeleton: Hono server, SQLite + Drizzle migrations, auth (invite, sign-in, session cookie, TOTP MFA, recovery codes), team/season/staff/schedule services, audit events, healthz, env template, seed script for a **demo** team | B (subagent `backend`) | Ready for review (result posted; handoff pending) | A0 | `packages/contracts/**`, `apps/api/**` (not `apps/api/src/media/**`, `apps/api/src/ai/**`) | Server starts with `FOOTBALLOS_DATA_DIR`; migrations apply from empty; vitest covers auth denial paths, team scoping (cross-team 404), version conflicts (409), schedule CRUD + season record; `hono/client` type exported | — |
| A2 | `apps/web`: design tokens, app shell, `react-router` routes for the 10 pages (refresh-safe, back/forward), auth screens wired to A1 contract shapes, landing page with montage slot (poster fallback, pause, reduced motion), environment label, loading/saving/error states, responsive + keyboard a11y; prototype flow preserved under `/demo/film-review` with all 58 tests green | A (subagent `frontend`) | In progress (launched through the console) | A0 (contracts by spec; swap to package when A1 lands) | `apps/web/**` | All routes render via direct URL; existing 58 tests pass; new tests for routing, auth gating, montage controls; axe-clean on landing and dashboard | — |
| A3 | `packages/media`: ffprobe validation, proxy (720p h264) + thumbnail sheet, proposed play boundaries for fixed-camera film (motion/scene heuristics), split/merge primitives, original-timestamp mapping, footage-quality assessment with explicit "cannot evaluate" list, job-runner contract (lease, heartbeat, retry, cancel, resume), CLI for the six fixture clips | C (subagent `media`) | Verified | A0 | `packages/media/**`, `fixtures/media/**` | Unit tests on the six clips: probe fields, proxy produced, thumbnails produced, segment proposals with timestamps mapped to source; job runner tests for retry/cancel/restart on a fake job | Merged as `wt/c-media` (4 commits); lead re-ran vitest on integration: 60/60. Synthetic asset: 6 proposed segments for 6 plays. Untested on a full game |
| A4 | `packages/ai`: `VisionLabeler` adapter interface, Anthropic adapter (frame sequence, ordered timestamps, abstention, provenance), OpenAI adapter stub, label prompt + output schema (contracts `Label.inferred`), deterministic scouting statistics module (counts/denominators from stored labels), evaluation harness (coach-labeled JSONL → metrics incl. abstention/coverage), model-candidate comparison doc from official docs (capabilities, media limits, pricing, retention) with sources and dates | D (subagent `ai`) | Verified | A0 | `packages/ai/**`, `docs/ai/**` | Adapter tests with a fake transport; stats tests with hand-computed expectations; harness runs on a synthetic labeled set; comparison doc cites current official pages; **no paid call made** | Merged as `wt/d-ai` (5 commits); lead re-ran on integration: typecheck clean, vitest 37/37, build + eval CLI ok; `docs/ai/MODEL_CANDIDATES.md` and `EVALUATION_PLAN.md` (targets are proposals, X4) |
| A5 | Integrate A1–A4; regenerate lockfile; wire API ↔ web for sign-in + team dashboard; smoke test | Lead | Ready | A1–A4 | root, lockfile, glue | Sign-in → dashboard works end to end locally | — |
| A6 | QA pass on integrated Milestone A (auth denial, cross-team, a11y, prototype regressions) | E | Ready | A5 | `tests/e2e/**`, reports in `docs/qa/**` | Defects filed per owner; prototype regressions (Grade 1/2 reason prompt, Grade 3 not deficiency, No Grade distinct, review time preserved, demo/research distinct, baseline wording) re-run | — |
| A8 | SQLite online backup and verified restore tools (`@footballos/ops`), restore drill on synthetic data | F (session footballos-11) | Verified | — | `tools/ops/**`, `scripts/**`, `deploy/**` | Backup integrity-checked with sha256 sidecar; restore verifies, refuses without force, moves WAL/SHM; drill recorded | Lead re-ran `npm test -w tools/ops`: 8/8 pass on integration cd435a2; `npm run licenses`: 186 packages, 0 violations; full application restore drill still not performed |
| A7 | CI for monorepo (typecheck, tests, build for all workspaces), environment templates, dependency + license inventory script | F (session footballos-11) | Integrated (merge 1 of 2; rerun inventory after A5) | A5 for the rerun | `.github/**`, `deploy/**`, `scripts/**` | CI green on `integration`; inventory committed | — |

## Milestone B — First real end-to-end workflow (not started)

sign in → upload film (resumable) → validate/proxy/thumbnails → segment → infer labels
(or truthful provider-unavailable) → inspect evidence → correct labels → tendencies.

| ID | Task | Owner | Status | Depends on |
| --- | --- | --- | --- | --- |
| B1 | Upload API (resumable ranges, duplicate detection by sha256, limits) + job enqueue | B | Ready | A5 |
| B2 | Job worker hosting `packages/media` + `packages/ai` jobs in `apps/api` | C | Ready | A5, B1 |
| B3 | Our Team Film / Opponent Scouting screens: upload with context form, progress, segment list with split/merge, label review with bulk accept, evidence player seeking the proxy | A | Ready | A5, B1 |
| B4 | Label inference job, correction persistence across reprocessing, provenance display | D | Ready | B2 |
| B5 | Tendency report from stored labels; denominators; review-basis flag | D | Ready | B4 |
| B6 | QA: interrupted upload, worker restart, provider failure, correction persistence, counts | E | Ready | B1–B5 |

## Milestones C–E

Defined in the brief; tasks will be cut when B is integrated. Not started.

## Blocked items and owner input needed

| ID | Blocked item | Needs | Default if no answer |
| --- | --- | --- | --- |
| X1 | Full-game footage, playbook PDF, roster CSV with rights to use | Owner to provide files or approve download of a specific openly-licensed full game (candidates in `docs/DEMO_FOOTAGE_SOURCES.md`) | Continue on the six credited SWOSU clips; mark montage and full-game processing open |
| X2 | Model API access and budget | Owner-provided Anthropic and/or OpenAI API key with billing, and a monthly cap (suggest $25 dev evaluation cap) | Adapter built and tested with a fake transport; no paid call |
| X3 | Hosting target and staff roster | Single Mac on staff LAN vs small VPS; head coach + coordinators list | Design for single host; demo team seeded with fictional staff |
| X4 | Acceptance targets for model and operations | Owner agreement before evaluation results decide release readiness | Propose targets in `docs/ai/EVALUATION_PLAN.md`; not used for release decisions until agreed |

## STATUS (session 1)

**Working now.** Monorepo on `integration`; prototype at `apps/web` with its 58 tests green;
coordination docs in `docs/team`; console contract written; console runtime and UI being built by two subagents; session footballos-11 drafting A7. Product workers A–D are **not launched yet** (console must be proven first).

**Verified now.** `npm run typecheck && npm test` from root after the move (58/58). Nothing
else is verified yet.

**Next integration milestone.** K3/K4: console live and proven with two real agents; then A1–A4 launch through it.

**Input needed.** X1–X3 above.
