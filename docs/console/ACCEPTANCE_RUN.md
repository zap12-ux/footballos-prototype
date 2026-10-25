# Agent Build Console — real-agent acceptance run (2026-10-25)

Run `ccb3b00f` (kind **live**), console at http://127.0.0.1:4800 started from `.claude/launch.json`
config `agent-console` (`npm run start -w tools/agent-console`). Lead = the main Claude Code
session. Agents = Claude Code `Agent`-tool subagents in their own worktrees. Evidence below is
copied from the console's own event log (SSE replay `GET /api/stream?after=0`), unedited apart
from truncation of long text. Ids are shortened to 8 characters.

| Agent id | Name | Role | Runtime id (Agent tool) | Task |
| --- | --- | --- | --- | --- |
| 0313b4fb | backend | Backend / Team Platform | a8733fcb5f0afbfe4 | A1 |
| eafa1f74 | media | Media / Document Processing | a7be7e650c398078f | A3 |

## Scenario results (brief §9)

| Scenario | Result | Evidence |
| --- | --- | --- |
| Two agents appear with distinct identities and actual tasks | PASS (live) | Nodes backend/A1 and media/A3 registered from the runtime registry; screenshot in session; state snapshot lists both with their runtime ids |
| Both ask questions simultaneously | PASS (live) | seq 51 (media, 16:39:41) and seq 52 (backend, 16:39:53), both open at once; queue showed two items |
| Each answer reaches only its intended agent and task | PASS (live) | Owner answers seq 53/54 (source `owner`); `response.delivered` seq 57 (backend, cli_prompt) and seq 59 (media, 8 GB / 4 h / 720p) each fetched with that agent's own token (`via: agent_poll`); fixture run additionally proves cross-agent fetch → 404 |
| Recipient acknowledges and continues with it | PASS (live) | `response.acknowledged` seq 58 and 60 by the agents' own calls; follow-up `agent.status` seq 61/62 reference the answer; `resumedAfterAck: true` for both responses |
| Refreshing the browser preserves questions and responses | PASS (live) | Page reloaded after answering; both questions show as answered with Submitted → Delivered → Acknowledged · Resumed history (server-side state, re-fetched on load) |
| Duplicate submission does not cause duplicate execution | PASS (live + fixture) | Live: a second answer to an answered question → HTTP 409 (`conflict`); fixture: same `clientRequestId` twice returns the same response (48/48 fixture checks) |
| Disconnected client recovers missed events | PASS (live) | `GET /api/stream?after=47` replayed seq 48–62 in order, no duplicates; the UI reconnects with its last seq |
| An agent failure remains visibly failed until recovery | FIXTURE ONLY | No live agent failed during this run. Fixture check "agent.completed → execState completed" and the derivation rule (`failed` only cleared by `agent.spawned`/`agent.resumed`) are unit-tested; not yet observed live |
| An obsolete question cannot resume the wrong task | PASS (live + fixture) | Live: answered question rejects new responses (409); fixture: superseded question → `agentctl wait` exits 3 on 410, owner answer → 409, task reassignment → 410 |
| Unauthorized clients cannot read or answer questions | PASS (live) | No token → 401; bad Origin with valid token → 401; malformed token → 400 (refused; see defects) |
| Console server restart preserves state | PASS (live) | Server exited cleanly at ~13:11 local (cause not identified) and was restarted at 13:13 from the same data dir; owner token, run, agents, tasks, questions and all four acknowledged responses were intact; the owner watcher and UI reconnected |
| An integrated task shows the relevant verification evidence | PASS (live) | K1 and K2 carry verification records (vitest 32/32 + fixture 48/48; vitest 33/33 + build) and status `integrated`; `report_task_result` cannot set `integrated` (fixture) |

Lead continuation path: both answers sat unfetched for more than `LEAD_PICKUP_AFTER_SEC` (90 s)
because the agents poll only at natural pauses. The lead sent each agent a nudge by
`SendMessage` **without** the answer content (seq 55/56, `lead.note`), so delivery is still
proven by the agents' own fetches. The content-carrying continuation (`message.delivered`,
`via: lead_continuation`) was exercised only in the fixture run.

## Defects found

- `leadctl answer <questionId> ...` fails with `unknown command "answer <id>"` (positional
  argument parsing); the owner API itself works (used directly with curl, HTTP 201). Owner:
  console runtime. Status: open.

- Owner reported they could not select a queued question in their console window (Frontend question
  44759ff5, 2026-10-25 ~16:55 UTC). The lead relayed the question in chat and submitted the
  owner's answer through the owner API (`leadctl answer`, source `owner`), recorded as a
  `lead.note`. Repro steps not yet captured (browser, window size). Owner: console UI. Status: open, for QA.

- Malformed bearer token returns 400 `validation_error` instead of 401 `unauthorized`. Access is
  still refused. Owner: console runtime. Status: open.

## Event log (seq ≥ 46)

| seq | time (UTC) | type | source | agent | question | response | message |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 46 | 16:38:57 | `agent.spawned` | runtime | 0313b4fb |  |  |  |
| 47 | 16:38:58 | `agent.spawned` | runtime | eafa1f74 |  |  |  |
| 48 | 16:38:58 | `lead.note` | lead | 0313b4fb |  |  |  |
| 49 | 16:38:58 | `lead.note` | lead | eafa1f74 |  |  |  |
| 50 | 16:39:40 | `agent.status` | agent | 3fde40cd |  |  | Holding until A5; A7 and A8 integrated |
| 51 | 16:39:41 | `question.asked` | agent | eafa1f74 | 5b2b6ce9 |  | Default upload limits for one game film and proxy height: keep 8 GB / 4 h max per file and |
| 52 | 16:39:53 | `question.asked` | agent | 0313b4fb | 025c4f33 |  | On first-run production setup, how should the initial head coach account be created? |
| 53 | 16:40:09 | `response.submitted` | owner | eafa1f74 | 5b2b6ce9 | 7f0a8767 | Default upload limits for one game film and proxy height: keep 8 GB / 4 h max per file and |
| 54 | 16:40:15 | `response.submitted` | owner | 0313b4fb | 025c4f33 | 1cd3f6ca | On first-run production setup, how should the initial head coach account be created? |
| 55 | 16:42:21 | `lead.note` | runtime | eafa1f74 | 5b2b6ce9 | 7f0a8767 | Response unfetched after LEAD_PICKUP_AFTER_SEC; lead sent a nudge via SendMessage asking t |
| 56 | 16:42:21 | `lead.note` | runtime | 0313b4fb | 025c4f33 | 1cd3f6ca | Response unfetched after LEAD_PICKUP_AFTER_SEC; lead sent a nudge via SendMessage asking t |
| 57 | 16:42:40 | `response.delivered` | agent | 0313b4fb | 025c4f33 | 1cd3f6ca | cli_prompt |
| 58 | 16:42:40 | `response.acknowledged` | agent | 0313b4fb | 025c4f33 | 1cd3f6ca | cli_prompt |
| 59 | 16:43:09 | `response.delivered` | agent | eafa1f74 | 5b2b6ce9 | 7f0a8767 | 8 GB / 4 h / 720p proxy |
| 60 | 16:43:09 | `response.acknowledged` | agent | eafa1f74 | 5b2b6ce9 | 7f0a8767 | 8 GB / 4 h / 720p proxy |
| 61 | 16:43:17 | `agent.status` | agent | eafa1f74 |  |  | Owner confirmed 8 GB / 4 h / 720p proxy; locking those as the package defaults and writing |
| 62 | 16:43:27 | `agent.status` | agent | 0313b4fb |  |  | Owner chose cli_prompt: first-run head coach will be created by an interactive CLI (npm ru |
| 63 | 16:44:42 | `agent.registered` | lead | 5f551df2 |  |  |  |
| 64 | 16:44:45 | `agent.registered` | lead | 7d2a7469 |  |  |  |
| 65 | 16:44:46 | `task.updated` | lead | 5f551df2 |  |  |  |
| 66 | 16:44:48 | `task.updated` | lead | 7d2a7469 |  |  |  |

