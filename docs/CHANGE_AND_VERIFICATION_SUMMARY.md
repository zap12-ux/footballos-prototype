# Change and verification summary — FootballOS Module 7 prototype

**Date:** October 15, 2026 · **Base:** FootballOS low-fidelity usability prototype v0.1
(React 19, TypeScript 5, Vite 6, Vitest 2) · **Location:**
`Desktop/Developing AI Solutions/FootballOS/footballos-prototype`

The folder is not a git repository and no commits or deployments were made. All changes
were made in place. No dependencies were added.

## What changed

### New
- **Illustrative play diagram** (`src/components/PlayDiagram.tsx`): an SVG schematic of the
  Inside Zone Right front with No. 62 highlighted, rendered per storyboard frame (pre-snap,
  first step, contact, result). Shows first-step arrow, hand placement, defender displacement
  or penetration, combo links, partial obstruction, "interior out of frame," unresolved
  identity, and a degraded-film treatment. Labelled on screen as not footage, not tracking
  output, and not evidence of model performance. Has an image role and a per-frame description.
- **Storyboard data** on every play (`src/data/plays.ts`): four frames per play with neutral
  captions; each observed-evidence item now points to a frame. Game situation (down, distance,
  field position) added to each play.
- **Landing / introduction** (`src/screens/IntroScreen.tsx`): what FootballOS helps a coach do,
  what the user can try, that the AI is simulated, that the coach decides; task table with
  expected length and a request not to enter personal information. Field-level validation.
- **Team context** now explains both confidence readings in plain language, labels them as
  authored and illustrative, prints "Model accuracy: not evaluated in this prototype," and puts
  Grade 1 and No Grade side by side.
- **Practice-focus states**: `insufficient` (no coach-graded plays), `maintain` (graded plays but
  no teachable finding), `focus`; findings list with source (your correction / candidate you
  accepted); "logged, not treated as a deficiency" notes; stale state with renewed review.
- **Timing definitions** (`src/utils/summary.ts`): exact definitions for baseline, measured
  review time, session elapsed, and the illustrative comparison; the comparison is computed only
  when all six plays have a decision, and is labelled as illustrative.
- **Feedback** questions for practice-focus usefulness and remaining concerns.
- **Reset session** with two-step confirmation; "Cancel" during simulated processing;
  invalid file and invalid link states with recovery.
- **Documents**: README (rewritten), `docs/MODULE7_DESIGN_RATIONALE.md`,
  `docs/USABILITY_TEST_PROTOCOL.md`, `docs/AI_USE_DISCLOSURE.md`, this file.

### Changed behaviour (trust rules)
- Accepting a **No Grade candidate now requires at least one structured reason**, the same as a
  coach-issued No Grade. Decisions are not saved until the reason is picked, and the screen
  says "Not saved yet."
- **Correcting to Grade 3 never creates a finding.** The reason is kept and shown as an
  explanation of the overrule.
- **"AI misread the assignment" and "Other"** are logged but never drive a teaching point.
- **A decision change after the practice focus was accepted, edited or dismissed marks the focus
  `stale`**, logs `recommendation_invalidated`, and requires renewed review.
- **Pasted links are reduced to their host** at the moment of recording; the URL is never
  stored or exported (previously the full URL was kept in state and in the export).
- Decisions carry a **revision count**; reopening and revising replaces the decision and is
  logged.
- Grade definitions updated to the Module 7 wording; No Grade is labelled "Insufficient evidence."
- Two new No Grade reasons: "Cannot confirm it is No. 62" and "Film quality too poor."
- The fake Play/Pause control was removed; frame selection, evidence selection and (for a local
  file) seeking to the clip time replaced it.
- Storage key bumped to `footballos.prototype.v2`; sessions from the earlier shape are ignored
  rather than migrated.

### Visual design
- Palette changed from navy/green to dark navy (primary), crimson (selective emphasis:
  uncertainty, Grade 1, stale/warn states, reset), burnt gold (accents: simulated tags,
  evidence markers, selected evidence). No state relies on colour alone (text plus ✓ / ○ /
  ●●○ / dashed borders).
- Two-column review layout at tablet-landscape and desktop widths; single column below 960 px;
  wide tables scroll inside their card; frame buttons form a 2×2 grid at phone width.
- Skip link, focus is moved to the main region on screen changes, live regions for saved /
  pending / stale states, larger touch targets.

### Test suite
- `src/tests/setup.ts`: in-memory `localStorage` polyfill (Node 22+ ships an experimental
  global that shadowed jsdom's and made every test fail on Node 25) and a `scrollTo` stub.
- Tests rewritten and extended from 14 to 27: baseline gating, invalid file, host-only link,
  reason required to accept No Grade, frame navigation, two-interaction correction, revision
  count, blind-first withholding, all-No-Grade insufficient state, stale invalidation, timing
  comparison gating, Grade 3 corrections, non-teaching reasons, reducer invalidation, export
  contents.
- `verification/e2e.mjs` (optional Playwright script) updated to the new flow but **not run**:
  Playwright is not installed in this environment.

## Checks run

| Check | Command | Result |
| --- | --- | --- |
| Type check | `npm run typecheck` | Passed (0 errors) |
| Unit + integration tests | `npm test` (Vitest + React Testing Library) | 27 passed, 0 failed, 2 files |
| Production build | `npm run build` | Built: `dist/index.html`, one CSS and one JS asset (~282 kB JS, ~85 kB gzipped) |
| Node / npm used | — | Node 25.9.0, npm 11.12.1 |

Before the changes, the inherited suite failed 14 of 14 on this machine because of the Node
25 `localStorage` global; that was fixed in test setup, not by changing application behaviour.

## Browser verification (built-in browser, `npm run dev`, http://localhost:5173)

Walked by hand in a Chromium-based browser pane with the stored session inspected through
`localStorage` after each step.

| Behaviour | Observed |
| --- | --- |
| Landing view explains the product, what to try, simulated AI, coach decides | Yes |
| Begin Review blocked until baseline minutes and method are entered; errors announced | Yes (two `role="alert"` messages) |
| Baseline captured before the task | `baseline.capturedBeforeTask: true`, `baseline_captured` logged before `session_started` |
| Invalid link rejected; valid link stored as host only | Error shown; `filmLinkHost: "www.youtube.com"`; URL absent from stored state |
| Demo film → labelled simulated processing → queue | Yes, with Cancel available during processing |
| Queue shows six plays, both confidence readings, film tier, status, counts together | Yes; Play 4 candidate and both confidences "Withheld" |
| Frame navigation changes the diagram and caption; evidence rows select frames | Yes (Play 1: Next, then evidence row 4 → Result frame highlighted) |
| Accept Grade 3 saves immediately and shows "Saved … decision 1" | Yes |
| Change to Grade 1 needs a reason; "Not saved yet" until picked; two interactions | Yes (Play 2 → Grade 1, Pad level or leverage) |
| Accept No Grade candidate needs a reason | Yes (Play 3 → "Cannot confirm it is No. 62"; Play 6 → "Film quality too poor") |
| Play 4 withholds candidate, rationale, confidence and evidence markers until a blind grade | Yes; after reveal, both grades shown; stored `blindGrade: 2, candidateGrade: 1, finalGrade: 2, movedTowardCandidate: false` |
| Coverage updates together | Queue showed 6 of 6 · 4 graded · 2 No Grade |
| Practice focus built from coach-graded plays only; excluded plays listed | "Hand placement during initial engagement"; Plays 3 and 6 excluded |
| Accept → reopen Play 1 → change to Grade 2 → focus marked stale | `recommendationState: "stale"`, `recommendation_invalidated` logged, alert shown, re-accept cleared it |
| Edit practice focus | "Recorded: edited", original title shown |
| All-No-Grade session → insufficient-evidence state, no Accept control | Yes (checked by setting all six decisions to No Grade) |
| Feedback form saves; remaining-concerns text stored | Yes |
| Export JSON contains accuracy statement, timing definitions, host only, no URL | Yes (inspected the Research Log JSON); Copy Results reported "Copied to clipboard." |
| Reset requires a second confirmation; "Keep my session" cancels | Yes |
| Keyboard: Tab moves focus with a visible outline | Yes (focus ring on the Research Log summary) |
| Layout: no horizontal overflow at 1024×768, 1366×900, 375×812 | 0 px overflow at each; two columns at 1024 and 1366, one column at 375 |

Issues found during the walk-through and fixed before this summary: pressed chips lost
contrast on hover; the queue's play column wrapped word-by-word at narrow widths; a diagram
label overlapped the quarterback; two status messages ran together on the results screen.

## Not verified / remaining limitations

- **No human usability testing has been done.** Automated checks and the author's walk-through
  are not a substitute. The protocol in `docs/USABILITY_TEST_PROTOCOL.md` is a plan.
- **Local-file playback** was not exercised in the browser walk-through (the test suite covers
  the invalid-file path only). The video element and clip-time seeking are implemented but
  unverified by hand.
- **Download Session JSON** was not clicked in the browser (to avoid a file download in the
  verification environment); the export content was verified from the on-screen Research Log,
  which renders the same JSON.
- **Screen-reader behaviour** was not tested with assistive technology; only roles, names,
  live regions and focus order were checked structurally.
- **`verification/e2e.mjs`** was updated but not executed (Playwright not installed).
- **No accuracy, calibration, or time-saving claims** are made or supported. Confidence labels
  are authored. The timing comparison is illustrative. The blind-first result is a one-play
  exploratory signal.
- Everything the "AI" does remains simulated: no model, no video analysis, no backend, no
  network calls.

---

# October 24, 2026 — landing page, demo mode, deployment

**Base:** the October 15 version above · **Repository:** `zap12-ux/footballos-prototype`
(public), prototype in `footballos-prototype/` · **Live:** <https://zap12-ux.github.io/footballos-prototype/>

## What changed

### New
- **Landing page** (`src/screens/LandingScreen.tsx`): hero (what / for whom / the promise),
  two calls to action, honesty line under them; five-step loop; four cards that render the
  product's own components on seeded data — Play 2's candidate grade with rationale and the
  compact 1–3 / No Grade scale, Play 2's two confidence readings, Play 2's diagram with the
  live `EvidencePanel` (selecting an item changes the frame), and Play 6's No Grade with the
  "what would make this gradable" remedy — each with a one-line "Why" footnote naming the
  principle; "How you stay in control"; "What is simulated and what is not"; usability
  testing status with a link to the protocol; footer with repository and document links, the
  fictional-program line and the course line. No percentages, accuracy figures, time-saved
  claims, testimonials, logos or user counts. The workflow stepper is hidden on the landing
  page; header, banner and accuracy statement are unchanged.
- **Hash routes** (`src/utils/routes.ts`): `#/` landing, `#/demo` demo mode, `#/research`
  the existing Screen 1. Read on load (`resolveInitialState` in
  `src/state/SessionContext.tsx`), written with `history.replaceState` when the mode
  changes. A hash typed after load (or Back/Forward) is applied only when nothing would be
  lost — a blank session starts the requested mode, a saved session in the same mode is
  resumed, `#/` returns to the landing page — and otherwise the hash is put back. No router
  library.
- **Demo mode**: reducer action `startDemo` sets `mode: 'demo'`, records a placeholder
  baseline `{ minutesForSixSnaps: null, demo: true, capturedBeforeTask: true }`, starts the
  timer, selects the demo film and opens the review queue with the film check visible; logs
  `demo_started`. The queue is kept (rather than auto-opening Play 1) so the coverage line
  is the first thing seen. Header and results screen show "Demo session — not research
  data." The export carries `mode` and `modeNote`. The timing comparison reports "No
  baseline was captured" in demo mode. Research mode (`startResearch`) is Screen 1 as before.
- **Resume**: a saved session with any content lands on the landing page with **Resume your
  session**; `resume` restores the saved screen and logs `session_resumed`. A deep link never
  replaces a saved session; starting a new session over one asks for confirmation.
- `src/data/links.ts` (public URLs, course line), `DEMO_NOTE` in `src/data/team.ts`,
  `headingLevel` prop on `EvidencePanel` so heading order holds where it is embedded.
- **Tests** (`src/tests/landing.test.tsx`, 12 tests): landing renders both calls to action and
  the honesty line with no baseline form and no percentage; the four output cards render live
  with frame-linked evidence; demo from the landing page, `#/demo` deep link, `#/research`
  deep link with gating intact; a hash typed after load; a demo decision, the summary demo note and `mode: 'demo'` in
  the export; a saved session is resumable and a deep link does not destroy it; confirmation
  before replacing a saved session; route helpers, `resolveInitialState` and the demo
  baseline.
- **Deployment**: `.github/workflows/deploy.yml` (Node 22, `npm ci`,
  typecheck, tests, `GITHUB_PAGES=true npm run build`, upload and deploy to Pages;
  `permissions: pages: write, id-token: write`; tests gate the deploy). `vite.config.ts`
  sets `base` to `/footballos-prototype/` when `GITHUB_PAGES=true`, `/` otherwise.
- `docs/MODULE7_SUBMISSION.md` (links and the 150–300 word description).

### Changed
- `ScreenId` gains `'landing'`; `SessionState` gains `mode` and `resumeScreen`;
  `BaselineCapture` gains optional `demo`. **Storage key unchanged** (`footballos.prototype.v2`);
  saved sessions without `mode` load as research sessions.
- `initialState().screen` is now `'landing'`, so **Reset session** returns to the landing page.
- `vite.config.ts`: `testTimeout: 20000` (the two full-workflow tests exceeded Vitest's 5 s
  default once three test files ran in parallel). `src/tests/setup.ts` resets the URL hash
  after each test.
- `src/tests/workflow.test.tsx`: the entry helper now clicks **Start a research session**
  first, and the partial-session test clicks **Resume your session** after re-rendering from
  storage. The assertions are unchanged.
- `verification/e2e.mjs` opens `#/research` (still not executed; Playwright not installed).
- Landing-page CSS appended to `src/styles.css` using the existing tokens only; the grid
  tracks below 960 px use `minmax(0, 1fr)` so a no-wrap confidence tag cannot widen a card
  past a phone viewport.
- `README.md` (live links, routes and modes, entry row in the screen table, deployment),
  `docs/MODULE7_DESIGN_RATIONALE.md` (§1 row, §3.3.1), `docs/AI_USE_DISCLOSURE.md`.

### Not changed
- Screens 1–7, the baseline-before-exposure rule, the Play 4 blind-first probe, the
  two-interaction correction, the stale practice focus, the export contents, the palette and
  typography. The usability protocol's text is unchanged; facilitators should open
  `#/research` (or click **Start a research session**) before each participant.
- No runtime or development dependencies were added.

## Checks run

| Check | Command | Before changes | After changes |
| --- | --- | --- | --- |
| Type check | `npm run typecheck` | Passed (0 errors) | Passed (0 errors) |
| Unit + integration tests | `npm test` | 27 passed, 2 files | 39 passed, 0 failed, 3 files (27 original + 12 new) |
| Production build | `npm run build` | Built | Built (`dist/index.html`, one CSS and one JS asset, ~299 kB JS / ~89 kB gzipped) |
| Pages build | `GITHUB_PAGES=true npm run build` | — | Built; asset paths resolve under `/footballos-prototype/` |
| Node / npm used | — | Node 25.9.0, npm 11.12.1 | same |

## Browser verification (built-in browser, `npm run dev`, http://localhost:5173)

| Behaviour | Observed |
| --- | --- |
| Page title | "FootballOS — AI-assisted film review (prototype)" |
| Landing page at `#/`: hero, two calls to action, honesty line, five steps, four live cards, control, simulated/real lists, testing, footer | Yes, in that order |
| Heading order | h1 → h2 per section → h3 per card → h4 inside cards; no level skipped |
| Percentages anywhere on the landing page | None (checked by text search) |
| Accuracy statement in the header | Present on the landing page |
| Horizontal overflow | 0 px at desktop width and at 375 px (after the grid fix noted above) |
| Phone width | Sections stack; the confidence tags wrap; evidence panel stacks under the diagram |

## Privacy check before publishing

`grep` over the prototype tree (excluding `node_modules`, `dist`, `package-lock.json`) for
e-mail addresses, phone-number patterns, the author's name or account, and capitalised
two-word names: no e-mail addresses, no phone numbers, no personal names. Matches that are
expected: "Georgetown" (the course institution), "Winchester Hawks" and "Rockbridge" (the
fictional program and its fictional opponent, present since the September prototype),
"Hudl" (a product name in the method options), and the GitHub account name in the public
URLs.

## Deployment (October 24, 2026)

| Step | Result |
| --- | --- |
| Repository | `zap12-ux/footballos-prototype`, public, created from this folder only with `gh repo create --public --source=. --push`; commit author is the GitHub noreply identity |
| Pages source | GitHub Actions (`gh api -X POST …/pages -f build_type=workflow`) |
| First run (`Deploy to GitHub Pages`, commit a542e79) | build job (npm ci, typecheck, 38 tests, build) and deploy job both succeeded |
| Live URL | <https://zap12-ux.github.io/footballos-prototype/> — HTTP 200; page title "FootballOS — AI-assisted film review (prototype)"; both hashed assets under `/footballos-prototype/assets/` return 200 |
| Live walk-through (built-in browser) | Landing page renders with both calls to action, the honesty line and the header accuracy statement; 0 px horizontal overflow; `#/demo` opened in a fresh load reaches the review queue |
| Not run | Playwright (not installed locally); the e2e script was not executed against the live site |

## Not verified / remaining limitations

- `verification/e2e.mjs` and screen-reader testing, as above.
- **No human usability testing has been done.** The protocol is a plan.
- The landing page was walked by the author in one Chromium-based browser pane; it was not
  tested with a screen reader.
- `verification/e2e.mjs` was updated but not executed (Playwright not installed).
- The prototype folder is also tracked inside the student's separate, private course
  repository; that repository is not part of the submission and was not scanned.
