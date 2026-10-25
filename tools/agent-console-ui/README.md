# @footballos/agent-console-ui

Owner-only, localhost development UI for the Agent Build Console. It renders the agents
building FootballOS as a graph, shows each agent's work and lets the owner answer agents'
questions from their nodes. Built strictly against `tools/agent-console/CONTRACT.md` (v1).
Not part of the FootballOS product.

## Run

| Command | What it does |
| --- | --- |
| `npm run dev -w tools/agent-console-ui` | Vite on `http://127.0.0.1:4801`, proxying `/api` to the real server on 4800. Open with the `#token=…` URL the server prints (replace the port with 4801). |
| `npm run dev:mock -w tools/agent-console-ui` | Same, but `/api` goes to `scripts/mock-server.mjs` on 4802 (FIXTURE data, dev/tests only). Open `http://127.0.0.1:4801/#token=FIXTURE-OWNER-TOKEN`. |
| `npm run build -w tools/agent-console-ui` | Production build into `dist/`, served by the console server at `http://127.0.0.1:4800/`. |
| `npm test -w tools/agent-console-ui` | Vitest + Testing Library. |
| `npm run typecheck -w tools/agent-console-ui` | `tsc --noEmit`. |

The owner token is read once from the URL hash, kept in `sessionStorage` (this tab only),
stripped from the address bar, and sent as `Authorization: Bearer` on every request,
including the SSE stream (read with `fetch` + a streaming reader, never `EventSource`,
never `?token=`).

## Contract assumptions (for the server engineer to confirm)

The contract fixes routes, event types and lifecycles but not every entity field. The UI
reads the following and degrades gracefully when a field is missing:

- `GET /api/state` extras honoured when present: `plannedRoles: string[]` (else the fixed
  seven roles), `staleAfterMin: number` (else 20), `lastSeq: number` (highest event seq the
  snapshot includes; used to treat replayed events at or below it as history only).
  Without `lastSeq`, entity patches from replayed events are guarded by `ts >= updatedAt`.
- Agent: `{ id, runId, name, role, worktree?, branch?, runtimeAgentId?, blockedByTaskId?, execState?, lastUpdateAt?, lastMessage?, createdAt, updatedAt? }`.
  `execState` is used as the base; `waiting_for_you` and `disconnected` are re-derived
  client-side from open blocking questions and staleness; `completed`/`failed` are only
  ever set from `agent.completed`/`agent.failed` runtime events.
- Task: as in `POST /api/tasks` plus `status`, optional `result` (latest
  `report_task_result` body) and `verificationId`.
- Question: as in `ask_user` plus `id, runId, agentId, questionVersion, status, createdAt, updatedAt`.
- Response: `{ id, questionId, questionVersion, agentId, taskId, text?, option?, state, deliveredAt?, via?, acknowledgedAt?, resumedAfterAck?, createdAt, updatedAt }`.
  "Resumed" shows only when `resumedAfterAck` is true, which the UI also derives from a later
  `agent.status`/`agent.log`/`agent.resumed` for that agent (CONTRACT §6).
- Verification: as in `POST /api/verifications` plus `id, createdAt`, optional `recordedBy`.
- Event payloads: either the entity wrapped under its name (`{ task: {...} }`,
  `{ question: {...} }`, `{ response: {...} }`, `{ verification: {...} }`, `{ result: {...} }`)
  or the entity itself with an `id`. `agent.status` payload: `{ state, taskId?, message }`;
  `agent.log`: `{ message }`; `response.delivered`: `{ via?, deliveredAt? }`.
- `GET /api/git/agents/:id` commits: `{ sha, subject? | message? }`.
- `POST /api/questions/:id/responses` may return the response directly or `{ response }`.
- The stream is opened with `after=0` on first connect so the activity history is rebuilt
  from the server on every refresh; reconnects pass the last seen `seq` and refetch the
  snapshot. `seq` gaps are expected on per-run streams (shared rowid), so the reader orders
  and de-duplicates but never waits for gaps to close.

## Layout and breakpoints (QA D-2 / D-3)

There is no hard minimum width; the layout is usable from 720 px up. `hooks/useLayoutMode.ts`
decides the modes with `matchMedia` and `App` exposes them as `data-drawer-mode` and
`data-queue-mode` on `.app` (CSS keys off those attributes):

| Window width | Queue | Agent drawer |
| --- | --- | --- |
| >= 1180 px | docked left column | docked right column (400 px, 360 px below 1280) |
| 960–1179 px | docked left column | overlay panel over the graph: full height, `min(480px, 100%)` wide, `role="dialog"`, backdrop, Close always in the sticky header, Escape closes, Tab trapped, focus returned to the opener |
| 720–959 px | collapsed to a "Show queue" toggle bar (count and blocking count) that opens an overlay list with the same dialog behaviour; picking a question closes the list | overlay panel as above |

Opening a question from the queue scrolls its card to just below the drawer's sticky header:
`Drawer` measures the header and sets `scroll-margin-top` on the card before `scrollIntoView`
(CSS default 72 px). Tests: `src/tests/layout.test.tsx`.

## Local-only state

`localStorage`: question drafts (`agentConsole.draft.<questionId>`), manual node positions
per run (`agentConsole.positions.<runId>`), last selected run. `sessionStorage`: owner token.
Everything else is restored from the server.
