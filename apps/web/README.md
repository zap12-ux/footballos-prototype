# FootballOS web app

`apps/web` is the FootballOS product shell: a public landing page, sign-in and the
authenticated team workspace, built against `docs/team/CONTRACTS.md`. The graded Module 7
usability prototype is preserved inside it, unchanged, as the film-review demo flow under
`/prototype/` (its own documentation follows below under **Module 7 prototype**).

## Product shell (A2)

### Routes (react-router 7, path-based, refresh-safe)

| Path | Screen |
| --- | --- |
| `/` | Public landing page: product explanation, hero montage (see below), **Sign in** and **Try the demo** (→ `/prototype/#/demo`). |
| `/sign-in` | Email + password, then the MFA code step, with account recovery. Invite-only: there is no self-registration (the first head coach is created by the API's CLI). |
| `/app` | Dashboard: this week's game, open tasks, recent film, plan statuses. |
| `/app/schedule` | Season table, record from final games only, manual add/edit, CSV import preview → apply. |
| `/app/film` | Our Team Film: upload context form, processing progress, rejection reasons, proposed play list. |
| `/app/scouting` | Opponent Scouting: opponent/unit selector, findings with denominators and review-basis flags, uncertain findings apart. |
| `/app/plans` | Weekly Game Plans: unit tabs, CONTRACTS §11 section templates, draft / in review / approved versions, comments. |
| `/app/playbook` | Documents, versions, proposed vs approved concepts with sources. |
| `/app/personnel` | Roster, depth chart, packages with availability. |
| `/app/staff` | Members, roles, invitations. |
| `/app/settings` | Team details, media retention, your account. |
| `/prototype/*` | The Module 7 prototype with its hash routes `#/`, `#/demo`, `#/research`. `/demo/film-review` redirects here. |
| anything else | 404 page. |

Unauthenticated visits to `/app/*` redirect to `/sign-in?next=…` and return afterwards.
The workspace context (`?team=&season=&game=&unit=`) lives in the URL and is mirrored in a
small store (`src/workspace/store.ts`), so every page agrees on team, season, game and unit
and links between pages carry it. The router `basename` comes from Vite's `BASE_URL`; the
production build copies `index.html` to `404.html` so GitHub Pages serves deep links.

### API modes

`VITE_API_MODE=mock` (default) serves the fictional **Winchester Hawks (demo)** team from
`src/api/mock/`; the team's `environmentKind` is `demo` and every screen shows the label.
Demo sign-in: any listed demo account, password `demo`, verification code `246810` (shown
on the sign-in screen in mock mode only). Mutations made in mock mode are written through to
`localStorage` (`footballos.mock.v1`, see `src/api/mock/persistence.ts`) after every writing
call, so approved plans, comments, label corrections and uploads survive a browser reload;
the envelope carries a schema version and a fingerprint of the seed, and a change to either
discards stale state. **Reset demo data** on `/app/settings` (demo team only) clears it after
a confirmation that lists what goes (iteration 1: OC-01, PC-04). `VITE_API_MODE=http` uses `src/api/http.ts`
against `/api/v1` (Vite proxies `/api` and `/media` to `http://localhost:8789`, override
with `VITE_API_PROXY_TARGET`).

`src/api/http.ts` is `hc<AppType>` from `hono/client`, typed by the API's own route table
(`import type { AppType } from '@footballos/api'`, type-only). Every route the API implements
(auth, teams, staff, invites, seasons, opponents, games, schedule imports, and the CONTRACTS
§14 uploads, jobs, grants, segments, labels, scouting and settings) is called through the
typed client, so a server-side change to a path, parameter or response shape fails
`npm run typecheck -w apps/web`. Routes the API has not implemented yet (plans, playbook,
personnel) go through a small `raw()` helper with the same error-envelope handling and move
to the typed client as each lands in `AppType`.
`src/api/contracts.ts` re-exports every type from `@footballos/contracts` (aliased to the
package source in `vite.config.ts` and `tsconfig.json`) and adds only coach-facing constants
(`UNIT_LABELS`, `LABEL_KEY_LABELS`, plan section templates) and pure helpers.

### Film workflow (Milestone B, task B3)

`/app/film` lists the film attached to the selected game; `/app/film/:assetId` is the asset
view. In mock mode the same screens run on demo data: a reviewed Westmoor game with 48
proposed plays, 384 labels (12 plays carry model output with provenance, four are reviewed,
the rest are `unknown` so a coach can enter them), jobs in every state, and a simulated
worker that advances a job one step per poll.

1. **Upload** (`src/film/uploadClient.ts`, CONTRACTS §14.1). The context form asks four
   questions once (whose film, unit, camera, how to tell the teams apart). Files under 2 GB
   are fingerprinted (sha256) in a Web Worker with `crypto.subtle` so an exact duplicate is
   refused before any byte moves; larger files skip the hash and the status says so (the
   server still hashes on completion). Bytes go as `PUT /uploads/:id` ranges of the server's
   `chunkSizeBytes` (`UPLOAD_CHUNK_BYTES`, 8 MiB in the demo) from `File.slice`. A `409` with
   `receivedBytes` moves the client to the server's position; network failures retry with
   backoff; **Cancel** takes effect at the next chunk boundary. In-flight uploads are kept in
   `localStorage` (`footballos.uploads.inflight.v1`): after a reload the page lists them under
   *Interrupted uploads*; choosing the same file (name, size and modification time must match)
   asks `GET /uploads/:id` where the server got to and continues from there. A duplicate
   (`409` with `existingAssetId`) links to the existing film.
2. **Jobs** (`src/film/jobPolling.ts`, §14.2). `GET /teams/:id/jobs?assetId=` is polled every
   3 s while any job is queued, running or waiting to retry, and stops when every job is
   terminal; the page says which. Cancel and retry are per job. When a chain finishes the
   asset, its plays and labels reload.
3. **Asset view** (`src/pages/AssetPage.tsx`). Footage quality notes and the *could not
   evaluate* list are shown verbatim. The player streams the proxy through a media grant
   (`GET /assets/:id/grant`, §14.3) that is renewed a minute before it expires and once more
   if the stream answers with an error. The thumbnail strip is built from `thumbUrlTemplate`;
   the tile interval comes from the grant when it states one, otherwise 10 s is assumed and
   said. `?t=<sec>` (evidence links from scouting) opens the player at that time on the play
   that contains it. Every seek goes through `planSeek` (`src/film/review.ts`): a real proxy
   seeks straight to the time, or refuses with "Footage for m:ss is not in this proxy" when
   the file is shorter; in mock mode the grant marks its stream as a stand-in (`proxy.standIn`,
   `proxy.durationSec`) and the player maps the cited play onto the short credited clip (clip
   position = seconds into the play), anchors the clip to the selected play, reads the
   playhead in original-file time, and says at the player and at the control that was used
   which play the footage stands for. A time no play covers is never seeked silently
   (iteration 1: HC-05, OC-02, PC-01).
4. **Segment timeline** (`src/film/SegmentTimeline.tsx`, §14.4). Proposed cuts start out in
   the review queue (owner decision, 2026-10-25); *Next in queue* and the `N` key step through
   them. Accept and reject are `PATCH /segments/:id`; *Split at playhead* is
   `POST /segments/:id/split { atSec }`; *Merge with next* is `POST /segments/merge`. Every
   write carries `expectedVersion`; a `409` is shown as "changed elsewhere, reload" and nothing
   is overwritten.
5. **Label review** (`src/film/LabelReview.tsx`, §14.5). Plays × label keys with the value in
   use, the model's abstention, an uncertainty word (never a number that was not measured),
   the accepted status and who reviewed it when. Filters: status, key, abstained only, review
   queue only. Clicking a cell opens the correction panel: accept the model's value, correct
   it, mark it unknown, or reject it, with a reason that is kept in the revision history;
   the panel also shows the model provenance for that play (model, prompt hash, the exact
   frames inspected with clickable timestamps, tokens, cost, latency). *Accept inferred
   labels in view* applies the §14.5 rule — only `accepted.status === 'inferred'` with
   `inferred.abstained === false` — after a confirmation that states how many labels across
   how many plays will change and how many are skipped (abstentions, already reviewed).
   *Run inference* posts `POST /assets/:id/infer`; without a configured provider the job
   fails with `provider_unavailable`, the page says so, and manual labeling stays available.
   No screen ever fills in a value the model did not give.
6. **Opponent Scouting** (`src/pages/ScoutingPage.tsx`, §14.6). Opponent, unit and review
   basis (reviewed labels only / includes unreviewed model labels) select a report computed
   on the server; the page shows the sample size, the games and processed film it came from,
   each finding's numerator, denominator, percentage and excluded plays with reasons, and the
   evidence timestamps as links into the asset view; a finding without a supporting play says
   "No supporting play on file" in place of the link, and contrary examples stay under
   "Against" (iteration 1: OC-06). Uncertain findings are listed apart.
   *Save snapshot* posts `…/scouting/snapshots`; saved snapshots are listed below.
7. **Settings** (`/app/settings`, §14.7): retention days with `expectedVersion` (head coach
   only); the server's upload limits are shown, not edited.

#### Keyboard interactions on the timeline

The play list is one tab stop (`role="listbox"` with `aria-activedescendant`).

| Key | Action |
| --- | --- |
| `↓` / `→` | Next play |
| `↑` / `←` | Previous play |
| `Home` / `End` | First / last play |
| `Enter` or `Space` | Play from the start of this play |
| `N` | Next play still in the review queue |
| `A` | Accept this cut |
| `R` | Reject this cut |
| `S` | Split this play at the playhead |
| `M` | Merge this play with the next one |

#### What is demo-only

- The mock's simulated worker: jobs advance one step per poll and `validate` writes an
  estimated duration and says the stream was not probed; `segment` proposes evenly spaced
  cuts; `infer_labels` always fails with `provider_unavailable` because the mock has no model
  provider (it never invents a label).
- The mock media grant streams one of the credited SWOSU demo clips (`public/demo-film/`) in
  place of a proxy and says so (`proxy: { standIn: true, durationSec }`); the player labels
  every seek as stand-in footage for the cited play. Its thumbnail tiles are generated SVGs
  that name their own index.
- The 12 plays with model output and their provenance are authored demo records; the
  findings on the scouting page are authored, not computed.
- Hashing in a Web Worker needs a browser; under vitest the hasher is injected.

#### Proposed contract additions (for Backend)

- `GET /assets/:id/grant` could return `thumbEverySec` and `thumbCount` so the client knows
  the tile interval (today it assumes 10 s and says so).
- Label rows for every inferable key should exist as soon as a segment exists (status
  `unknown`, `inferred: null`), or a `POST /segments/:id/labels` route is needed; otherwise
  manual labeling of plays the model never saw has nothing to `PATCH`.

### Landing hero montage — asset pending

The hero montage is source-agnostic. It reads `public/montage/manifest.json`:

```json
{ "poster": "montage/poster.svg", "clips": [{ "src": "montage/clip-1.mp4", "poster": "…", "credit": "…" }] }
```

Paths are relative to the app's base URL. Clips play muted and inline, chained in order and
looped, with a visible pause/play control; with `prefers-reduced-motion` only the poster
shows and nothing autoplays. **The owner decided (2026-10-25) that the montage must not use
the SWOSU demo clips or any evaluation footage; it will use AI-generated clips of football
players that do not exist yet.** Until they are provided the manifest ships with an empty
`clips` list and the designed poster `public/montage/poster.svg`, so the hero shows the
poster alone. The credited demo clips in `public/demo-film/` are used only inside the
prototype demo flow.

### Design tokens

`src/styles/tokens.css` holds the semantic tokens (surface, line, ink, navy, crimson, gold,
status, focus, radius, type scale, spacing). `src/styles.css` (the prototype stylesheet)
aliases its historical variable names onto them; `src/styles/shell.css` styles the shell.

### Tests

`npm test` runs the prototype's 58 tests unchanged plus the shell suite in
`src/tests/shell/` (routing, auth gating, montage, context query, screens on the mock API,
axe-core on landing, dashboard, film, asset view and scouting) and the film suite in
`src/tests/film/` (upload client against a fake §14.1 server: chunking, resume, 409
handling, retries, cancel; job polling start/stop with fake timers; the bulk-accept rule and
filters; the asset view: keyboard review, split/merge with a stale version, correction with
history and provenance, inference with the truthful provider state, evidence links; a
chunked upload end to end on the mock). `src/tests/setup.shell.ts` works around a jsdom/undici
`AbortSignal` mismatch that react-router's data routers hit under vitest; it is test-only.

```bash
npm run dev          # http://localhost:5174
npm test
npm run typecheck
npm run build        # dist/ with 404.html
```

---

# Module 7 prototype (preserved under `/prototype/`)

**Live prototype:** <https://zap12-ux.github.io/footballos-prototype/> ·
**Demo (no baseline collected):** <https://zap12-ux.github.io/footballos-prototype/#/demo> ·
**Research entry (baseline first, no examples):** <https://zap12-ux.github.io/footballos-prototype/#/research> ·
**Repository:** <https://github.com/zap12-ux/footballos-prototype>

An interactive, single-page web application that introduces FootballOS on a landing page
and leads in one click into one coaching workflow:

> Select film → inspect a proposed evaluation → review evidence and uncertainty →
> accept or correct the evaluation → create a practice focus from coach-reviewed findings.

FootballOS is an AI-assisted coaching workspace for high-school football programs. This
prototype demonstrates how its AI features would present grades, evidence, confidence,
and abstentions to a position coach — and how the coach stays the final authority.

**Program:** Winchester Hawks (fictional) · **Position group:** Offensive Line ·
**Concept:** Inside Zone Right · **Primary player:** No. 62, Left Guard · **Six seeded plays**

This version was built for *Module 7: Hands-On — AI Product UI Prototype* (Georgetown,
Developing AI Solutions) and is intended to carry forward into the Module 13 final project.

---

## Run it locally

Requires Node 18 or newer (developed and verified on Node 25.9 / npm 11). No network
access is needed at runtime; `npm install` needs the npm registry once.

```bash
cd footballos-prototype/apps/web
npm install
npm run dev
```

Then open **http://localhost:5174/prototype/** in a current browser (Chrome, Edge, Safari or
Firefox). A landscape tablet or desktop window is the intended layout; the page also
works on narrower screens.

Other commands:

```bash
npm test           # Vitest + React Testing Library suite (58 prototype tests + the shell suite)
npm run typecheck  # tsc --noEmit
npm run build      # production build to dist/
npm run preview    # serve the production build at http://localhost:4173
```

To start over at any time use **Reset session** on the final screen, or clear the
browser's site data for `localhost`.

## Routes and modes

There is no router library. The entry point is read from the URL hash once on load and
written back whenever the mode changes, so GitHub Pages needs no server rewrites:

| URL | What opens | Mode |
| --- | --- | --- |
| `/` or `/#/` | **Landing page**: what the product is, how the AI output is presented (live components), what is simulated, two calls to action. | — |
| `/#/demo` | **Demo mode**: no baseline is collected (`baseline: null`), the session starts, and the review queue opens with the film check visible. Everything from the queue onward behaves exactly as in research mode. The header and the results screen show "Demo session — not research data," the results screen says "No baseline collected in demo mode," and the export carries `mode: "demo"` with `baseline: null`. | `demo` |
| `/#/research` | **Research entry**: the baseline form, shown before any candidate grade, confidence label, evidence example or suggested completion time. This is the link the usability protocol sends participants to. Screens 2–7 follow. | `research` |

A participant who reaches the research form from the landing page instead (the **Start a
research session** button) has already seen example AI output; that is recorded in the
baseline's `exposure` record (`enteredVia: "landing_page"`), together with the participant's
own answer to "Have you seen this prototype before today?" and whether a demo or landing view
was previously recorded in this browser. None of those flags can prove that a participant has
never seen the prototype, and the record says so.

A visitor who already has a saved session in this browser lands on the landing page with a
**Resume your session** control; a deep link never replaces a saved session. Starting a
new demo or research session over a saved one asks for confirmation first.

## What the prototype shows

| Screen | What the user does | What it demonstrates |
| --- | --- | --- |
| Entry: Landing page | Reads one screen: what FootballOS is and for whom, the five-step loop, four live cards showing a candidate grade with rationale, the two confidence readings, frame-linked evidence, and a No Grade abstention; what is simulated; how the coach stays in control. Chooses **Try the demo** or **Start a research session**. | A first-time visitor can tell what the product does before clicking anything; the AI outputs are shown with the product's own components and seeded data, not screenshots; simulated AI and the fictional program are stated above the fold. |
| 1. Research entry | Answers two neutral questions (how long six comparable snaps normally take, with an "I'm not sure" option; current method) and a prior-exposure question **before** seeing anything about the workflow. The time field starts empty and there are no suggested values. | Baseline before the review task; a missing estimate is recorded as missing, never invented; exposure recorded honestly; no personal data requested. |
| 2. Team context | Reads the task brief (workflow, expected length), the program, concept, grade definitions, and how to read confidence. | Grade 1 vs No Grade distinction; confidence bands explained as authored, illustrative labels; "Model accuracy: not evaluated in this prototype." |
| 3. Film | Uses the demo film (recommended), tries a local file, or pastes a link. Sees a film-quality forecast and staged, labelled simulated processing. | Loading, invalid-input and recovery states; privacy: nothing leaves the browser; a link is reduced to its host. |
| 4. Review queue | Scans six plays with candidate grade, separate ID and grade confidence, film tier, status; reviewed / graded / No Grade counts. | Coverage shown together; Play 4's candidate withheld until the coach grades first. |
| 5. Play review | A sticky toolbar shows where the coach is (Play N of 6, coverage, practice-focus status, Prev/Next play). Film or diagram and evidence first; then the candidate grade with a one-line rationale, the two confidence readings, and missing or uncertain evidence; then the decision controls with a Saved / Not saved pill. Longer explanations (confidence definitions, what is simulated, Grade 1 vs No Grade in full) sit in expandable help. | Evidence navigation that does something; separate confidence readings; structured reasons for every change and every final No Grade; obvious saved state; decisions can be revised. |
| 6. Practice focus | Reviews one of four distinct results (see below) built only from coach-graded plays; accepts, edits, or dismisses a recommendation, or reopens a play that needs a technique reason. | Exclusion of No Grade and unreviewed plays; a correction to Grade 3 never becomes a deficiency; a below-standard grade is never shown as the standard being met; a later decision change marks the focus stale. |
| 7. Feedback & results | Answers feedback questions, reviews the session summary, baseline and exposure record, accumulated review time and timing definitions, exports JSON, resets. | Research instrumentation; timing measures defined exactly; exploratory comparison only with a numeric baseline and all six plays decided. |

### Practice-focus states

`src/utils/recommendation.ts` returns exactly one of four kinds. The decision order matters:

| Kind | When | What the coach sees |
| --- | --- | --- |
| `insufficient` | No reviewed play has a coach grade (every reviewed play is No Grade). | "Insufficient evidence for a practice focus" with a film next step (better angle). Nothing about performance is inferred. No Accept control. |
| `reinforce` | Every coach-graded play is Grade 3. | "Reinforce the standard on the graded snaps," explicitly limited to those plays; coverage and excluded plays still shown. Accept / Edit / Dismiss. |
| `clarify` | At least one final grade is 1 or 2, but no usable technique finding exists (the reason was "AI misread the assignment", "Other", or none). | "Clarify the coaching issue before setting a focus": the plays and their final grades, why the recorded reason does not say what to coach, and a working **Reopen Play N** button for each. Never a "maintain" or "standard met" message. No Accept control. |
| `focus` | Coach-approved technique findings exist. | The focus built from eligible findings. A finding supported by one play is labelled "Single finding (one play)," never recurring. Below-standard plays without a technique reason are listed as "Not accounted for by this focus" with Reopen buttons. |

In every state: No Grade and unreviewed plays are excluded and the exclusion is stated; a
correction to Grade 3 is logged as an overrule explanation, never a deficiency; "AI misread
the assignment" and "Other" never drive a teaching point; and accepting, editing or
dismissing a focus and then changing any play decision marks the focus `stale`.

## What is simulated

**Everything the "AI" appears to do.** There is no computer vision, no model call, no
backend, no API key, and no network request of any kind at runtime.

- All six plays, candidate grades, rationales, evidence timestamps, uncertainty notes,
  confidence labels, film-quality reads and storyboard frames are hand-authored data in
  `src/data/plays.ts`.
- The play diagram is an **illustrative schematic**, drawn from that authored data. It is
  not footage, not tracking output, and not evidence of model performance. The screen says
  so next to the diagram.
- The pre-review "film check" is composed from the authored quality reads in
  `src/utils/filmCheck.ts`. No file is inspected.
- "Checking film / Identifying plays / Preparing review candidates" is a staged delay,
  labelled *simulated processing*, with a Cancel control.
- The demo film is real footage: six end-zone snaps from openly licensed college game
  film (see [Film credit](#film-credit)), bundled in `public/demo-film/` with one clip
  per demo play as an illustration of what a coach would be looking at. Selecting a
  frame seeks the clip to the matching moment of the snap. The evaluation shown describes the
  authored demo play, not this footage, and nothing in the clip is analyzed. The
  authored play diagram stays one toggle away on the film stage.
- If you pick a local video, it plays in your browser through an object URL and is never
  uploaded, transmitted, or analyzed. Selecting an evidence frame seeks the video to the
  same clip time, but the evaluation shown describes the authored demo play, not your file.
- The practice focus is composed deterministically in `src/utils/recommendation.ts` from
  the coach's own decisions. It is not coaching guidance from any source.
- Confidence labels (High / Medium / Low) are authored, illustrative values, not calibrated
  probabilities. **Model accuracy: not evaluated in this prototype.** Coach agreement is
  never converted into an accuracy figure.

## Trust behaviors you can verify by hand

- The baseline is captured on the research entry screen before the review task starts
  (`baseline.capturedBeforeReviewTask: true` in the export). That is a statement about this
  session's order of events, not about prior exposure: `baseline.exposure` records how the
  form was reached, whether the landing page was seen first, whether a demo or landing view
  was recorded earlier in this browser, and the participant's own answer. In demo mode
  `baseline` is `null`.
- The baseline time field starts empty with no suggested values, and no expected task
  duration is shown until the baseline has been submitted. "I'm not sure" records
  `estimateStatus: "not_sure"` and no number.
- The original baseline submission is never changed; later revisions are appended to
  `baselineRevisions`.
- Review time accumulates across visits: reopening a play adds a new interval, and saving
  twice does not count the same stretch twice. Each decision's `reviewSeconds` is the
  accumulated time for that play at the moment it was saved, and every earlier decision
  stays in the event log with `previousFinalGrade`.
- The timing comparison is shown only in a research session with a numeric baseline,
  accumulated timing, and a final decision on all six plays, and it is labelled exploratory
  with the task-scope differences listed next to it.
- Play 4 is deliberately a **questionable high-confidence Grade 1**. Its candidate grade,
  confidence, rationale, and evidence markers stay hidden until you record your own grade.
  Your blind grade, the candidate, and your final grade are stored separately.
- Changing a grade takes two interactions: pick the grade, pick one reason. The decision is
  not saved until the reason is picked, and the screen says so.
- Every final No Grade — including accepting a No Grade candidate — requires at least one
  structured reason.
- Plays 3 and 6 are deliberately ungradable film. Two of six snaps coming back No Grade is
  a coverage condition, not a defect, and the film check forecasts it before you start.
- Coverage (reviewed · graded · No Grade) updates together on the queue, the practice focus
  and the summary.
- A session in which every play is No Grade produces an insufficient-evidence state, not a
  recommendation to keep or change anything.
- A Grade 1 recorded with "AI misread the assignment" (and no technique reason) produces
  "Clarify the coaching issue," with a Reopen button, not "maintain" or "reinforce."
- Correcting a candidate to Grade 3 with a reason does not create a player deficiency.
- Accepting or editing the practice focus, then changing any play decision, marks the focus
  stale and asks for renewed review.
- The session export contains no names, no personal information and no pasted URLs.

## Where research data lives

In the browser only, under the `localStorage` key `footballos.prototype.v2`: the session id,
the mode (`research` or `demo`), the baseline with its exposure record and any revisions,
the review intervals, every coach decision with its reason codes, revision count and
accumulated review time, the blind grade for Play 4, the practice-focus state, the feedback
answers, and the research event log. A second key, `footballos.prototype.exposure.v1`,
records only whether a demo was started or the landing page viewed in this browser, so a
later research baseline can note it. Nothing is transmitted. On Screen 7 you can **Copy
Results**, **Download Session JSON**, or **Reset session** (two-step confirmation).

**Saved sessions from earlier versions** load with a field-by-field migration rather than
being discarded: a single `baselineRevision` becomes the `baselineRevisions` list; a demo
session's old placeholder baseline is dropped (it never held an estimate); a research
baseline without an exposure record loads with `exposure: null` and the results screen says
exposure was not recorded; and a session without review intervals is marked
`timingSchema: "legacy_latest_visit"`, keeps each decision's latest-visit seconds labelled
as such, shows accumulated review time as not available, and gets no comparison.

### Timing definitions

| Measure | Includes | Excludes |
| --- | --- | --- |
| Baseline estimate | The coach's self-reported minutes to grade six comparable snaps with their own film and method, entered before the task. | Nothing is measured; "I'm not sure" records no number. |
| Accumulated review time | Every interval in which the play-review screen was open for a play while the tab was visible, across all visits, whether or not a decision was saved. | Entry, team context, film, queue, practice focus and results screens; time with the tab hidden; time after the last 5-second heartbeat before a reload or closed tab. |
| Session elapsed | Wall clock from Begin Review (or demo start) to now. | Nothing. Includes idle and hidden-tab time. |
| Exploratory comparison | Baseline minus accumulated review time, only with a numeric research baseline and six final decisions. | Any claim of demonstrated time saving: the two numbers describe different tasks, and the scope notes say how. |

Please do not enter names, player details or school details anywhere in the prototype.

## Documents

- [`docs/MODULE7_DESIGN_RATIONALE.md`](../../docs/MODULE7_DESIGN_RATIONALE.md) — how the
  implementation meets Module 7, the source-backed design rationale, assumptions, and
  APA references.
- [`docs/USABILITY_TEST_PROTOCOL.md`](../../docs/USABILITY_TEST_PROTOCOL.md) — proposed
  protocol for a first qualitative round with 3–5 coaches, plus a blank
  findings-and-revisions template.
- [`docs/AI_USE_DISCLOSURE.md`](../../docs/AI_USE_DISCLOSURE.md) — how AI tools were used to
  build this submission and what was checked by a person.
- [`docs/CHANGE_AND_VERIFICATION_SUMMARY.md`](../../docs/CHANGE_AND_VERIFICATION_SUMMARY.md) —
  what changed from the earlier prototype and exactly which checks were run.
- [`docs/MODULE7_SUBMISSION.md`](../../docs/MODULE7_SUBMISSION.md) — the links and the 150–300
  word design-choices description submitted for Module 7.

## Project structure

![System architecture: GitHub repository, GitHub Actions and GitHub Pages above; the coach's browser running a static React app with hash router, session reducer, local storage, deterministic logic, authored demo data, session export and film stage; no server, API or model.](../../docs/ARCHITECTURE.svg)

[`docs/ARCHITECTURE.svg`](../../docs/ARCHITECTURE.svg) shows the system as built: a static React
app published to GitHub Pages, with all state in the browser and no server, API or model.

```
index.html            Page shell
src/
  App.tsx             Header, simulated-AI banner, stepper, screen routing, hash sync
  components/         Stepper, play diagram, film stage, evidence panel, indicators
  screens/            Landing page plus one file per screen in the seven-step flow (IntroScreen is the research entry)
  data/               Seeded plays and storyboards, team context and grade definitions, reasons, public links, demo-film credit
public/demo-film/     The credited demo clips, one per play (real footage, CC BY-NC 4.0; see Film credit)
  state/              Session reducer + context (also the research event log; demo / research / resume)
  types/              Shared types
  utils/              localStorage (with migration), exposure record, hash routes, film check, practice-focus logic, review-time intervals, summary and JSON export
  tests/              Vitest + React Testing Library suite
verification/         Optional Playwright end-to-end script (developer utility, not part of npm test)
docs/                 Module 7 submission documents and the system architecture diagram (ARCHITECTURE.svg)
```

Stack: React 19, TypeScript 5, Vite 6, Vitest 2. No other runtime dependencies were added.

## Deployment

`.github/workflows/deploy.yml` runs on every push to `main`: it
installs with `npm ci`, runs `npm run typecheck` and `npm test`, builds with
`GITHUB_PAGES=true` (which sets Vite's `base` to `/footballos-prototype/`), and publishes `dist/` to
GitHub Pages. Tests gate the deploy. Hash routing means no 404 fallback is needed.

## Film credit

The demo clips in `public/demo-film/play-1.mp4` … `play-6.mp4` are taken from
*11/06/2010 SWOSU vs UCO (endzone angle)*, Southwestern Oklahoma State University,
SWOSU Football Videos, <https://dc.swosu.edu/football_vid/71>, licensed
[CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/). Changes: six plays
trimmed to one snap each (about six to nine seconds), re-encoded for the web, audio
removed. The credit is also
shown in the prototype on the film-selection screen and on the film stage. Other
openly licensed footage that was considered is listed in
[`docs/DEMO_FOOTAGE_SOURCES.md`](../../docs/DEMO_FOOTAGE_SOURCES.md).

## Known limitations

- The prototype cannot tell you whether real AI could produce these candidates. It tests
  the *workflow and the trust model*, not computer-vision feasibility, real coaching
  effectiveness, or verified time savings.
- The timing comparison on the final screen is an exploratory comparison against a
  self-reported baseline for a different task. It is only computed once all six plays have a
  decision, and it is not a measured productivity improvement.
- Exposure before the baseline can be recorded only where this browser saw it or the
  participant reports it. A visitor who saw the live demo on another device, or watched a
  demonstration, cannot be detected.
- Review time has a 5-second heartbeat; a tab closed or reloaded mid-review loses up to that
  much. Sessions saved before October 24, 2026 have no accumulated review time.
- The blind-first comparison on Play 4 is an exploratory signal about reliance on one
  play, not a validated measure of accuracy or bias.
- Only one position group, one concept, one player, and four observation types are
  covered. The interface implies more breadth than the data has.
- The play diagram is a schematic. Nothing about real scrubbing, angle switching, or clip
  quality is being tested.
- Data lives in one browser profile. Clearing site data, switching browsers, or using a
  private window loses the session.
- `npm run build` does not typecheck; run `npm run typecheck` separately.
- `verification/e2e.mjs` requires a local Playwright install and a served build. It was
  updated to the current flow but has **not** been executed in this environment (Playwright
  is not installed).
- Automated checks are not usability testing. The protocol in `docs/` describes the human
  study that has not yet been run.
