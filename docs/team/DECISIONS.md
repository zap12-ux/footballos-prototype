# FootballOS architecture and delivery decisions

Append-only log. Newest at the bottom. Each entry: date, decision, why, consequences.

## D-001 · 2026-10-25 · Execution mode for the development team
**Decision.** Lead-coordinated parallel subagents (Claude Code `Agent` tool), each in its
own git worktree and branch of this repository, at most four active at once. Follow-ups go
to the same named agent so it keeps its context.
**Why.** The harness in this session exposes background subagents and cross-agent messaging
but no agent-team tool, although `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is set in user
settings. Role headings in one transcript would not be delegation.
**Consequences.** Every brief must be self-contained. Integration, merge order and
verification stay with the lead. Mode is re-checked at the start of each session.

## D-002 · 2026-10-25 · Monorepo with npm workspaces; prototype preserved as `apps/web`
**Decision.** `apps/web` (existing React 19 / Vite 6 / Vitest prototype, moved intact with
history), `apps/api`, `packages/contracts`, `packages/media`, `packages/ai`. npm (not pnpm)
because the repo, lockfile and the Pages workflow already use npm.
**Why.** The Module 7 prototype is graded coursework with 58 regression tests that the
brief requires us to keep; the new product grows around it rather than replacing it.
**Consequences.** `main` keeps serving the graded prototype at
https://zap12-ux.github.io/footballos-prototype/ until the owner decides otherwise. All new
work lands on `integration`. The Pages workflow now builds from `apps/web`.

## D-003 · 2026-10-25 · Single-host stack: Node 22+, Hono, SQLite, local disk, bundled ffmpeg
**Decision.** API: Hono on `@hono/node-server` with zod validation and `hono/client` for
typed clients. Database: SQLite via `better-sqlite3` + Drizzle ORM with SQL migration files
in `apps/api/drizzle`. Storage: private directory under `FOOTBALLOS_DATA_DIR`. Media tooling:
`ffmpeg-static` / `ffprobe-static` (probe on this Mac: ffmpeg 6.1.1 runs, better-sqlite3
builds, `node:sqlite` also available). Background jobs: SQLite-backed job table with
leases, heartbeats, bounded retries, cancellation and restart recovery, run by an
in-process worker loop (separately startable).
**Why.** One coaching staff, private use, controlled cost. No Docker or Postgres is
installed locally; SQLite + local disk is reproducible, backup-able (file copy + WAL
checkpoint) and runs on a Mac mini or a small VPS. Hono's typed client gives generated
client types without a codegen step.
**Consequences.** Horizontal scaling is out of scope. Per-worker isolation = separate
`FOOTBALLOS_DATA_DIR` and ports (see WORKFLOW.md). Migration sequencing is owned by B.

## D-004 · 2026-10-25 · Primary model adapter: Anthropic Claude vision over sampled frames
**Decision.** One `VisionLabeler` adapter interface in `packages/ai`; first implementation
targets the Anthropic Messages API with ordered, timestamped frame sequences per segment;
an OpenAI adapter is the second candidate; open-source (Qwen3-VL) is evaluated only on
paper until footage and hosting exist. Provider selection per team is configuration.
**Why.** The brief allows OpenAI, Anthropic and open source and asks for one primary
behind a replaceable adapter. Native video input across providers is uneven; frame
sampling with recorded timestamps is provider-neutral and makes "what the model saw"
auditable.
**Consequences.** No API key is configured in this environment and no paid call is made
without the owner's authorization (§14 of the brief). Without a key the system reports
`provider_unavailable` truthfully and manual labeling remains available. Measured model
comparison is **blocked on footage, keys and budget** (see TASK_BOARD.md).

## D-005 · 2026-10-25 · Footage policy
**Decision.** Development fixtures: the six SWOSU end-zone clips already in
`apps/web/public/demo-film` (CC BY-NC 4.0, credited). Full-game processing and the landing
montage require owner-provided or verified-licensed footage; until then the montage ships
with the credited clips behind a documented fallback and the requirement stays **open**.
**Why.** No full-game fixed-sideline footage, roster or playbook exists in the repository.
**Consequences.** Segmentation and quality assessment are developed on short clips and
must be re-verified on a real full game before Milestone E.

## D-006 · 2026-10-25 · Ownership of shared surfaces
| Surface | Owner |
| --- | --- |
| Database schema, migration order | B (Backend) |
| `packages/contracts` (schemas, API types) | B, spec by lead |
| Root `package.json`, `package-lock.json` | Lead (workers edit only their own workspace manifest; lead regenerates the lockfile at integration) |
| Global routing (`apps/web/src/app/router.tsx`) | A (Frontend) |
| Design tokens (`apps/web/src/styles/tokens.css`) | A (Frontend) |
| Deployment configuration (`.github/workflows`, `deploy/`) | F (Deployment); lead until F is active |
