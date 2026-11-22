# Hudl-derived fixtures

Real coach-tagged plays from a youth football program's 2026 season, exported from Hudl as a
breakdown CSV, plus that program's defensive playbook (a Hudl PDF export). The raw files are
owner-provided and **are not in the repository** (D-005 footage policy; the data names a real
team, its opponents and its athletes). Everything in this directory is derived and anonymized by
`packages/ai/bin/hudl-fixtures.mjs`; the tests in `test/hudl-fixtures.test.ts` read these
files and assert numbers that were hand-computed from the raw export.

## What is here

| File | Contents | Produced by |
| --- | --- | --- |
| `coach.jsonl` | 3,923 truth rows for the evaluation harness: one `{segmentId, gameId, key, value}` per play and label key; `value: null` where Hudl had no tag | converter |
| `predictions.jsonl` | 3,844 synthetic prediction rows: a seeded degradation of the truth (below) | converter |
| `bundle.json` | team id, opponents, 5 games, 15 assets (3 per game), 477 segments with synthetic offsets and the Hudl play metadata (quarter, result, gain, efficiency) | converter |
| `summary.json` | row counts per game and side, for this README; the tests do not read it | converter |
| `playbook-pages.json` | the PDF's text layer per page as `extractDocument` would hand it to `proposeFromPages` | PDFKit text dump (see below) |
| `playbook-concepts.json` | the 19 defensive calls and 3 fronts transcribed by hand from the rendered pages, with a kind each | by hand |

Games and sides (from `summary.json`):

| Week | Opponent | Our offense | Opponent offense | Special teams |
| --- | --- | --- | --- | --- |
| 1 | Opponent A | 32 | 34 | 23 |
| 2 | Opponent B | 38 | 42 | 22 |
| 3 | Opponent C | 23 | 25 | 27 |
| 4 | Opponent B | 41 | 46 | 15 |
| 5 | Opponent B | 46 | 43 | 20 |

Opponent B appears three times, which is what the opponent report and the game-level hold-out
need. Twenty Hudl rows of type `S` carried no play data and were skipped.

## How the export maps onto labels

Hudl tags every play from the exporting team's point of view (`ODK`). Here:

- `O` rows are our offense: asset `analyzedTeam: us`, `analyzedUnit: offense`.
- `D` rows are the opponent's offense: asset `analyzedTeam: opponent`, `analyzedUnit: offense`.
  Only these feed an opponent scouting report.
- `K` rows are special teams: asset `analyzedTeam: us`, `analyzedUnit: special_teams`.

| Label key | From | Note |
| --- | --- | --- |
| `unit` | side | `offense` for O and D rows, `special_teams` for K |
| `play_type` | `play_type` | `Run` → `run`, `Pass` → `pass`, any kick → `other`, blank → null |
| `formation_family` | `off_form`, lower-cased | tagged on 62 of 370 offensive plays; Opponent B's offense was never tagged |
| `situation_down` | `dn` | `1`–`4`; `0` and blank → null |
| `situation_distance` | `dist` | as tagged |
| `situation_field_position` | `yard_ln` | `-40` → `own 40`, `49` → `opp 49`, `50` → `50` |
| `hash` | `hash` | `L`/`M`/`R` → `left`/`middle`/`right` |
| `motion` | `motion_dir` | `yes` when a direction was tagged; blank → null (Hudl does not distinguish "none" from "untagged") |
| `special_teams_type` | `play_type` on K rows | `KO`/onside → `kickoff`, `Punt` → `punt`, PAT/2-pt → `fg_pat`, `KO Rec`/`Punt Rec` → `return` |

Dropped from the raw export: Hudl athlete ids, opponent jersey numbers, team tags, video and
clip ids (replaced by salted sha256 ids), opponent names (replaced by `Opponent A/B/C` in order
of first appearance). Game dates are kept.

**Synthetic offsets.** Hudl clips are separate files; `startSec`/`endSec` lay each asset's
clips end to end by play number using the clip durations. They are good enough to build
`PlaySegment` rows and evidence refs, but they are **not** segmentation truth: there is no
game video and no coach-marked boundary, so nothing here scores `matchSegments`.

**Synthetic predictions.** No model has run on this film. `predictions.jsonl` degrades the truth
with a seeded generator so the harness can be exercised at game scale: per key, a fixed share
of rows is kept correct, abstained, or swapped for another observed value of that key, and 2%
of rows are dropped as "missing". The evidence-only keys (`situation_*`) are never wrong, only
abstained, matching CONTRACTS §6. The shares are in `DEGRADATION` in the converter. Scores
computed from this file say nothing about any model.

## The playbook

The PDF is four pages: a cover and 19 diagrams, titled like `3-4 (…) BOMB TANGO vs PRO I`. Its
text layer does not contain the titles: PDFKit extracts only the yard-line numbers and position
letters of the diagrams (`BC FC`, `J T N E`). `playbook-pages.json` is that text, so it is the
realistic "diagram-only page" case for `proposeFromPages`; the text heuristics read the
position letters as headings and propose dozens of junk concepts. The titles in
`playbook-concepts.json` were transcribed by hand from the rendered pages, with the two
scheme names that identified the team replaced by `Odd` (3-4) and `Even` (4-3). The `kind`
of each call is the fixture author's reading of the diagram (rush lines = pressure, zone drops
only = coverage); the tests use it as the coach's decision, not as a football fact.

The page images are not included (Hudl branding, the team's own terminology).

## Regenerating

```
node packages/ai/bin/hudl-fixtures.mjs --csv <path to the Hudl breakdown CSV> --out packages/ai/test/fixtures/hudl
```

Output is byte-stable for the same input, salt and seed. `playbook-pages.json` was produced
once from the PDF on macOS with PDFKit (`PDFPage.string` per page, media box doubled for
`width`/`height`); any extractor that returns the text layer gives the same noise.
