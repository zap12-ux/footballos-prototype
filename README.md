# FootballOS — AI product UI prototype (Module 7)

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
cd footballos-prototype
npm install
npm run dev
```

Then open **http://localhost:5173** in a current browser (Chrome, Edge, Safari or
Firefox). A landscape tablet or desktop window is the intended layout; the page also
works on narrower screens.

Other commands:

```bash
npm test           # Vitest + React Testing Library suite (58 tests)
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

- [`docs/MODULE7_DESIGN_RATIONALE.md`](docs/MODULE7_DESIGN_RATIONALE.md) — how the
  implementation meets Module 7, the source-backed design rationale, assumptions, and
  APA references.
- [`docs/USABILITY_TEST_PROTOCOL.md`](docs/USABILITY_TEST_PROTOCOL.md) — proposed
  protocol for a first qualitative round with 3–5 coaches, plus a blank
  findings-and-revisions template.
- [`docs/AI_USE_DISCLOSURE.md`](docs/AI_USE_DISCLOSURE.md) — how AI tools were used to
  build this submission and what was checked by a person.
- [`docs/CHANGE_AND_VERIFICATION_SUMMARY.md`](docs/CHANGE_AND_VERIFICATION_SUMMARY.md) —
  what changed from the earlier prototype and exactly which checks were run.
- [`docs/MODULE7_SUBMISSION.md`](docs/MODULE7_SUBMISSION.md) — the links and the 150–300
  word design-choices description submitted for Module 7.

## Project structure

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
docs/                 Module 7 submission documents
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
[`docs/DEMO_FOOTAGE_SOURCES.md`](docs/DEMO_FOOTAGE_SOURCES.md).

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
