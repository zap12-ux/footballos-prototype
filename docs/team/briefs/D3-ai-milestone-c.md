# Brief D3 — Applied AI / Scouting Engineer, Milestone C (task C3-lib)

Read `COMMON.md` first, then `docs/team/CONTRACTS.md` **§15.1, §15.3, §15.4, §15.5**, §8, §10,
§11, and `packages/ai/README.md`. Worktree: `/Users/zachariahparkhill/Projects/FootballOS/.worktrees/d3-ai`,
branch `wt/d3-ai`. Allowed paths: `packages/ai/**`, `docs/ai/**`. No key, **no paid call**.

## Deliverables (commit a WIP after each)
1. `proposeFromPages(pages, { labeler?, vocabulary? })` per §15.5. Text heuristics first:
   headings and numbered lines become `ProposedConcept { name, kind (guessed from vocabulary:
   run/pass/protection/front/coverage/pressure/special_teams/formation/other), description,
   sources: [{ pageNumber, excerpt }], basis:'text', note }`; "Term — definition" and
   "Term: definition" lines become `ProposedTerm`. When a `labeler` is provided and a page has
   `textSource:'none'`, send the page image with a document prompt (new versioned prompt
   `src/prompts/playbook-page.v1.md`, JSON schema output: concepts/terms with `abstained`
   per page) and record `ModelProvenance`; when the labeler is unavailable, skip with
   `basis:'none'` and a note. Never invent plays from a diagram without text or a model
   result; proposals from images carry `basis:'model'` and the page number only.
2. `buildRecommendations(...)` per §15.3/§15.5: deterministic; inputs are the scouting
   report (reviewed-only), the approved playbook's installed concepts, personnel (players,
   availability for the game week, packages, depth chart). Produce items only for findings
   with `denominator ≥ minSample` (default 4; below it, add to `blockedReasons` or
   `limitations`), each with `statement` in plain coach language, `supportingFindings`,
   `supportingEvidence` (from the findings' evidence refs), `counts`, `limitations`
   (sample size, review basis, missing situation data, single-game caveat), `contraryEvidence`
   when another finding conflicts, `playbookConceptIds` (only installed approved concepts
   whose `kind` matches the recommendation type: e.g. a run tendency → defensive front/fit
   concepts for a defense plan; an opponent coverage tendency → pass concepts for offense),
   `personnelPackageIds` (only available packages). Define the matching table in code and in
   `docs/ai/RECOMMENDATIONS.md` so coaches can see why a concept was suggested. If nothing
   grounds, return `[]` with `blockedReasons` ("no approved playbook", "no installed concepts
   of kind X", "no available packages", "sample too small").
3. `recommendationInputsHash(inputs)` (stable sha256 over finding ids+values, playbook version
   id + installed concept ids/versions, personnel ids/versions/availability) and
   `planReviewFlags({ version, recommendations, currentHashes })` → `ReviewFlag[]` per §15.4.
4. Tests with hand-built fixtures: heuristics on the Media fixture-like text (headings,
   numbered plays, term lines), model path with a fake labeler (abstention, provenance,
   unavailable), recommendation grounding (installed-only, available-only, min sample,
   contrary evidence, blocked reasons), hash stability and flag computation.
5. `docs/ai/RECOMMENDATIONS.md`: the grounding rules and matching table; update
   `EVALUATION_PLAN.md` with a "recommendation usefulness" review protocol for coaches
   (proposal, not a result).

## Acceptance (board C3-lib)
`npm run typecheck -w packages/ai`, `npm test -w packages/ai` green; signatures as §15.5.

## Owner question
None expected.
