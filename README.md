# FootballOS — AI product UI prototype (Module 7)

**Live prototype:** <https://zap12-ux.github.io/footballos-prototype/> ·
**Demo (no baseline form):** <https://zap12-ux.github.io/footballos-prototype/#/demo> ·
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
npm test           # Vitest + React Testing Library suite (39 tests)
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
| `/#/demo` | **Demo mode**: a placeholder baseline flagged `demo: true` is recorded, the session starts, and the review queue opens with the film check visible. Everything from the queue onward behaves exactly as in research mode. The header and the results screen show "Demo session — not research data," and the export carries `mode: "demo"`. | `demo` |
| `/#/research` | **Research mode**: the existing Screen 1 intake form. The baseline must be entered before the workflow is shown; Screens 1–7 are unchanged. | `research` |

A visitor who already has a saved session in this browser lands on the landing page with a
**Resume your session** control; a deep link never replaces a saved session. Starting a
new demo or research session over a saved one asks for confirmation first.

## What the prototype shows

| Screen | What the user does | What it demonstrates |
| --- | --- | --- |
| Entry: Landing page | Reads one screen: what FootballOS is and for whom, the five-step loop, four live cards showing a candidate grade with rationale, the two confidence readings, frame-linked evidence, and a No Grade abstention; what is simulated; how the coach stays in control. Chooses **Try the demo** or **Start a research session**. | A first-time visitor can tell what the product does before clicking anything; the AI outputs are shown with the product's own components and seeded data, not screenshots; simulated AI and the fictional program are stated above the fold. |
| 1. Start | Reads a short introduction; records a baseline estimate and current review method **before** seeing the workflow. | Clear product framing; "simulated AI" and "coach decides" stated up front; no personal data requested. |
| 2. Team context | Reads the program, concept, grade definitions, and how to read confidence. | Grade 1 vs No Grade distinction; confidence bands explained as authored, illustrative labels; "Model accuracy: not evaluated in this prototype." |
| 3. Film | Uses the demo film (recommended), tries a local file, or pastes a link. Sees a film-quality forecast and staged, labelled simulated processing. | Loading, invalid-input and recovery states; privacy: nothing leaves the browser; a link is reduced to its host. |
| 4. Review queue | Scans six plays with candidate grade, separate ID and grade confidence, film tier, status; reviewed / graded / No Grade counts. | Coverage shown together; Play 4's candidate withheld until the coach grades first. |
| 5. Play review | Steps through an illustrative play diagram frame by frame, reads the candidate, its rationale, time-stamped evidence and uncertainties, and decides: accept, change (two taps), or No Grade. | Evidence navigation that does something; separate confidence readings; structured reasons for every change and every final No Grade; obvious saved state; decisions can be revised. |
| 6. Practice focus | Reviews a deterministic focus built only from coach-graded plays; accepts, edits, or dismisses it. | Exclusion of No Grade and unreviewed plays; insufficient-evidence state; a correction to Grade 3 never becomes a deficiency; a later decision change marks the focus stale. |
| 7. Feedback & results | Answers feedback questions, reviews the session summary and timing definitions, exports JSON, resets. | Research instrumentation; timing measures defined exactly; illustrative comparison only when all six plays are decided. |

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
- If you pick a local video, it plays in your browser through an object URL and is never
  uploaded, transmitted, or analyzed. Selecting an evidence frame seeks the video to the
  same clip time, but the evaluation shown describes the authored demo play, not your file.
- The practice focus is composed deterministically in `src/utils/recommendation.ts` from
  the coach's own decisions. It is not coaching guidance from any source.
- Confidence labels (High / Medium / Low) are authored, illustrative values, not calibrated
  probabilities. **Model accuracy: not evaluated in this prototype.** Coach agreement is
  never converted into an accuracy figure.

## Trust behaviors you can verify by hand

- The baseline is captured on Screen 1 before any exposure to the review workflow
  (`baseline.capturedBeforeTask: true` in the export).
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
- Correcting a candidate to Grade 3 with a reason does not create a player deficiency.
- Accepting or editing the practice focus, then changing any play decision, marks the focus
  stale and asks for renewed review.
- The session export contains no names, no personal information and no pasted URLs.

## Where research data lives

In the browser only, under the `localStorage` key `footballos.prototype.v2` (unchanged;
sessions saved before demo mode existed load as research sessions): the session id, the
mode (`research` or `demo`), the baseline and any revision, every coach decision with its reason codes, revision
count and review time, the blind grade for Play 4, the practice-focus state, the feedback
answers, and the research event log. Nothing is transmitted. On Screen 7 you can **Copy
Results**, **Download Session JSON**, or **Reset session** (two-step confirmation).

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
  screens/            Landing page plus one file per screen in the seven-step flow
  data/               Seeded plays and storyboards, team context and grade definitions, reasons, public links
  state/              Session reducer + context (also the research event log; demo / research / resume)
  types/              Shared types
  utils/              localStorage, hash routes, film check, practice-focus logic, summary and JSON export
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

## Known limitations

- The prototype cannot tell you whether real AI could produce these candidates. It tests
  the *workflow and the trust model*, not computer-vision feasibility, real coaching
  effectiveness, or verified time savings.
- The timing comparison on the final screen is an illustrative comparison against a
  self-reported baseline. It is only computed once all six plays have a decision, and it
  is not a measured productivity improvement.
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
