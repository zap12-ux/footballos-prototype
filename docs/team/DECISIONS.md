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

## D-007 · 2026-10-25 · Agent Build Console: integration approach
**Decision.** Owner-only localhost console at `tools/agent-console` (Hono + SQLite + SSE)
and `tools/agent-console-ui` (React 19 + `@xyflow/react`). Agents talk to it through the
`agentctl` CLI from their Bash tool (operations `report_status`, `ask_user`,
`get_user_response`, `acknowledge_response`, `report_task_result`). Owner answers reach an
agent primarily by the agent's own long-poll and acknowledgment; if the agent's turn has
already ended, the lead resumes it with Claude Code `SendMessage` and records a
`message.delivered` runtime event. Lifecycle (`agent.spawned/completed/failed`) is posted
by the lead from real Agent-tool results and task notifications. An MCP stdio server and a
hook forwarder are shipped for future sessions and marked untested in a live session.
**Why.** Claude Code here exposes no dashboard API, hooks are snapshotted at session start,
and MCP servers registered now would only load in a new session. The CLI path is supported
today and every step leaves verifiable evidence (token-bound fetch, ack, subsequent event).
**Consequences.** The console is built and proven with two real agents before the product
workers launch (brief §1). Contract: `tools/agent-console/CONTRACT.md`.

## D-008 · 2026-10-25 · A second Claude Code session joins as Deployment / Reliability (F)
**Decision.** Session `footballos-11`, started by the owner, takes A7 under the lead's
direction in `.worktrees/f-deploy` (`wt/f-deploy`), paths `.github/**`, `deploy/**`,
`scripts/**`. It is the third of at most four concurrent specialists and will be registered
as a console node when the console is live.

## D-009 · 2026-10-25 · Hosting target (provisional, owner confirmation pending)
**Decision (provisional).** Deployment documentation targets one small cloud VM with a
persistent volume (Node 22, SQLite and `FOOTBALLOS_DATA_DIR` on the volume, off-host backups
to object storage), with the single local Mac as the documented fallback. Provider is not
chosen; F documents two or three options with dated official pricing. Nothing is provisioned
or paid for without the owner's explicit authorization in the lead's session.
**Why.** The owner indicated a simple cloud hosting location (relayed from session
footballos-11; to be confirmed directly with the lead).

**Update 2026-10-25 (D-009).** Provider chosen: DigitalOcean (Basic Droplet 2 vCPU / 4 GiB,
Block Storage volume, Spaces for off-host backups; about $39/month at the reference size per
`deploy/README.md`). Relayed from the owner by session footballos-11. This chooses the
provider only; creating an account, provisioning, payment, deployment and moving any film
each need separate explicit approval from the owner in the lead's session.

## D-010 · 2026-10-25 · Exactly one lead session; forks must not resume agents
**Decision.** Only the original lead session resumes, messages or stops specialist agents.
A fork of the lead session must not send messages to the agents, post to the console as
lead, or edit worktrees; it may read the board and the console only.
**Why.** At 12:52 a fork of the lead (opened because the owner believed the lead had
stopped) resumed all four product agents by message, which created second copies writing
into the same worktrees; the Media copy committed 7e6bcde and the AI copy overwrote
`packages/ai/src`. The copies were stopped at 12:58. Agents now commit WIP after every
module so any overwrite is recoverable with git.
**Consequences.** The console shows the lead's own status; a long silence from the lead means
it is waiting on agent notifications, not stopped. Four `agent.resumed` events posted by the
fork at ~12:53 are annotated as disregarded.

## D-011 · 2026-10-25 · Landing montage uses AI-generated football action, not evaluation footage
**Decision.** The public landing hero montage will be built from AI-generated clips of
football players tackling and making plays. The credited SWOSU clips stay inside the
prototype demo flow only. Until generated clips exist the hero shows a designed poster
with no video, driven by `apps/web/public/montage/manifest.json`.
**Why.** Owner instruction (2026-10-25). Keeps evaluation footage out of marketing use and
removes the CC BY-NC question for the public site.
**Consequences.** The montage requirement stays **open** until the generated asset exists,
its generation terms permit this use, and playback is verified (brief §4). Generation route
and any cost need the owner's authorization (D-004 rule on paid provisioning applies).

## D-012 · 2026-10-25 · Repository moved off the iCloud-synced Desktop
**Decision.** The outer course repo, the nested `footballos-prototype` repo and `.worktrees/`
now live at `~/Projects/FootballOS` (owner-approved). Worktree pointers repaired with
`git worktree repair`; launch configs and briefs re-pointed.
**Why.** iCloud Drive evicted tracked files repeatedly (about 10 GB free disk), which made the
typechecker, Vite and ffprobe read empty files and blanked the web app mid-verification.
**Consequences.** Historical documents (QA report, change summary) keep the old absolute paths
as written at the time. Recovery trick kept in WORKFLOW knowledge: for an evicted tracked
file, `rm` it and `git checkout -- <file>`.

## D-013 · 2026-10-25 · Share-link lifetime cap is 72 hours
**Decision.** Plan share links expire at most 72 hours after creation (owner answer to the
Backend question in Milestone C; the contract's 168 h was lowered). Shorter requests are
allowed; longer ones are rejected with 400.

## D-014 · 2026-11-21 · Plan approval history is immutable; overrides need a reason; one draft per unit
**Decision.** `GamePlanVersion` gains `overrideReason: string | null` (required, non-empty,
when `override` is true), `supersededAt` and `supersededByVersionId`. Approving a later
version marks the previous approved one `superseded` and fills those two fields; its
`approvedBy`, `approvedAt`, `override` and `overrideReason` are never cleared. A head-coach
approval is always an override (the role, not the unit list, decides) and
`POST /plan-versions/:id/approve` rejects it with `400` unless `overrideReason` is given; the
`plan.override_approved` audit event carries the reason. A plan keeps at most one `draft`:
the API already answered `409 draft_exists`; the mock now does too, and the web app opens the
existing draft and says so instead of creating another. Contract and `packages/contracts`
amended together (iteration 1, commit for HC-03 / HC-07).
**Why.** Round-1 findings HC-03 (superseding hid the original approver and time and captured
no reason) and HC-07 (two editable drafts for one unit). The contract already said "at most
one draft per plan"; the product disagreed with it in mock mode. The brief leaves the
override-reason shape open: a required free-text reason was chosen over an optional note
because the athletic-director scenario in HC-03 needs the "why" a week later, and a
required field is the only way to guarantee it is there. Coach input is kept: the reason is
stored with the version and in the audit row, never only in a transient note.
**Consequences.** `apps/api` migration `0004_plan_approval_history` adds the three columns
(nullable, so existing rows stay valid; existing override rows have no reason and are shown
as such). `apps/web` mock seed carries the fields. Round 2 retraces HC-03 by selecting a
superseded version and reading its approver, time, override flag and reason; HC-07 by
starting a new draft while one exists and landing on the existing draft.

## D-015 · 2026-11-27 · Demo modes removed; Ollama is the one model provider; the app joins hubandspokerecruiting.com
**Decision.** The web app runs only against `apps/api` (`VITE_API_MODE` and the in-browser mock
API are gone; the mock survives solely as a test fixture under `apps/web/src/tests/fakeApi`).
The Module 7 usability prototype (`/prototype/`, simulated AI, demo/research sessions) and the
`seed:demo` script are retired from `integration`; `main` keeps the graded prototype. The model
adapter is a single `OllamaVisionLabeler` / `OllamaPageLabeler` over a local Ollama server
(`OLLAMA_HOST`, default `http://127.0.0.1:11434`) running an open-source vision model
(`FOOTBALLOS_AI_MODEL`, default `qwen3-vl:4b`; `qwen3-vl:8b` on a 16 GiB+ server). The Anthropic
and OpenAI adapters, API-key configuration, the USD price table and `MONTHLY_COST_CAP_USD` are
removed; `ModelProvenance.provider` is `'ollama'` and `costUsd` is recorded as 0. The six credited
clips moved from `apps/web/public/demo-film` to `fixtures/media/clips` (tests only; nothing is
served). The app is planned as an addition to <https://hubandspokerecruiting.com/>, so the web
build takes `VITE_BASE_PATH` for a path prefix and `VITE_API_BASE_URL` for a separate API origin.
**Why.** Owner instruction (2026-11-27): remove the demo testing and make the app fully
functional around an open-source model from Ollama. Local inference keeps film on the team's
own machine, needs no provider account and has no per-call cost, which made the spend controls
of D-004 dead weight. Supersedes D-004's provider choice; the replaceable-adapter rule and the
"never a canned label" rule stand.
**Consequences.** Inference needs Ollama running with a vision-capable model pulled; the worker
checks reachability and the model's `vision` capability before extracting a frame and fails the
job non-retryably with `provider_unavailable` naming the fix (`ollama serve`, `ollama pull …`).
A static GitHub Pages deploy of the web app no longer makes sense (sign-in needs the API);
`deploy.yml` on `main` is untouched for the prototype. Model quality on real film is
unmeasured (EVALUATION_PLAN still applies); the 8 GiB development Mac runs the 4b model on CPU.
