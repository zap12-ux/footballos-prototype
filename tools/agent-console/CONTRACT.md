# Agent Build Console — communication contract v1

Owner-only, localhost-bound development tool that shows the real agents building
FootballOS and routes the owner's answers to the right agent. It is **not** part of the
FootballOS product. Package: `tools/agent-console` (`@footballos/agent-console`).

## 1. Integration approach (chosen, documented)

Runtime in this environment: Claude Code (desktop app, Agent SDK harness). Supported
capabilities actually available and used:

| Capability | Mechanism | Evidence it is real |
| --- | --- | --- |
| Launch a specialist agent | Lead calls the Claude Code `Agent` tool (named background subagent, own git worktree) | Spawn result carries the runtime agent id; lead posts `agent.spawned` |
| Agent lifecycle | Task notification to the lead when a subagent finishes or fails | Lead posts `agent.completed` / `agent.failed` |
| Agent → console | Agent runs the `agentctl` CLI (Node) from its Bash tool against the local HTTP service with its own agent token | Server records source `agent`, token-bound |
| Owner → agent (primary) | Agent long-polls `get_user_response` and then calls `acknowledge_response` | `delivered` is set only by the agent's own authenticated fetch; `acknowledged` by its own call |
| Owner → agent (continuation) | If the agent's turn already ended, the lead resumes it with Claude Code `SendMessage` (same transcript) carrying the answer; lead posts `message.delivered` with the response id | Response state goes to `delivered` with `via: 'lead_continuation'`; `acknowledged` still requires the agent's own call |
| Corroboration | Console reads git (worktree branch, commits, changed files, whether merged into `integration`) and verification records posted by the lead/QA after running tests | Shown separately from agent self-reports |

Not assumed: no browser dashboard API in Claude Code, no SDK control over an existing CLI
agent team, no hooks registered mid-session (hooks are snapshotted at session start; a
hook forwarder is provided for future sessions and marked untested until run). An MCP
stdio server exposing the same five operations is provided for sessions where it can be
registered via `.mcp.json`; in this session agents use the CLI.

## 2. Identifiers and correlation

Every question and response carries `projectId`, `runId`, `agentId` (instance), `taskId`,
`questionId`, `questionVersion`, `createdAt`, `updatedAt`. IDs are UUID v4. Timestamps
ISO 8601 UTC. Events have a durable `id` (UUID) and a monotonic `seq` (SQLite rowid) used
for ordered replay.

Runs: `kind: 'live' | 'fixture'`. Fixture runs (automated tests, demos) are stored in the
same schema but every API response and UI surface labels them `FIXTURE`; the UI defaults
to the latest live run.

## 3. Execution states and task statuses (kept separate)

Agent `execState`: `not_started | working | waiting_for_you | waiting_on_dependency |
reviewing | idle | completed | failed | disconnected`.

- `waiting_for_you` is derived: agent has an open **blocking** question.
- `completed` / `failed` are set only by runtime events (`agent.completed`, `agent.failed`),
  never by the agent's self-report.
- `disconnected` is derived: last agent or runtime update older than `STALE_AFTER_MIN`
  (default 20) while the agent was `working`/`reviewing`/`waiting_on_dependency`.
- Agents may self-report `working | reviewing | idle | waiting_on_dependency`.

Task `status`: `ready | in_progress | ready_for_review | integrated | verified | blocked`.
`integrated` and `verified` are set only by the lead/QA with a verification record.

## 4. HTTP API (server binds 127.0.0.1, default port 4800)

Auth: `Authorization: Bearer <token>`. Owner token: generated at first start into
`<DATA_DIR>/owner-token` (0600) and printed once as part of the console URL hash
(`http://127.0.0.1:4800/#token=…`). The lead uses the owner token. Agent tokens are
issued at registration and bound to one agent instance. Requests carrying an `Origin`
header are accepted only from `http://127.0.0.1:4800`, `http://localhost:4800`,
`http://127.0.0.1:4801`, `http://localhost:4801`. Mutations require the bearer header
(no cookies, no form posts). Unauthorized → `401 {error:{code:'unauthorized'}}`;
wrong agent for a resource → `404` (no existence leak).

Error envelope: `{ error: { code, message, details? } }` with codes `validation_error`,
`unauthorized`, `not_found`, `conflict`, `gone`, `internal`.

### 4.1 Owner / lead routes

| Method & path | Body → result |
| --- | --- |
| `GET /api/state?runId=` | Full snapshot `{ run, agents[], tasks[], questions[], responses[], verifications[], lastRuntimeEventAt, serverTime, lastSeq, plannedRoles[], staleAfterMin }` |
| `GET /api/runs` | `{ runs[] }` |
| `POST /api/runs` | `{ kind, label }` → run (lead) |
| `POST /api/agents` | `{ runId, name, role, worktree?, branch?, runtimeAgentId? }` → `{ agent, agentToken }` (token returned once) |
| `PATCH /api/agents/:agentId` | `{ runtimeAgentId?, worktree?, branch?, blockedByTaskId? }` |
| `POST /api/tasks` | `{ runId, id?, title, objective, acceptanceCriteria[], agentId?, dependsOn[], allowedPaths[], branch? }` → task |
| `PATCH /api/tasks/:taskId` | `{ status?, agentId?, dependsOn? …}`; `integrated`/`verified` require `verificationId` |
| `POST /api/verifications` | `{ taskId, kind: 'tests'\|'integration_merge'\|'browser'\|'git'\|'manual', command?, resultSummary, passed: boolean, evidence: object }` → verification |
| `POST /api/runtime/events` | `{ type, agentId?, taskId?, responseId?, details }` where `type ∈ agent.spawned, agent.completed, agent.failed, agent.resumed, message.delivered, lead.note` |
| `POST /api/questions/:questionId/responses` | `{ clientRequestId, questionVersion, text?, option? }` → response; same `clientRequestId` returns the same response (idempotent); version mismatch or non-open question → `409 conflict` |
| `GET /api/questions?status=open` | Needs-your-input queue |
| `GET /api/lead/inbox` | Responses in `submitted` state older than `LEAD_PICKUP_AFTER_SEC` (default 90) whose agent has not fetched them (candidates for lead continuation) |
| `GET /api/stream?runId=&after=<seq>` | SSE, see §5 |
| `GET /api/git/agents/:agentId` | `{ branch, ahead: n, commits[], changedFiles[], mergedIntoIntegration: boolean }` computed from the repo; cached 10 s |

### 4.2 Agent routes (agent token; `:agentId` must match the token)

| Operation | Method & path | Body → result |
| --- | --- | --- |
| `report_status` | `POST /api/agent/:agentId/status` | `{ clientEventId, state, taskId?, message }` → event; duplicate `clientEventId` is a no-op `200` |
| `ask_user` | `POST /api/agent/:agentId/questions` | `{ clientRequestId, taskId, question, why, options?: string[], recommendation?, blocking: boolean, supersedesQuestionId? }` → `{ question }`; superseding marks the old one `superseded` |
| `get_user_response` | `GET /api/agent/:agentId/questions/:questionId/response?wait=<sec≤30>` | `200 { response, question }` and marks `delivered` (first time only, records `deliveredAt`, `via:'agent_poll'`); `204` when none yet; `410 gone` when the question is `superseded\|expired\|canceled` or the task is no longer eligible |
| `acknowledge_response` | `POST /api/agent/:agentId/questions/:questionId/ack` | `{ responseId, note? }` → marks `acknowledged`; idempotent |
| `report_task_result` | `POST /api/agent/:agentId/tasks/:taskId/result` | `{ clientRequestId, status: 'completed'\|'failed', summary, branch, commit?, changedFiles[], testsRun: [{ command, passed: boolean, summary }], limitations[], followUps[] }` → result; sets task `ready_for_review` (never `integrated`) |
| `log` | `POST /api/agent/:agentId/log` | `{ clientEventId, message }` → activity entry (concise operational notes only) |

Eligibility check on `get_user_response` and `ack`: question belongs to this agent **and**
its task; question is `answered`; task status not `integrated|verified`; response
`questionVersion` equals the question's current version. Anything else → `410`.

## 5. Event stream and replay

`GET /api/stream?runId=…&after=<seq>` (or header `Last-Event-ID`). Server replays every
event with `seq > after` in order, then streams live. Each frame:

```
id: <seq>
event: <type>
data: {"id":"…","seq":123,"runId":"…","ts":"…","type":"…","source":"agent|runtime|owner|lead|system","agentId":…,"taskId":…,"questionId":…,"responseId":…,"payload":{…}}
```

A comment heartbeat `: hb <serverTimeIso>` every 15 s. Event payloads wrap the entity under its name (`{ task }`, `{ question }`, `{ response }`, `{ verification }`, `{ agent }`, `{ result }`); `agent.status` carries `{ state, taskId?, message }`, `agent.log` `{ message }`, `response.delivered` `{ via, deliveredAt }`; every `response.*` and `message.delivered` event carries top-level `responseId` and `questionId`. Clients de-duplicate by `id`,
order by `seq`, and on reconnect pass the last seen `seq`. Event types:

`run.created, agent.registered, agent.status, agent.log, agent.spawned, agent.completed,
agent.failed, agent.resumed, task.created, task.updated, task.result, question.asked,
question.superseded, question.expired, response.submitted, response.delivered,
response.acknowledged, message.delivered, verification.recorded, lead.note`.

Entity fields (v1.1): Agent `{ execState (derived), selfReportedState, lastUpdateAt, lastMessage, createdAt, updatedAt }`; Task `{ status, result?, verificationId? }`; Question `{ status, questionVersion, createdAt, updatedAt }`; Response `{ state, deliveredAt?, via?, acknowledgedAt?, resumedAfterAck, option?, text?, createdAt, updatedAt }`; Verification `{ id, createdAt, recordedBy }`. `POST /api/questions/:id/responses` returns `{ response }`. Git commits are `{ sha, subject }`.

## 6. Response lifecycle

`submitted → delivered → acknowledged`. "Resumed" (UI shows the agent continued with the
answer) requires, after `acknowledged`, **either** a new `agent.status`/`agent.log` from
that agent **or** a runtime `agent.resumed` event. Saving a response never implies receipt.

Duplicate protection: `clientRequestId` on every create; UI disables the submit control
while in flight and uses one `clientRequestId` per submission attempt.

## 7. CLI (`tools/agent-console/bin/agentctl.mjs`)

Env: `CONSOLE_URL` (default `http://127.0.0.1:4800`), `CONSOLE_AGENT_ID`, `CONSOLE_AGENT_TOKEN`.

```
agentctl status --state working --task A1 --message "Scaffolding packages/contracts"
agentctl ask --task A1 --question "…" --why "…" --options "a|b" --recommend "a" [--blocking]   # prints questionId
agentctl wait <questionId> [--timeout 900] [--ack]      # long-polls; prints JSON answer; exits 3 on 410, 4 on timeout
agentctl ack <questionId> <responseId>
agentctl result --task A1 --status completed --summary "…" --branch wt/x --commit <sha> --changed-files a,b --tests-json tests.json
agentctl log --message "…"
```

Lead CLI (`bin/leadctl.mjs`, owner token from `<DATA_DIR>/owner-token`): `run create`,
`agent register`, `agent set`, `task create|set`, `verify`, `runtime-event`, `inbox`, `state`.

## 8. Storage

SQLite at `<DATA_DIR>/console.db` (`DATA_DIR` default `.data/console` under the repo root,
gitignored). Migrations: numbered SQL files in `tools/agent-console/migrations`, applied at
start, recorded in `schema_migrations`. Tables: `projects, runs, agents, tasks, events,
questions, responses, task_results, verifications, decisions, schema_migrations`.

## 9. Safety

Localhost only; owner token required; Origin allow-list; no shell box; no runtime control
buttons (Claude Code exposes stop/resume only to the lead session, so the UI offers none
and says so); secrets never stored in events (server redacts strings matching common key
patterns `sk-…`, `ghp_…`, `Bearer …`); agent messages are rendered as text, never HTML.
Answers in the console are product decisions only; they do not grant runtime permissions,
spending, or deployment approval.
