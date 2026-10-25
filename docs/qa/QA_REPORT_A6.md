# QA report A6 — integrated Milestone A and the Agent Build Console

Reviewer: E (independent QA / security), branch `wt/e-qa` from `integration` at `601ce29`.
Date: 2026-10-25. Machine: macOS 14 (Darwin 23.6.0), Node v25.9.0, high background load
(iCloud sync); generous timeouts were used and no failure below is attributed to load.

Rules followed: nothing outside `docs/qa/**` and `tests/e2e/**` was edited; no fix was applied,
defects are filed per owner; every command below was actually run and the result shown is the
real one. The live team console on port 4800 was used only for my own `agentctl status` /
`result` calls. All console scenarios ran on a separate instance (port 4810, own data dir).

Verdict in one line: **Milestone A and the console behave as the contracts say** on every
check I could run; 2 confirmed defects (1 medium, 1 low), 1 likely cause for the owner's UI
report, 1 previously filed defect **not reproduced**, plus 5 low-severity observations.

Reusable scripts added (plain Node, no dependencies):

| Script | Purpose |
| --- | --- |
| `tests/e2e/console-scenarios.mjs` | Drives two fake agents through `leadctl`/`agentctl` (distinct credentials) and probes the brief §9 scenarios with raw HTTP; `run` writes a snapshot, `compare` re-checks after a server restart. Refuses port 4800. |
| `tests/e2e/api-authz-smoke.mjs` | 56 checks against a seeded `apps/api`: sign-in failures, rate limiting, MFA gate (own RFC 6238 TOTP), role 403s, cross-team 404s, 409 version conflicts, schedule-import preview with bad rows, invite accept, recovery via the demo log, cookie tampering. Credentials only from env vars. |
| `tests/e2e/api-create-second-team.mjs` | Creates a second fictional demo team (season, opponent, game) through the API's built service layer so cross-team scoping can be probed. Refuses production. |

## Summary table

| # | Check | Result |
| --- | --- | --- |
| 1.1 | Console build + start on a separate instance | PASS (observation O-1 on relative data dir) |
| 1.2 | Brief §9 scenarios via `tests/e2e/console-scenarios.mjs run` | 33 PASS / 2 FAIL (both = defect D-1) |
| 1.3 | SIGTERM, restart from the same data dir, `compare` | PASS 4/4 (state, owner token, agent token, SSE replay) |
| 1.4 | `npm test -w tools/agent-console -w tools/agent-console-ui` | PASS 32/32 and 33/33 |
| 1.5 | `npm run fixture:acceptance -w tools/agent-console` | PASS 48/48 |
| 1.6 | Defect "`leadctl answer` parsing" (ACCEPTANCE_RUN) | REPRODUCED (and `leadctl git <id>` has the same bug) |
| 1.7 | Defect "malformed token 400 vs 401" (ACCEPTANCE_RUN) | NOT REPRODUCED (15 variants → 401; the only 400 came from Node's HTTP parser for an invalid header *name*, empty body) |
| 1.8 | Owner's UI report: queue item click opens the drawer | PASS at 1280×800 and 1024×700; likely cause found for narrower windows (D-2) |
| 2.1 | `npm run seed:demo -w apps/api`, build, start on 8792 | PASS (observation O-2: `start` needs a prior build) |
| 2.2 | `tests/e2e/api-authz-smoke.mjs` | PASS 56/56 |
| 2.3 | `npm test -w apps/api -w packages/contracts` | PASS 39/39 and 75/75 |
| 3.1 | `npm test -w apps/web` | PASS 58/58; six retained regressions mapped to named tests below |
| 3.2 | Accessibility (axe) on landing/dashboard | NOT RUN (A2 not integrated; the integrated `apps/web` is the prototype, which has no axe tests) |
| 4.1 | `npm test -w packages/media -w packages/ai` | PASS 60/60 and 37/37 |
| 4.2 | Code reading: no fabricated label/statistic when a provider is unavailable; unknown stays null | PASS (details in §4) |
| 5.1 | Secrets grep, `.gitignore`, tracked env/db files, demo names | PASS; `npm audit` advisories noted (O-5) |

## 1. Console communication and recovery (brief §9)

### 1.1 Build and start a separate instance

```
npm install                                            # worktree root; added 350 packages
npm run build -w tools/agent-console-ui && npm run build -w tools/agent-console
# exit 0; dist/assets/index-BcERbWwW.js 454.67 kB, tsc clean
CONSOLE_PORT=4810 CONSOLE_DATA_DIR=.data/wt-e-console npm run start -w tools/agent-console
# CONSOLE_URL=http://127.0.0.1:4810/#token=<redacted>
# CONSOLE_STATE=listening data_dir=.data/wt-e-console run=none
```

Observation O-1: with the relative value the data dir was created at
`tools/agent-console/.data/wt-e-console` (the workspace's cwd under `npm run -w`), not under the
repo root as the README's default suggests. It is still gitignored (`.data/` matches at any depth).
I restarted with an absolute `CONSOLE_DATA_DIR` for everything below.

### 1.2 Scenarios (two fake agents, distinct credentials)

```
node tests/e2e/console-scenarios.mjs run --url http://127.0.0.1:4810 \
  --data-dir "$PWD/tools/agent-console/.data/wt-e-console" --snapshot <scratch>/console-snapshot3.json
```

Result: **33 passed, 2 failed** (the two failures are the `leadctl` parsing defect, D-1). The
driver registers `qa-alpha` and `qa-beta` with `leadctl agent register` (two different tokens),
runs every normal step through `agentctl` with each agent's own env, and uses raw `fetch` for the
adversarial cases. Full output in Appendix A. What each §9 point got:

| §9 scenario | Independent check | Result |
| --- | --- | --- |
| Distinct identities, actual tasks | two ids/tokens differ; `agentctl status --task` from each → `execState working`, tasks `in_progress`; alpha's token on beta's path → 404 | PASS |
| Two simultaneous questions | `agentctl ask` from both (alpha `--blocking`); `GET /api/questions?status=open` → 2; alpha derived `waiting_for_you`, beta `working` | PASS |
| Each answer reaches only its agent | beta's token fetching alpha's question → 404 on its own path and on alpha's path; alpha's `agentctl wait --ack` returned its own response (`via agent_poll`) | PASS |
| Ack then continue | after `--ack`: `resumedAfterAck false`; after a later `agentctl status` → `true`; beta: `wait` (no ack) → `delivered`, `agentctl ack` → `acknowledged` (second ack idempotent, `changed:false`), `agentctl log` → `resumedAfterAck true` | PASS |
| Refresh preserves | `GET /api/state` → 2 agents, 2 tasks, 2 answered questions, 2 acknowledged responses | PASS |
| Duplicate submission | same `clientRequestId` → 200 with the same response id, one response row; new `clientRequestId` on the answered question → 409 `conflict` | PASS |
| Disconnected client recovers | `GET /api/stream?after=<mid seq>` replayed exactly the gap (9 frames, strictly increasing, no duplicates, other runs excluded, heartbeat comment present) | PASS |
| Agent failure stays visible | owner posts `agent.failed` → `execState failed`; beta self-reports `working` → still `failed`; `agent.resumed` → `working` (exercised against the running server, not a real subagent crash) | PASS |
| Obsolete question cannot resume | superseded question: `agentctl wait` exit 3, raw GET 410 `gone`, owner answer 409; task reassigned via `leadctl task set --agent` → old agent `wait` exit 3 / 410 "task was reassigned" | PASS |
| Unauthorized clients | no token 401 (owner and agent routes); wrong token 401; agent token on owner route 401; bad `Origin` with valid token 401, allowed Origin 200; auth runs before body validation | PASS |
| `report_task_result` cannot set integrated | `agentctl result --status completed` → `ready_for_review`; raw `status:'integrated'` → 400; agent PATCH `/api/tasks` → 401; owner `integrated` without `verificationId` → 400; same `clientRequestId` → `duplicate:true` | PASS |
| Secrets redacted | `sk-…`, `ghp_…`, `Bearer …` in an `agentctl log` message stored as `[redacted]` | PASS |

### 1.3 Server restart

```
kill -TERM <pid of :4810>            # "[console] shutting down"; port free after 2 s
CONSOLE_PORT=4810 CONSOLE_DATA_DIR=<abs> npm run start -w tools/agent-console
# CONSOLE_STATE=listening ... run=900de86f-...   (latest live run restored)
node tests/e2e/console-scenarios.mjs compare --url http://127.0.0.1:4810 --data-dir <abs> --snapshot <scratch>/console-snapshot3.json
```

```
PASS  restart: owner token still valid
PASS  restart: agents/tasks/questions/responses identical to pre-restart snapshot  -- 2 agents, 2 tasks, 5 questions, 4 responses, lastSeq 83
PASS  restart: agent token issued before the restart still works (agentctl status 200)  -- seq 84
PASS  restart: SSE replay from 0 returns every event of the run  -- replayed 36 frames (expected 36), last 84
4 passed, 0 failed, 0 skipped
```

The browser tab that was open on the instance showed `connected` again after the restart
without a reload (`get_page_text` on the top bar).

### 1.4 / 1.5 Unit tests and fixture acceptance

```
npm test -w tools/agent-console -w tools/agent-console-ui
#  Test Files 4 passed (4) / Tests 32 passed (32)    (runtime)
#  Test Files 5 passed (5) / Tests 33 passed (33)    (UI)
npm run fixture:acceptance -w tools/agent-console
#  48/48 checks passed (fixture run kind=fixture; temp data dir /var/folders/.../agent-console-fixture-INI8an)
```

### 1.6 Defect "`leadctl answer <id> …` fails" — REPRODUCED

```
node tools/agent-console/bin/leadctl.mjs answer f1040bff-6ee1-4f2b-b6ed-5b2fc68e83a0 --version 1 --option small
# error: unknown command "answer f1040bff-6ee1-4f2b-b6ed-5b2fc68e83a0"   (exit 1)
node tools/agent-console/bin/leadctl.mjs git d51d26e1-4146-497c-bba7-8e859b61fa31
# error: unknown command "git d51d26e1-4146-497c-bba7-8e859b61fa31"      (exit 1)
```

Cause (by reading, not fixed): `bin/leadctl.mjs` dispatches on
`` switch (`${cmd} ${sub ?? ''}`.trim()) `` while the `answer` and `git` cases expect `sub` to be
the id, so the key becomes `answer <id>`. `leadctl runs/state/inbox/questions` work. The owner
API itself works (used directly by the driver: 201).

### 1.7 Defect "malformed bearer token → 400 validation_error" — NOT REPRODUCED

Fifteen variants against `GET /api/state` (fetch and curl), all answered `401 unauthorized` with
the JSON envelope: `Bearer` (no token), `Bearer ` (empty), `Basic abc`, `Bearer a b`,
`Bearer %`, `Bearer abc"def`, `Bearer abc;def`, `Bearer abc,def`, `Bearer=abc`, a 5000-char
token, `Bearer ümlaut`, the bare owner token without a scheme, two `Authorization` headers,
`?token=` in the query, and a bad token on POST routes with a bad body (401, not 400). The only
400 observed was for the header **name** `authorization : Bearer abc` (space before the colon):
Node's HTTP parser rejects it before the app runs and the body is empty, not the app's
`validation_error` envelope. Suggest the lead attach the exact request that produced
`400 validation_error`; otherwise this entry can be closed as not reproducible on `601ce29`.

### 1.8 Owner's UI report (queue item does not open the drawer)

Playwright is not installed locally (`npx --no-install playwright --version` → "npx canceled
due to missing packages"; no `~/Library/Caches/ms-playwright`), so I did not install it. I used
the Claude Code browser pane (Chromium) with viewport emulation on the built UI at
`http://127.0.0.1:4810/#token=…` with two open questions from a third fake agent `qa-gamma`.

| Viewport | Action | Observed |
| --- | --- | --- |
| 1280×800 | click first queue item (blocking) | drawer opens on the right (360 px), question card focused with options, text box and **Submit answer**; `Close details` visible |
| 1024×700 | close, click second item | same; both cards listed under "QUESTIONS 2 OPEN" |
| 900×700, 760×600, 640×600 | drawer already open | `.app { min-width: 1024px }` keeps the layout at 1024 CSS px; measured `.drawer` at x = 664–1024 and `Close` at x = 956–1012, so the right part of the drawer is outside the visible area |

So at 1280×800 and 1024×700 the click works (PASS). Likely cause of the owner's experience
(D-2, not confirmed because the owner's window size was not captured): in a window narrower
than about 1012 px the `Close` control is off-screen, narrower than about 720 px the Submit
button is too, and narrower than 664 px the whole drawer is outside the viewport, so clicking a
queue item visibly does nothing (only a horizontal scrollbar appears). A console shown in a
side pane of the desktop app easily falls in that range. Minor (D-3): when a queue item is
opened, the focused card is scrolled so that its first line sits under the sticky drawer header.

## 2. API authorization and failure paths (`apps/api`)

```
FOOTBALLOS_DATA_DIR="$PWD/.data/wt-e" FOOTBALLOS_ENV=demo PORT=8792 npm run seed:demo -w apps/api
# exit 0: team "Winchester Hawks (demo)", season 2026, games=8 + 1 bye, opponents=8, six staff; passwords and TOTP secrets printed once (kept in a scratch file, not in this repo)
FOOTBALLOS_DATA_DIR="$PWD/.data/wt-e" FOOTBALLOS_ENV=demo PORT=8792 npm run start -w apps/api
# FAILS: "node dist/server.js" — no dist yet (O-2; README does say build first)
npm run build -w apps/api && FOOTBALLOS_DATA_DIR="$PWD/.data/wt-e" FOOTBALLOS_ENV=demo PORT=8792 LOG_LEVEL=info npm run start -w apps/api
# {"ok":true,"environment":"demo","version":"0.1.0"} on /healthz; log: modelProvider none, modelKeyConfigured false
FOOTBALLOS_DATA_DIR="$PWD/.data/wt-e" FOOTBALLOS_ENV=demo node tests/e2e/api-create-second-team.mjs
# {"teamId":"1b634531-…","seasonId":"b4be7902-…","gameId":"309c442f-…"}
FOS_URL=http://127.0.0.1:8792 FOS_HC_EMAIL=… FOS_HC_PASSWORD=… FOS_HC_TOTP=… FOS_OC_… FOS_PC_… \
  FOS_OTHER_TEAM_ID=1b634531-… FOS_OTHER_GAME_ID=309c442f-… FOS_LOG=<scratch>/api-8792.log node tests/e2e/api-authz-smoke.mjs
# 56 passed, 0 failed, 0 skipped   (full output in Appendix B)
npm test -w apps/api -w packages/contracts
#  Test Files 4 passed (4) / Tests 39 passed (39)    (api: units, schedule, authz, auth)
#  Test Files 1 passed (1) / Tests 75 passed (75)    (contracts schemas)
```

What the smoke established (all PASS):

- Sign-in: wrong password and unknown e-mail give the same `401 unauthorized` envelope and no
  cookie; malformed and non-JSON bodies → `400 validation_error` with `details.issues`.
- Rate limiting: 10 failures for one e-mail → `429 rate_limited` with `details.retryAfterSec`
  (893); another e-mail from the same IP still signs in (limiter key is IP + e-mail).
- Session cookie `fos_session`: `HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`; tampered
  cookie → 401; sign-out clears it and the old session is rejected; `passwordHash` never serialized.
- MFA gate: head coach sign-in → `mfaRequired:true`; protected route → `401` with
  `details.mfaRequired`; `/auth/me` still allowed; wrong TOTP 401; correct TOTP (computed by the
  script's own RFC 6238 implementation from the seed secret) → `mfaVerified:true`, then full access.
- Roles: position coach → 403 on invite create/list, audit read, season create, game PATCH,
  schedule import, self-promotion via PATCH staff; coordinator → 403 on invite create but may
  create an opponent (§13 lead decision).
- Team scoping: random team id and the real second team → 404 `not_found` on team, staff,
  seasons, game read and game write (never 403, no existence leak).
- Version conflict: PATCH game with the current version → 200, version+1; stale
  `expectedVersion` → `409 conflict` with `details.currentVersion`; `final` without a result →
  409 "A final game needs a result"; score/outcome mismatch → 400.
- Schedule import preview: 4 row errors reported (bad date, missing opponent, duplicate week,
  non-numeric week) with row/column, 1 valid row kept; apply with errors → 409; discard → `discarded`;
  CSV without an opponent column → row-1 error, not a crash.
- Invite flow: create → 201 with a one-time token; list never returns the token; short
  password 400; unknown token 404 without a session; accept → 201 signed in as position coach;
  second accept refused; audit shows `invite.created`, `invite.accepted`.
- Recovery: request → 202 for known and unknown e-mail, body has no token; in `demo` the token
  is in the server log as `unredacted_recovery_token` with the "demo/development only" warning;
  wrong token refused; completion → 200; old password rejected, new accepted, pre-recovery
  session revoked; token single-use.
- Unauthenticated `jobs`, `assets`, `media/*/stream`, `plans`, `export.pdf` paths → 401/404, never 200.

README promises I could not exercise live: research/production "token not delivered" logging,
idle (12 h) and absolute (30 d) session expiry — covered by the unit suite only (NOT RUN by me).
Observation O-3: right after seeding, the head coach's audit log is empty (seed-time memberships
and MFA enrollment write no audit rows); user-driven invite actions do appear.

## 3. Prototype regressions (`apps/web`)

```
npm test -w apps/web
#  Test Files 4 passed (4) / Tests 58 passed (58)   (recommendation 10, landing 12, regressions 17, workflow 19)
```

The six retained regressions from the brief, each covered by named tests that ran green:

| Regression | Named tests (file › `it(...)`) |
| --- | --- |
| Grade 1/2 without an actionable reason prompts clarification | `regressions.test.tsx` › "reproduces the reported Grade 1 / "AI misread" case as "clarify", never "maintain"" · "the reported scenario, driven through the UI, lands on "clarify" with a working Reopen action" |
| Grade 3 corrections do not become deficiencies | `recommendation.test.ts` › "never turns a correction to Grade 3 into a player deficiency" · `regressions.test.tsx` › "D: two plays with the same technique reason are recurring; a Grade 3 correction never joins them" |
| No Grade remains separate from poor performance | `regressions.test.tsx` › "A: every reviewed play No Grade is insufficient evidence with a film next step" · `recommendation.test.ts` › "excludes No Grade and unreviewed plays from the recommendation and says so" · `workflow.test.tsx` › "shows an insufficient-evidence state when every reviewed play is No Grade" · "abstains on the degraded snap, says what would make it gradable, and needs a reason to accept No Grade" |
| Review time is preserved across reopened plays | `regressions.test.tsx` › "reopening a play adds to its time, and repeated saves never double-count" · "a reload with an interval open closes it at the last heartbeat instead of losing or inventing time" · "the review screen opens and closes intervals as the coach moves between plays" · "legacy sessions keep their latest-visit seconds but get no fabricated cumulative time" |
| Demo / research / production records remain distinct | `landing.test.tsx` › "a demo session starts without any baseline and is never research data" · "demo mode behaves like the real workflow: a decision, the demo note on the summary, and mode in the export" · `regressions.test.tsx` › "results screen and export say "No baseline collected in demo mode" with no revision control or timestamp". The prototype has no production mode; the `environmentKind` enum (`demo|research|production`) is enforced by `packages/contracts` › `schemas.test.ts` (Team with `environmentKind: 'prod'` rejected) and shown by `apps/api` › `authz.test.ts` (`environmentKind` `demo` on the listed team) |
| Research baseline wording and collection remain honest | `regressions.test.tsx` › "#/research shows the neutral baseline form first, with an empty field and no anchors, and records "not sure" as missing" · "entering research from the landing page records that example output was shown first" · "a later revision is stored separately and the original submission is untouched" · "is suppressed for a missing baseline, a "not sure" baseline, a partial review and a legacy session" · `workflow.test.tsx` › "captures the baseline before the review task starts" · "blocks Begin Review until the baseline is complete and explains why" |

Accessibility (axe on landing and dashboard) is an A2 acceptance criterion; A2 is not integrated
yet and the integrated `apps/web` is still the Module 7 prototype, so this was NOT RUN.

## 4. Media and AI packages

```
npm test -w packages/media -w packages/ai
#  media: Test Files 5 passed (5) / Tests 60 passed (60)   (jobs 12, probe 16, segments 14, quality 9, proxy 9; ffmpeg fixtures)
#  ai:    Test Files 6 passed (6) / Tests 37 passed (37)   (anthropic-labeler 11, stubs 3, frames 3, stats 8, config-budget 6, eval 6)
```

Fabrication check (by reading `packages/ai/src/labeler/null.ts`, `anthropic.ts`, `openai.ts`,
`validate.ts`, `factory.ts`, `stats/resolve.ts`, `stats/findings.ts`) — PASS:

- `NullLabeler.labelSegment` always throws `ProviderUnavailableError(no_api_key)`; the OpenAI
  adapter is a stub that throws the same; `createVisionLabeler` never substitutes a provider.
- `AnthropicVisionLabeler` without a key throws `provider_unavailable(no_api_key)` before any
  work; transport errors are mapped to `auth | rate_limited | bad_request | server_error |
  unknown`; `stop_reason refusal` → `provider_unavailable(refusal)`; `max_tokens` →
  `truncated_output`; non-JSON text → `invalid_model_output`. No `fallbacks` model switching
  (README says why), so `ModelProvenance.model` is always the model that answered.
- `validateLabelResponse` rejects unrequested or duplicate keys, evidence timestamps that were
  not among the inspected frames, abstained entries with a value, null values not marked
  abstained, non-null values without evidence, and values outside the closed vocabulary; a
  requested key the model omitted becomes an explicit abstention (`value null, abstained true`)
  with a rationale saying so. No default value is ever filled in.
- Statistics: `resolveLabelValue` returns `value: null` with an exclusion reason for
  `unknown`, `rejected`, unreviewed-under-`reviewed_only`, abstained or missing inferred values,
  and treats the literal string "unknown" or an empty string as unknown; `percentOf` returns
  `null` for a zero denominator; segments with `unit === null` are excluded as `unknown`.

Unverified lists, as the READMEs state them (not re-verified by me, no footage or key exists):
AI — no real model call made (first live call may surface schema issues, e.g. `uncertainty`
enum with `null`), price table dated 2026-10-25 and `null` cost for unknown models, OpenAI
adapter stub / Qwen3-VL on paper only, `types.ts` duplicates contract shapes, `StatSegment.unit`
must be derived by the API layer. Media — runtime/memory on a 90–180 min 1080p file, adaptive
thresholds on real sideline film, VFR/edit-list proxy timing, 8 GB / 4 h limits only unit-tested
with substituted probe values, HEVC/MKV accepted without a fixture.

## 5. Security smoke

```
git grep -nE "sk-[A-Za-z0-9_-]{10,}|ghp_[A-Za-z0-9]{10,}|AKIA[0-9A-Z]{12,}|token=[A-Za-z0-9]{16,}" -- . ':!package-lock.json'
# only hits: tools/agent-console/src/test/routes.test.ts (2) and scripts/fixture-acceptance.mjs (1) — inputs to the redaction tests
git ls-files | grep -E "(^|/)\.env($|\.)|(^|/)\.data/|\.db$|\.sqlite$|owner-token" | grep -v "\.env\.example$"
# (none)
git check-ignore -v .data/x apps/api/.env tools/agent-console/.data/wt-e-console/owner-token .env.local
# .gitignore:21 .data/ · :28 .env · :21 .data/ · :29 .env.*
git grep -nohE "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}" -- . ':!package-lock.json' | grep -vE "\.(test|example|invalid|localhost)$|noreply@anthropic|footballos\.test|@demo\."
# (none)
```

Demo seed (`apps/api/src/scripts/seed-demo.ts`): team "Winchester Hawks (demo)", staff
`Demo Head Coach` … `Demo Analyst` at `@demo.footballos.test`, eight invented opponents
(Riverbend Otters, Cedar Hollow Lynx, …). No real names or e-mail domains. The console's
`.env.example` and `apps/api/.env.example` contain only empty placeholders. The seed prints
passwords and TOTP secrets once to stdout and stores only hashes (verified: the DB-backed smoke
signed in with the printed values and the invite list never returned a raw token).

Observation O-5 (`npm audit` after `npm install`): 9 advisories — 2 critical (`vitest`
direct dev dependency via `@vitest/mocker`; `tinypool` transitive), 1 high (`vite`), 6 moderate
(`esbuild`, `vite-node`, `drizzle-kit` → `@esbuild-kit/*`). All are build/test toolchain
packages, none is a runtime dependency of `apps/api`, `packages/*` or the console server.

## Defects (filed, not fixed)

| ID | Owner | Severity | Title | Reproduction |
| --- | --- | --- | --- | --- |
| D-1 | console runtime | medium | `leadctl answer <questionId>` and `leadctl git <agentId>` are unusable: the command switch is keyed on `"<cmd> <sub>"`, and for these two commands `sub` is the id. | `node tools/agent-console/bin/leadctl.mjs answer <qid> --version 1 --option a` → exit 1 `unknown command "answer <qid>"`; same with `git <agentId>`. Confirms the ACCEPTANCE_RUN entry and widens it to `git`. Suggested fix (not applied): dispatch `answer`/`git` on `cmd` alone. |
| D-2 | console UI | medium (likely cause of the owner's report; unconfirmed) | Drawer is partly or wholly outside the viewport in windows narrower than the layout's 1024 px `min-width`: `.drawer` sits at x 664–1024, `Close` at 956–1012. Below ~1012 px `Close` is hidden, below ~720 px `Submit answer` is hidden, below 664 px nothing visible changes when a queue item is clicked. | Open the built UI in a window ≤ 660 px wide (or emulate 640×600), click a queue item; compare with 1024×700 where it works. Measured with `getBoundingClientRect()` on `.drawer` and the `Close` button. Suggested direction: let the drawer overlay the graph below ~1100 px or drop `min-width`. |
| D-3 | console UI | low | Opening a question from the queue scrolls the focused card under the sticky drawer header; its first line (the question text) is hidden until the user scrolls up a little. | 1280×800 or 1024×700, click any queue item, look at the top of the drawer. |
| D-4 | console runtime (docs) | low | Relative `CONSOLE_DATA_DIR` is resolved against the package directory when started with `npm run start -w tools/agent-console` (`data_dir=.data/wt-e-console` printed, created under `tools/agent-console/.data/`). README implies repo-root relative. Still gitignored. | See §1.1. Suggest resolving against `CONSOLE_REPO_ROOT` or documenting "use an absolute path". |

## Observations (no action required unless the owner disagrees)

| ID | Owner | Note |
| --- | --- | --- |
| O-1 | console runtime | Task ids are global across runs: creating a task with an id that exists in an earlier run → `409 conflict "task id already exists"`. CONTRACT §4.1 (`POST /api/tasks { runId, id? }`) does not state the scope; a future run cannot reuse `A1`. |
| O-2 | backend | `npm run start -w apps/api` has no `prestart` build and fails with a fresh checkout until `npm run build -w apps/api` runs (README does say so). |
| O-3 | backend | After `seed:demo`, `GET /teams/:id/audit` is empty: seed-time memberships and MFA enrollment write no audit rows. User-driven invite/accept rows appear as promised. |
| O-4 | console runtime | The ACCEPTANCE_RUN "malformed token → 400" defect did not reproduce on `601ce29` (§1.7). |
| O-5 | lead / F | `npm audit`: 9 advisories, all in dev toolchain (`vitest`, `tinypool`, `vite`, `esbuild`, `drizzle-kit`); consider upgrading `vitest`/`vite` at the next integration. |
| O-6 | lead | ACCEPTANCE_RUN's "agent failure" scenario is now exercised against a running server with runtime events (fails stays failed through a self-report; cleared by `agent.resumed`), still not with a real subagent crash. The lead-continuation path (`message.delivered`, `via lead_continuation`) remains fixture-only; my driver did not add a live check for it. |

## Not run

- Accessibility checks (A2 not integrated).
- Playwright end-to-end (not installed locally; browser pane used instead).
- Research/production recovery-token logging path and session idle/absolute expiry (unit-tested only).
- Any paid model call, any full-game footage processing.

## Appendix A — `console-scenarios.mjs run` output (third, clean run)

```
console http://127.0.0.1:4810, data dir /Users/zachariahparkhill/Desktop/Developing AI Solutions/FootballOS/.worktrees/e-qa/tools/agent-console/.data/wt-e-console
PASS  healthz  -- {"ok":true,"serverTime":"2026-10-25T17:47:14.029Z"}
PASS  leadctl run create  -- 900de86f-4fec-4b65-b025-e95de17a82de
PASS  leadctl agent register x2 returns distinct ids and tokens  -- d51d26e1-4146-497c-bba7-8e859b61fa31 / 2324f66c-07f4-44d0-9464-93f8e0763cb6
PASS  leadctl task create x2  -- ready / ready
PASS  two agents appear with distinct identities and their own tasks  -- alpha=working beta=working; T1=in_progress T2=in_progress
PASS  agent token on another agent path (wrong :agentId) -> 404
PASS  both agents ask simultaneously; two open questions in the queue  -- open=2
PASS  blocking question derives execState waiting_for_you (alpha), beta stays working  -- alpha=waiting_for_you beta=working
FAIL  DEFECT CHECK: leadctl answer <questionId> works  -- exit 1: error: unknown command "answer f1040bff-6ee1-4f2b-b6ed-5b2fc68e83a0"
FAIL  DEFECT CHECK: leadctl git <agentId> works  -- exit 1: error: unknown command "git d51d26e1-4146-497c-bba7-8e859b61fa31"
PASS  owner answers both questions (201)  -- A=201 B=201
PASS  cross-agent fetch of another agent question -> 404 (own path) and 404 (other path)  -- 404/404
PASS  alpha long-poll receives its own answer and acks (agentctl wait --ack)  -- exit 0 state=acknowledged via=agent_poll
PASS  after ack, resumedAfterAck is false until later activity  -- state=acknowledged resumed=false
PASS  resumedAfterAck becomes true after a later agent.status from the same agent  -- resumed=true
PASS  beta fetch marks delivered via agent_poll (no ack yet)  -- state=delivered via=agent_poll
PASS  beta ack -> acknowledged; repeat ack idempotent (200)  -- state=acknowledged resumed=false changed2=false
PASS  resumedAfterAck true after agent.log
PASS  same clientRequestId -> same response id (200), new clientRequestId on answered question -> 409  -- 200/true/409
PASS  duplicate did not create a second response
PASS  /api/state (refresh) reproduces agents, tasks, questions and responses  -- agents=2 tasks=2 answered=2 acked=2
PASS  SSE replay from earlier seq returns exactly the gap, in order, no duplicates  -- after=58: got 9 frames [59..67], expected 9
PASS  SSE frames carry id/event/data and a heartbeat comment  -- hb=true
PASS  SSE replay excludes events of other runs
PASS  agent.failed -> execState failed, stays failed despite self-report, cleared by agent.resumed  -- failed -> failed -> working
PASS  superseded question: agentctl wait exits 3 (410 gone), owner answer -> 409  -- wait exit 3, raw 410 gone, answer 409
PASS  task reassigned to another agent: old agent gets 410 (agentctl exit 3)  -- reassign exit 0; wait exit 3; raw 410 task was reassigned to another agent
PASS  no token -> 401 (owner and agent routes)  -- 401/401
PASS  wrong token -> 401 (owner and agent routes); agent token on owner route -> 401  -- 401/401/401
PASS  bad Origin with valid owner token -> 401; allowed Origin -> 200  -- 401/200
PASS  DEFECT CHECK: malformed Authorization headers answer 401 (not 400)  -- Bearer=401 unauthorized; Basic abc=401 unauthorized; Bearer two words=401 unauthorized; Bearer <empty>=401 unauthorized; bare token (no scheme)=401 unauthorized; Bearer non-ascii=401 unauthorized
PASS  auth check runs before body validation (bad token + bad body -> 401, not 400)  -- 401/401
PASS  report_task_result completed -> ready_for_review; status integrated rejected (400); agent PATCH -> 401; owner integrated without verification rejected  -- task=ready_for_review forged=400 agentPatch=401 ownerNoVerif=400 validation_error
PASS  report_task_result with the same clientRequestId is a duplicate (no second result)  -- duplicate=true
PASS  secret-looking strings in agent messages are redacted in stored events  -- "token [redacted] and [redacted] and [redacted]"
snapshot written to /private/tmp/claude-501/-Users-zachariahparkhill-Desktop-Developing-AI-Solutions-FootballOS/9135af88-b578-4ebc-adf9-ce3c8b368c06/scratchpad/console-snapshot3.json (run 900de86f-4fec-4b65-b025-e95de17a82de)

33 passed, 2 failed, 0 skipped
```

## Appendix B — `api-authz-smoke.mjs` output

```
PASS  GET /healthz is public and labels the environment  -- {"ok":true,"environment":"demo","version":"0.1.0","now":"2026-10-25T17:42:51.971Z"}
PASS  unauthenticated GET /api/v1/teams -> 401 unauthorized
PASS  unauthenticated GET /api/v1/auth/me -> 401
PASS  wrong password -> 401 unauthorized, no cookie set  -- 401 unauthorized
PASS  unknown e-mail -> same 401 envelope as wrong password (no account enumeration)  -- 401 "Invalid e-mail or password"
PASS  malformed sign-in body -> 400 validation_error with issues  -- 400 validation_error
PASS  non-JSON body -> 400 (not 500)  -- 400 validation_error
PASS  repeated failed sign-ins -> 429 rate_limited with details.retryAfterSec  -- after 1 attempts; retryAfterSec=844
PASS  rate limit is per e-mail (another account from the same IP still signs in)  -- 200
PASS  position coach sign-in -> 200 with AuthState and memberships  -- mfaRequired=false enroll=false
PASS  session cookie is HttpOnly + SameSite=Lax and the body never carries a password hash  -- fos_session=<redacted>; Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax
PASS  GET /teams lists only the demo team, labeled environmentKind=demo  -- Winchester Hawks (demo)
PASS  position coach creating an invite -> 403 forbidden  -- 403 forbidden
PASS  position coach listing invites -> 403
PASS  position coach reading audit log -> 403
PASS  position coach can read seasons (any membership)  -- 1 seasons
PASS  position coach creating a season -> 403
PASS  games list carries the computed season record  -- {"wins":0,"losses":0,"ties":0,"played":0}
PASS  position coach PATCH /games/:id -> 403
PASS  position coach schedule import preview -> 403
PASS  position coach promoting themself via PATCH staff -> 403  -- 403
PASS  non-member team id -> 404 not_found (never 403), also on a write route  -- 404/404
PASS  existing other team -> 404 on team, staff, seasons, game read and game write (no existence leak)  -- 404/404/404/404/404
PASS  tampered session cookie -> 401
PASS  sign-out clears the cookie and the old session is rejected afterwards
PASS  head coach sign-in -> 200 with mfaRequired=true  -- mfaRequired=true
PASS  MFA-pending session on a protected route -> 401 with details.mfaRequired  -- 401 {"mfaRequired":true}
PASS  MFA-pending session may still call /auth/me
PASS  wrong TOTP -> 401 (mfaRequired)  -- 401
PASS  correct TOTP -> 200 mfaVerified  -- 200 {"mfaVerified":true}
PASS  after MFA the head coach reaches protected routes
PASS  head coach reads the audit log (paginated)  -- 0 items
PASS  PATCH game with current version -> 200 and version+1; stale expectedVersion -> 409 conflict with currentVersion  -- 200 v2; 409 conflict current=2
PASS  final without a result (or other disallowed transition) is refused, not stored  -- 409 conflict A final game needs a result
PASS  score/outcome inconsistency is rejected with 400 validation_error  -- 400 validation_error
PASS  schedule import preview reports row errors (bad date, missing opponent, duplicate week, bad week) and keeps valid rows  -- status=previewed errors=4 rows=1: r2 date, r3 opponent, r3 week, r4 week
PASS  apply with row errors and skipInvalidRows=false -> 409 conflict  -- 409 conflict
PASS  discard import -> status discarded  -- discarded
PASS  CSV without an opponent column is a row-1 error, not a crash  -- 201 could not find an opponent column (headers: a, b)
PASS  head coach creates an invite -> 201 with a one-time token  -- 201
PASS  open invites list never returns the raw token
PASS  accept with a short password -> 400 validation_error
PASS  accept with an unknown token -> 404 (or 410) and no session  -- 404 not_found
PASS  accept invite -> 201, signed in as the new position coach of the demo team  -- 201 role=position_coach
PASS  accepting the same invite twice is refused  -- 404 not_found
PASS  invitee session works on /auth/me
PASS  audit log records invite created and accepted  -- actions: invite.accepted, invite.created
PASS  recovery request -> 202 for known and unknown e-mail alike (no enumeration), body carries no token  -- 202/202 {"accepted":true}
PASS  demo environment writes the recovery token to the server log (field unredacted_recovery_token) with a demo/development-only warning  -- token found in log (not shown)
PASS  recovery complete with a wrong token is refused  -- 404 not_found
PASS  recovery complete with the logged token -> 200  -- 200
PASS  old password rejected, new password accepted, pre-recovery session revoked  -- old=401 new=200 oldSession=401
PASS  recovery token is single-use  -- 404 not_found
PASS  coordinator sign-in + TOTP -> reaches /teams
PASS  coordinator creating an invite -> 403 (head coach only)
PASS  coordinator may create an opponent (schedule management)
PASS  usage route returns zeros until cost rows exist  -- {"teamId":"a65147a5-c483-43b1-b3d6-583e5ca4cda8","month":"2026-10","inputTokens":0,"outputTokens":0,"costUsd":0,"monthly
PASS  unauthenticated media/export/jobs routes are not reachable (404 not implemented, never 200)  -- teams=401 assets=401 media=401 games=401 plan-versions=401

56 passed, 0 failed, 0 skipped
```

## Appendix C — malformed Authorization probes (curl, port 4810)

```
Authorization: Bearer              -> {"error":{"code":"unauthorized","message":"unauthorized"}} HTTP 401
Authorization: Bearer              -> {"error":{"code":"unauthorized","message":"unauthorized"}} HTTP 401
Authorization: Basic abc           -> {"error":{"code":"unauthorized","message":"unauthorized"}} HTTP 401
Authorization: Bearer a b          -> {"error":{"code":"unauthorized","message":"unauthorized"}} HTTP 401
Authorization: Bearer %            -> {"error":{"code":"unauthorized","message":"unauthorized"}} HTTP 401
Authorization: Bearer abc"def      -> {"error":{"code":"unauthorized","message":"unauthorized"}} HTTP 401
Authorization: Bearer abc;def      -> {"error":{"code":"unauthorized","message":"unauthorized"}} HTTP 401
Authorization: Bearer abc,def      -> {"error":{"code":"unauthorized","message":"unauthorized"}} HTTP 401
Authorization: Bearer=abc          -> {"error":{"code":"unauthorized","message":"unauthorized"}} HTTP 401
Authorization: Bearer aaaaaaaaaaaa -> {"error":{"code":"unauthorized","message":"unauthorized"}} HTTP 401
Authorization: Bearer ümlaut      -> {"error":{"code":"unauthorized","message":"unauthorized"}} HTTP 401
authorization : Bearer abc (bad name) ->  HTTP 400
two Authorization headers          -> {"error":{"code":"unauthorized","message":"unauthorized"}} HTTP 401
?token=abc (query, no header)      -> {"error":{"code":"unauthorized","message":"unauthorized"}} HTTP 401
POST agent/status, Bearer abc, body {} -> {"error":{"code":"unauthorized","message":"unauthorized"}} HTTP 401
```
