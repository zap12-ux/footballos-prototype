# Brief K5 — Console defect fixes D-1 to D-4 (runtime + UI)

Read `COMMON.md`, `tools/agent-console/CONTRACT.md`, `docs/qa/QA_REPORT_A6.md` (defects table)
and `docs/console/ACCEPTANCE_RUN.md`. Worktree:
`/Users/zachariahparkhill/Projects/FootballOS/.worktrees/k5-console`, branch `wt/k5-console`.
Allowed paths: `tools/agent-console/**`, `tools/agent-console-ui/**`. The live console on port
4800 is in use by the team: never start your instance on 4800; use `CONSOLE_PORT=4811` and
`CONSOLE_DATA_DIR=<absolute>/.data/wt-k5-console`.

## Fixes
- D-1 (runtime, medium): `leadctl answer <qid> …` and `leadctl git <agentId>` fail with
  `unknown command "answer <id>"` because the dispatcher keys on `"<cmd> <sub>"`. Fix dispatch so
  single-word commands with a positional argument work; add a unit test that drives `leadctl`
  `answer` and `git` end to end against a temp server; also add them to
  `scripts/fixture-acceptance.mjs`.
- D-2 (UI, medium): `.app { min-width: 1024px }` keeps the drawer off-screen in narrower windows.
  Make the layout usable from 720 px up: the drawer becomes an overlay panel (full height, max
  width 480 px, close button always visible, Escape closes, focus trapped and returned) below
  1180 px; the queue collapses to a toggle below 960 px; remove the hard min-width. Add tests for
  the breakpoint behaviour (class/attribute switches) and keep the graph usable.
- D-3 (UI, low): opening a question from the queue scrolls the card under the sticky drawer
  header; use `scroll-margin-top` equal to the header height or scroll the container with an
  offset. Test it.
- D-4 (runtime docs/behaviour, low): resolve a relative `CONSOLE_DATA_DIR` against the repo root
  (walk up to the nearest `package.json` with `workspaces`), not the package dir; document it.
- Also: the acceptance record's "Response unfetched after LEAD_PICKUP_AFTER_SEC" nudges showed
  agents poll rarely; add `agentctl wait` option `--poll-until-answered` that keeps long-polling
  with `wait=25` and prints a heartbeat line every 5 minutes, so an agent can block on an answer
  cheaply when it has nothing else to do. Document it in README and COMMON protocol notes.

## Verification
`npm run typecheck -w tools/agent-console -w tools/agent-console-ui`, `npm test` for both,
`npm run fixture:acceptance -w tools/agent-console` (extended), and a browser check of the UI at
1280×800, 1024×700 and 800×600 against your own instance (built UI served by your server); record
what you ran. Do not touch the live run.

## Handoff
Standard format; list each defect with before/after evidence.
