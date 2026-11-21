# I1 · Iteration 1: the four mechanisms behind the round-1 Musts

**Source of truth:** `tools/review-agents/reports/round-1/` (head-coach, coordinator, position-coach `.json` and `.md`), reviewed against integration commit `f48a241` on 2026-11-21. Fourteen findings scored Must (urgency high, value high). They are produced by four mechanisms. This iteration fixes the mechanisms, not fourteen patches, so each fix can be re-verified by the same reviewer task in round 2.

**Definition of done (Perri, 2018, ch. 19):** an item is done when round 2 verifies it with the same task, not when it ships. Round 2 reports the same four targets as round 1 and must improve on all four, with silent loss of coach input at zero:

| Target | Round-1 baseline (head coach / coordinator / line coach) |
| --- | --- |
| Role tasks completed unaided, ≥ 80% | 2/7 · 4/8 · 6/8 |
| Findings where a coach's input was discarded without warning, 0 | 1 · 2 · 3 |
| AI outputs traceable to supporting evidence within two interactions, all | 22/171 · 25/179 · 22/162 |
| Would use in season, unconditional yes | conditional · no · no |

## Ground rules

- Work on a branch cut from `integration`. One commit per finding ID or per mechanism, message prefixed with the IDs it addresses (for example `HC-01 OC-10 PC-03 PC-05: keep unsaved work across navigation`). The round-2 reviewer retraces findings by ID.
- Read `docs/team/CONTRACTS.md` before touching plans, approvals or audit. The contract is the oracle: several findings are the product disagreeing with a rule it already documents. Where a fix needs a contract change (override reason, draft uniqueness), amend `CONTRACTS.md` and `packages/contracts` in the same commit and record the decision in `docs/team/DECISIONS.md`.
- Do not edit anything under `tools/review-agents/reports/`. Round-1 is the baseline.
- Mock mode (`VITE_API_MODE=mock`) is part of the system under test. Fixes must work in mock mode because that is what round 2 runs against.
- Verify each mechanism with a Vitest test that reproduces the reviewer's exact steps before the fix and passes after. Existing suites: `apps/web/src/tests/`.

## Step 0 · Clean baseline (do first, separate commit)

`npm run typecheck` reports 30 pre-existing errors (23 in `apps/web` mock data and handlers, 7 in `packages/ai` recommendation test fixtures) and `npm test -w packages/media` fails one test: `src/test/documents.test.ts` passes an object missing `textSource`, `width` and `height` to the page schema (around line 116). Fix all of these without changing behaviour, so that `npm run typecheck` and `npm test` are green before any mechanism lands. Commit as `chore: clear typecheck and OCR test baseline`.

## Mechanism 1 · Unsaved-work guard (HC-01, OC-10, PC-03, PC-05)

What the coaches hit:

- HC-01 (`/app/plans`): adding a third objective, then switching the unit tab before Save draft, silently dropped the objective. The page then said "Draft saved".
- OC-10 (`/app/plans`): an item added to a section list and another still typed in the Add field were both lost on leaving the draft for scouting and returning.
- PC-03 (`/app/film/:assetId`, label review): a pending correction value and its typed reason were discarded when the coach selected another label cell and came back. The drawer reopened as "Inferred, not reviewed".
- PC-05 (`/app/plans`): an unposted comment was cleared when the coach followed a film timestamp from the plan and returned.

Requirement: a coach's unsaved input survives ordinary navigation inside the workspace, or the product asks before discarding it. Never both silent and lossy.

Implementation sketch:

- Add a draft store (extend `apps/web/src/workspace/store.ts` or a sibling module) keyed by `{teamId, planVersionId, sectionKey}` for plan section edits and pending Add-field text, by `{assetId, playId, labelKey}` for pending label corrections (value + reason), and by `{planVersionId, sectionKey}` for comment drafts. Drafts live in memory and in `sessionStorage` so a refresh does not lose them either.
- `PlansPage.tsx`: hydrate section state from the draft store on mount and on unit change; write to it on every edit; clear it on successful Save draft, Submit or Approve. Show an "Unsaved changes" indicator next to Save draft while drafts exist.
- `LabelReview.tsx`: keep the correction panel's pending value and reason per play+label when the selection changes; restore them when the cell is reselected; show a "pending" marker on cells with unsaved corrections; clear on Save label or explicit Discard.
- Plan comments: keep the typed comment and the selected section in the draft store across navigation.
- If any navigation would still discard input (for example sign-out), use a confirm that names what will be lost.
- Tests: reproduce each of the four sequences exactly as the finding's `observed` text describes, assert the input is present after returning.

## Mechanism 2 · Evidence links land on the cited snap (HC-05, OC-02, PC-01, OC-06)

What the coaches hit: a scouting evidence timestamp (for example 10:40) or a label's "Looked at" frame link selected the right play on the timeline, but the demo proxy video is a six-second credited clip, so playback sat at 0:00 or at the clip end and could not show the cited snap. Several defensive tendencies exposed no supporting example at all (OC-06); one offered only a contrary example.

Requirement: when a coach follows evidence, the player shows the cited moment, or the control states plainly that footage for that moment is unavailable. A finding with no supporting play says so on the card.

Implementation sketch:

- In mock mode, give the demo asset a proxy that covers the cited ranges. Either (a) serve a longer stand-in proxy whose duration covers the seeded plays, with the thumbnail strip and `?t=` seeking mapped onto it, or (b) keep the short clip but map each seeded play to an offset within it and seek there, with a visible "demo proxy: stand-in footage for 10:40" label at the player. Option (a) is preferred if a licensed longer clip exists under `apps/web/public` or the media package; otherwise (b).
- `AssetPage.tsx`: when a requested time is outside the playable range of the grant, do not seek silently. Show an inline notice at the player and at the evidence control: "Footage for 10:40 is not in this proxy."
- `ScoutingPage.tsx` and the finding cards: every finding lists its supporting plays as links. When a finding has none, render "No supporting play on file" in place of the evidence link, and label contrary examples as "Against:". Do not let a finding appear backed when it is not.
- Label provenance drawer: each "Looked at" frame link must open the player at that frame within the playable range or carry the same unavailable notice.
- Tests: for each seeded evidence link in the mock data, assert the resolved seek time is within the proxy's duration or the notice is rendered.

## Mechanism 3 · Approval history that survives supersession, one draft per unit (HC-03, HC-07)

What the coaches hit:

- HC-03: after a head-coach override approved v3, selecting the superseded v1 no longer showed its original approver and time, and the override captured no reason.
- HC-07: Start a new draft from an approved version while a draft already existed produced two editable drafts for one unit.

Requirement: every version keeps its own approver, time and override flag forever; a head-coach override records a reason; a unit has at most one draft at a time.

Implementation sketch:

- Contract: add `overrideReason: string | null` to the plan version approval shape in `packages/contracts` and `docs/team/CONTRACTS.md` (section 11 and the approval transition near line 480); make the audit event carry it. Record the decision in `DECISIONS.md`.
- Mock API and web: approval and supersession write to a per-version history; the version selector and header render the history for the selected version (approver, time, override, reason) even when superseded.
- `PlansPage.tsx`: the Approve action for a head coach on a unit they do not coordinate requires a reason before it commits.
- Start a new draft: if a draft already exists for the unit and game, route to it and say so; do not create another.
- Tests: approve, supersede, reopen the old version and assert its history; attempt a second draft and assert the redirect.

## Mechanism 4 · Mock-mode persistence across reload (OC-01, PC-04)

What the coaches hit: a browser reload returned the mock workspace to its seed, removing an approved plan v3, a saved film revision and a posted comment. These are environment faults, but round 2 runs in this environment, so they must be fixed or the comparison is unfair.

Requirement: in mock mode, mutations persist across reload for the browser session, with a visible way to reset to seed.

Implementation sketch:

- In `apps/web/src/api/mock/` wrap the in-memory data with a versioned `localStorage` store (key such as `footballos.mock.v1`); hydrate on load, write through on every mutation; include a schema version so a seed change invalidates stale state.
- Add a "Reset demo data" control on `/app/settings` for the demo team only, with a confirmation that names what will be cleared.
- Tests: mutate, reload the module state from storage, assert the mutation survives; reset, assert seed.

## Out of scope for this iteration (tracked, not built)

Should: sharing audience and revocation (HC-02); film deletion with audit (HC-06); item-level decisions on mixed-basis tendencies in an approved plan (HC-04); retention text that says what happens to existing film (HC-09); the remaining "no supporting example" cases beyond the card label (OC-06 full fix). Could: queue and count fixes (PC-06, PC-07, PC-02, PC-08). Won't this term: recommendation generate-and-decide controls (OC-03).

## Verification and hand-off

1. `npm run typecheck` and `npm test` green at every commit.
2. Each mechanism has a test that fails on `integration` and passes on the branch.
3. Run the app in mock mode and walk the four reviewer sequences by hand once; capture one screenshot per mechanism under `docs/team/briefs/I1-evidence/`.
4. Open a PR against `integration` titled "Iteration 1: unsaved-work guard, evidence links, approval history, mock persistence". The PR body lists the finding IDs addressed per commit.
5. Round 2 is then run with `tools/review-agents/run.sh <role> round-2` for all three roles and compared with `tools/review-agents/compare.md`. That step is not part of this brief.

## References

Cagan, M. (2017). *Inspired: How to create tech products customers love* (2nd ed.). Wiley. · Perri, M. (2018). *Escaping the build trap*. O'Reilly. · Huyen, C. (2022). *Designing machine learning systems*. O'Reilly.
