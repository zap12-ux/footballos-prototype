# Grounded recommendations: rules and matching table (C3-lib)

`buildRecommendations` in `packages/ai/src/recommendations/build.ts` turns a scouting report
into weekly recommendations for one of our units (CONTRACTS §10, §15.3, §15.5). It is
deterministic (no model), and every item can be traced back to counted plays, installed
playbook concepts and available personnel. This page states the rules so a coach can see
**why** an item exists, why a concept was suggested for it, and why something was *not*
suggested. The code table in `src/recommendations/matching.ts` is the one the function uses;
this page mirrors it and must change together with it.

## 1. Inputs

| Input | What is used | What is ignored |
| --- | --- | --- |
| Scouting report (`buildScoutingReport`, §14.6) on the **opponent** unit | findings with `reviewBasis: 'reviewed_only'` | any finding built from unreviewed model labels |
| Approved playbook version (§15.1) | concepts with `status: 'approved'` **and** `installed: true` in that version | proposed, rejected, not-installed, or other-version concepts |
| Personnel for the season (§15.2) | players (status and `availability[week]`), packages of our unit, depth chart id/version, the game week | packages of another unit |
| `unit` (ours), `gameId` | names the plan and the week | |

A plan for our **defense** uses the report on the opponent **offense**; our **offense** uses
the report on the opponent **defense**; **special teams** uses the opponent special teams.
Any other pairing is refused with a blocked reason.

## 2. When nothing is produced (`items: []` + `blockedReasons`)

Generation stops before looking at findings when any of these holds:

| Blocked reason | Condition |
| --- | --- |
| `no approved playbook` | `playbook.versionId` is null, or the version's `status` is not `approved` |
| `no installed concepts in the approved playbook` | the approved version has no approved + installed concept |
| `no personnel` | no players and no packages were supplied |
| report basis | the report is `includes_inferred`; recommendations use coach-reviewed labels only |
| unit pairing | the report is about the wrong opponent unit for this plan (see §1) |
| `no scouting findings for this opponent and unit` | the report has no findings |

Per finding, the following stop that finding from becoming an item; the per-finding reason
is listed in `skipped[]` and summarised in `blockedReasons[]`:

| Reason | Rule | Default |
| --- | --- | --- |
| sample too small | `denominator < minSample` | `minSample = 4` |
| no tendency | a play-type split below `minTendencyPercent`; a formation share below `minFormationPercent` | 60 %, 25 % |
| no concept mapping | the finding kind has no row for this plan unit (see §3) | |
| `no installed concepts of kind X` | the matching row's kinds have no installed approved concept | |
| uncertain finding | `kind: 'uncertain'` is never turned into a recommendation | |
| unreadable finding | the finding's dimensions could not be read from its statement (another compute version, hand-edited snapshot) | |

Package availability never blocks an item on its own: when no package of our unit is
available, items are still grounded on concepts, each carries the limitation "No … package
is available … choose personnel by hand", and `blockedReasons` records `no available
<unit> packages for week N` once so the UI can say so.

## 3. Matching table

Which finding becomes which recommendation for which plan, and which **installed, approved**
concept kinds may be attached. A concept is attached only when its `kind` is in the row.

| Our plan | Finding kind | Play type in finding | Recommendation type | Concept kinds attached |
| --- | --- | --- | --- | --- |
| defense | `formation_frequency` (opponent formation share) | — | `defend_formation` | `front`, `coverage` |
| defense | `play_type_by_formation` | `run` | `defend_run_tendency` | `front`, `pressure` |
| defense | `play_type_by_formation` | `pass` | `defend_pass_tendency` | `coverage`, `pressure` |
| defense | `tendency_by_situation` | `run` | `defend_situation_run` | `front`, `pressure` |
| defense | `tendency_by_situation` | `pass` | `defend_situation_pass` | `coverage`, `pressure` |
| defense | `strength` / `weakness` | — | `defend_general` | `front`, `coverage`, `pressure` |
| offense | `formation_frequency` (opponent defensive look share) | — | `attack_defensive_look` | `run`, `pass`, `protection` |
| offense | `strength` / `weakness` | — | `attack_general` | `run`, `pass`, `protection` |
| offense | `play_type_by_formation`, `tendency_by_situation` | any | *skipped*: play-type tendencies describe an offense | — |
| special teams | `formation_frequency`, `strength`, `weakness` | — | `special_teams_look` | `special_teams` |
| special teams | play-type findings | any | *skipped* | — |
| any | play type `other` | | *skipped*: only run and pass map to concept kinds | — |
| any | `uncertain` | | *skipped* | — |

Why these kinds: a run tendency is answered with run fits (fronts) and run-stopping pressures;
a pass tendency with coverages and pressures; a frequent formation needs both a front and a
coverage call; against a frequent defensive look the offense picks runs, passes and the
protection that goes with them. `formation` concepts are never attached automatically (the
offense's own formations are a coach's choice, not a response to film). Within a row, the
attached concepts are **all** installed approved concepts of those kinds, sorted by name; the
coach removes the ones that do not apply when accepting (`decision: 'edit'`).

Packages: all **available** packages of our unit are attached to every item; a package is
unavailable when any of its players is `out` for the game week, is `inactive` or
`unavailable` on the roster, or is not on the roster supplied. A `limited` player keeps the
package available and adds a caution to the item's limitations. With no game week, weekly
availability cannot be applied; only roster status is checked and the item says so.

## 4. What every item carries (§10 `Recommendation`)

- `statement` in plain coach language, built from a fixed template per recommendation type
  (see `statementFor` in `build.ts`): the look or situation, the count, the percentage, and
  what to have ready.
- `supportingFindings`: the finding id. `supportingEvidence`: the finding's evidence refs
  (asset id + timestamps), capped at 10.
- `counts`: `{ n, of, context }` with the exact denominator and how many games it spans.
- `limitations`, always including: sample size (and "small sample" below `2 × minSample`),
  review basis and the number of excluded segments, whether situation data was combined
  (overall tendency vs. one situation key only), single-game caveat when all evidence comes
  from one game, contrary counts, package caveats.
- `contraryEvidence` and a limitation line when a finding in the same group points the other
  way (the same formation or situation with another play type).
- `playbookConceptIds` and `personnelPackageIds` exactly as §3 describes.
- `status: 'proposed'`, `inputsHash` (see §5), `version: 1`. Nothing is ever auto-approved.

Items are ordered by percentage, then sample size, then finding id, so the strongest
tendency is first and the order is reproducible.

## 5. `inputsHash` and review flags (§15.3, §15.4)

`recommendationInputsHash(inputs)` is a sha256 over canonical JSON of: finding ids and values
(numerator, denominator, kind, review basis, game ids, compute version) plus the report's own
`inputsHash`; the approved playbook version id and the id, version and kind of every
installed approved concept; player ids, versions, roster status and per-week availability;
package ids, versions, units and membership; depth chart id and version; the week; our unit
and the game id. Array order never matters. `recommendationInputHashes(inputs)` also returns
the three component hashes (`labelsHash`, `playbookHash`, `personnelHash`) so the API can
tell *what* changed.

`planReviewFlags({ version, recommendations, currentHashes, baselineHashes? })` computes
§15.4 `ReviewFlag[]` on read, for a draft or approved version (never a superseded one):

- `stale_recommendation` with `itemId` for every plan item whose source recommendation is
  marked `stale`, whose stored `inputsHash` differs from `currentHashes.inputsHash`, or which
  can no longer be found; `since` is the recommendation's `createdAt` (or `decidedAt` when
  it was marked stale).
- `labels_changed` / `playbook_changed` / `personnel_changed` (version-level, no `itemId`)
  when a component hash differs between a baseline and now. The baseline is
  `baselineHashes` (hashes the API recorded when the version was created or approved, with
  `at`), else the component hashes stored alongside the referenced recommendations
  (`inputHashes`), else none (then only item flags are produced).

## 6. Honesty rules this module keeps

- Counts are copied from findings, never recomputed or rounded differently; `n ≤ of` always.
- A recommendation never names a player, assignment or outcome; it names looks, situations,
  counts and installed concepts.
- Nothing is proposed without at least one installed approved concept of an allowed kind.
- A finding's dimensions are read from the statement that `stats/findings.ts` wrote in this
  same package. A statement that does not parse is skipped, not guessed. (A structured
  `facets` field on `ScoutingFinding` would remove this coupling; proposed to the contracts
  owner.)
