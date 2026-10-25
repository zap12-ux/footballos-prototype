# Agent Build Console — runtime service

Owner-only, localhost-bound development tool that shows the real Claude Code agents building
FootballOS and routes the owner's answers to the right agent. It is **not** part of the
FootballOS product. The authoritative API/behaviour spec is [`CONTRACT.md`](./CONTRACT.md);
this README covers running and operating the service.

Package: `@footballos/agent-console` (`tools/agent-console`). Node >= 22, npm workspaces.

## Start the console

From the repo root, after `npm install`:

```sh
npm run console                              # builds the UI then starts this server (wired by the lead)
npm run start -w tools/agent-console         # start the server only (requires `npm run build -w tools/agent-console` first)
npm run dev   -w tools/agent-console         # tsx watch mode, no build step
```

On start the server prints exactly two operational lines:

```
CONSOLE_URL=http://127.0.0.1:4800/#token=<ownerToken>
CONSOLE_STATE=listening data_dir=<DATA_DIR> run=<latest live run id | none>
```

Open `CONSOLE_URL` in a browser (the token travels in the URL hash and is never logged
elsewhere). The owner token is stored at `<DATA_DIR>/owner-token` (mode 0600) and reused on
every restart; delete the file to rotate it. The server binds `127.0.0.1` only.

When `tools/agent-console-ui/dist/index.html` exists it is served at `/` (SPA fallback for every
non-`/api` path). Otherwise `/` returns a plain-text note explaining how to build the UI; the API
works regardless.

## Environment (`.env.example`)

| Variable | Default | Meaning |
| --- | --- | --- |
| `CONSOLE_PORT` | `4800` | Listening port on 127.0.0.1 (`0` picks a free port). |
| `CONSOLE_DATA_DIR` | `<repo root>/.data/console` | Holds `console.db` (SQLite, WAL) and `owner-token`. Gitignored. (`DATA_DIR` is accepted as an alias.) |
| `STALE_AFTER_MIN` | `20` | Minutes without an agent/runtime update before a `working`/`reviewing`/`waiting_on_dependency` agent is shown as `disconnected`. |
| `LEAD_PICKUP_AFTER_SEC` | `90` | Age of an unfetched `submitted` response before it appears in `GET /api/lead/inbox`. |
| `CONSOLE_REPO_ROOT` | the repo containing this package | Where `git` runs for `GET /api/git/agents/:agentId`. |
| `CONSOLE_URL` | `http://127.0.0.1:4800` | Used by the CLIs and the MCP server to reach the console. |
| `CONSOLE_OWNER_TOKEN` | read from `<DATA_DIR>/owner-token` | Used by `leadctl` and the hook forwarder. |
| `CONSOLE_AGENT_ID`, `CONSOLE_AGENT_TOKEN` | — | Per-agent credentials issued at registration; used by `agentctl` and the MCP server. |

Migrations live in `migrations/NNN_*.sql`, run at startup and are recorded in
`schema_migrations`.

## Lead workflow (owner token)

`bin/leadctl.mjs` reads the owner token from `CONSOLE_OWNER_TOKEN` or `<DATA_DIR>/owner-token`.

```sh
L="node tools/agent-console/bin/leadctl.mjs"
$L run create --kind live --label "Sprint 3 build"                      # -> { run }
$L agent register --run <runId> --name "Frontend" --role frontend \
     --worktree .worktrees/a-frontend --branch wt/a-frontend            # -> { agent, agentToken }  (token shown once)
$L task create --run <runId> --id A1 --title "..." --objective "..." \
     --criteria "a|b" --agent <agentId> --allowed-paths "apps/web/**"
$L runtime-event --type agent.spawned --agent <agentId> --details '{"runtimeAgentId":"<Claude Code agent id>"}'
$L state            # full snapshot      $L inbox       # responses nobody fetched
$L questions --status open               $L answer <questionId> --version 1 --option "a"
$L verify --task A1 --kind tests --command "npm test -w apps/web" --summary "12 passed" --passed true
$L task set A1 --status integrated --verification <verificationId>      # integrated/verified need a verification
$L git <agentId>    # branch, commits ahead of integration, changed files, merged?
```

Give each agent its credentials when you spawn it (in the Agent tool prompt or the shell env of
its Bash tool):

```
CONSOLE_URL=http://127.0.0.1:4800
CONSOLE_AGENT_ID=<agent.id from registration>
CONSOLE_AGENT_TOKEN=<agentToken from registration>
```

When Claude Code notifies you that a subagent finished or failed, post `agent.completed` /
`agent.failed`. Those are the only ways an agent reaches `completed`/`failed` in the console.

## Agent workflow (`agentctl`)

`bin/agentctl.mjs` is plain Node ESM (no build). Output is JSON on stdout; errors are readable
text on stderr. Exit codes: `0` ok, `1` error, `2` configuration/connection, `3` the question is
gone (410: superseded/expired/canceled or task closed), `4` wait timeout.

```sh
A="node tools/agent-console/bin/agentctl.mjs"
$A status --state working --task A1 --message "Scaffolding packages/contracts"
$A ask --task A1 --question "Tabs or spaces?" --why "..." --options "tabs|spaces" --recommend spaces --blocking
#   -> { "questionId": "...", "question": {...} }
$A wait <questionId> --timeout 900 --ack        # long-polls (wait=25 per request) until answered; --ack acknowledges on receipt
$A ack <questionId> <responseId>                # if you waited without --ack
$A result --task A1 --status completed --summary "..." --branch wt/a-frontend --commit <sha> \
      --changed-files a.ts,b.ts --tests-json tests.json --limitations "x|y" --follow-ups "z"
$A log --message "ran typecheck: clean"
```

`tests.json` is an array of `{ "command", "passed", "summary" }`. Every create carries an
auto-generated `clientRequestId`/`clientEventId`; pass `--client-id <id>` to retry the same
request safely.

Response lifecycle (`submitted → delivered → acknowledged`): `delivered` is recorded only when
the agent itself fetches the answer (`agentctl wait`, `via: agent_poll`) or when the lead posts
`message.delivered` with the `responseId` after resuming the agent with SendMessage
(`via: lead_continuation`). `acknowledged` is only ever set by the agent's own ack. The UI's
"resumed" indicator (`resumedAfterAck`) becomes true only when, after the ack, that agent sends
another `agent.status`/`agent.log` or the lead posts `agent.resumed`.

## MCP server (optional, for sessions where it can be registered)

`bin/mcp-server.mjs` is a stdio MCP server exposing `report_status`, `ask_user`,
`get_user_response`, `acknowledge_response`, `report_task_result`. It calls the same HTTP API with
`CONSOLE_URL`, `CONSOLE_AGENT_ID`, `CONSOLE_AGENT_TOKEN`. Build first
(`npm run build -w tools/agent-console`), then register it in `.mcp.json`:

```json
{
  "mcpServers": {
    "agent-console": {
      "command": "node",
      "args": ["tools/agent-console/bin/mcp-server.mjs"],
      "env": {
        "CONSOLE_URL": "http://127.0.0.1:4800",
        "CONSOLE_AGENT_ID": "<agent id>",
        "CONSOLE_AGENT_TOKEN": "<agent token>"
      }
    }
  }
}
```

Registering it in `.mcp.json` takes effect only for a newly started Claude Code session. It is
unit-tested over stdio with the MCP SDK client (`src/test/mcp.test.ts`), but it has not been
exercised inside a live Claude Code session yet. In the current session agents use `agentctl`.

## Claude Code hook forwarder (untested in a live session)

`bin/hook-forward.mjs` reads a Claude Code hook payload (SubagentStart/SubagentStop/Stop shapes)
from stdin and posts it as a `lead.note` runtime event with `details.hook` (`event`, `sessionId`,
`runtimeAgentId`, `agentType`, `transcriptPath`, ...). If the payload's `agent_id` matches a
registered agent's `runtimeAgentId`, the event is attached to that agent. It always exits 0.
Hooks are snapshotted at session start, so this takes effect for the next session; it has not
been run in a live session yet. Snippet for `.claude/settings.json`:

```json
{
  "hooks": {
    "SubagentStart": [{ "hooks": [{ "type": "command", "command": "node tools/agent-console/bin/hook-forward.mjs" }] }],
    "SubagentStop":  [{ "hooks": [{ "type": "command", "command": "node tools/agent-console/bin/hook-forward.mjs" }] }],
    "Stop":          [{ "hooks": [{ "type": "command", "command": "node tools/agent-console/bin/hook-forward.mjs" }] }]
  }
}
```

## Recovery

- **Server restart**: all state is in `<DATA_DIR>/console.db`; the owner token is reused. Agents
  keep their tokens; a waiting `agentctl wait` retries transient errors until its timeout. The
  UI reconnects to `GET /api/stream` with the last seen `seq` and receives the missed events.
- **Agent restart (new Claude Code subagent for the same work)**: the lead either posts
  `runtime-event --type agent.resumed --agent <id>` (same agent record, same token) or registers a
  new agent instance, reassigns the task (`task set <taskId> --agent <newId>`) and hands over the
  new credentials plus a summary of the previous agent's answered questions. Questions of the
  old instance on a reassigned task answer `410` to the old agent.
- **Lost answer**: `leadctl inbox` lists submitted responses that no agent fetched after
  `LEAD_PICKUP_AFTER_SEC`; resume the agent with SendMessage carrying the answer and post
  `message.delivered --response <id>`.
- **Rotate the owner token**: stop the server, delete `<DATA_DIR>/owner-token`, start again.

## Tests

```sh
npm run typecheck -w tools/agent-console
npm test -w tools/agent-console                 # vitest: routes, SSE/long-poll over a real socket, git, MCP over stdio
npm run fixture:acceptance -w tools/agent-console   # end-to-end on a random port with a temp DATA_DIR; prints PASS/FAIL table
```

Fixture runs are stored with `kind: 'fixture'` and the API labels them (`run.fixture: true`);
`GET /api/state` without `runId` always prefers the latest **live** run.

## Known limitations

- Single process, single SQLite file; no multi-user, no TLS (localhost only by design).
- The git route reads local branches only (`refs/heads/*`); it does not fetch remotes.
- Questions never expire on a timer; they expire only when their task is integrated/verified or
  when superseded by the agent.
- `disconnected` is derived from staleness only; the console cannot observe a Claude Code
  subagent directly. `completed`/`failed` depend on the lead posting runtime events.
- The MCP server and the hook forwarder are untested inside a live Claude Code session.
- Secret redaction is pattern-based (`sk-…`, `ghp_…`, `Bearer …`, `AKIA…`) and will not catch
  arbitrary secrets.
