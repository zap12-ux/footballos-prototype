# Evaluation plan and proposed acceptance targets (A4)

**Status: proposal for the owner to agree, amend or reject.** Nothing here has been
measured. Every number is a proposed target, not a result. The harness that will produce
the measurements is `packages/ai` (`npm run build -w packages/ai && node packages/ai/bin/eval.mjs`).

## 1. What is being evaluated

| Component | Question | Measured by |
| --- | --- | --- |
| Segmentation (media package) | Does the proposed play boundary match the coach's? | `matchSegments` IoU, precision/recall, boundary error |
| Vision labeling (this package) | When the model answers, is it right? When it is unsure, does it abstain? | per-key accuracy on predicted, abstention rate, confusion matrix |
| Usable coverage | How much coach work is saved without introducing errors? | correct / coach-labeled items |
| Correction burden | How long does a coach spend fixing a game? | timed review sessions (QA / usability protocol) |
| Full-game time and cost | What does one game cost and how long does it take? | `ModelProvenance` usage and latency summed per job |

## 2. Data needed (blocking)

- At least **3 full games** of fixed-sideline or end-zone footage with permission to process
  (D-005: none exists in the repository today). Different opponents preferred.
- **Coach labels** for every play in those games in the harness's JSONL shape
  (`segmentId, gameId, key, value`; `value: null` when the coach does not know).
- Coach-marked play boundaries (start/end seconds) for segmentation scoring.
- Labels must be made **before** seeing model output, by a coach, on the same clips.

## 3. Protocol

1. Split **by game**: hold out whole games (`--held-out-games` or the seeded
   `--held-out-fraction`). No clip from a held-out game is used for prompt tuning. The
   harness fails the run if a segment id appears in both a held-out and a training game.
2. Freeze the prompt (`promptHash`) and model id for a run; record both from provenance.
3. Run the labeler on every held-out segment with the production frame plan (1 fps,
   cap 12 frames). Store `ModelProvenance` for each call.
4. Convert stored labels to prediction JSONL (`abstained: true` when `inferred.abstained`).
5. Run the harness; file the JSON report under `docs/ai/results/<date>-<model>.json`
   (directory to be created when results exist).
6. Repeat for each candidate model on the same held-out games.

## 4. Proposed targets (for agreement)

| Area | Metric | Proposed target | Why this number |
| --- | --- | --- | --- |
| Segmentation | Recall of coach plays at IoU ≥ 0.5 | ≥ 0.90 | A missed play is invisible to the coach; recall matters more than precision |
| Segmentation | Precision at IoU ≥ 0.5 | ≥ 0.80 | Extra segments cost review time but not correctness |
| Segmentation | Median boundary error (start and end) | ≤ 1.0 s | One second keeps the snap and the result inside the clip |
| Formation family | Accuracy on predicted | ≥ 0.85 | Below this the tendency tables mislead more than they help |
| Formation family | Abstention rate | ≤ 0.30 | Above this the coach is labeling most plays anyway |
| Play type (run/pass) | Accuracy on predicted | ≥ 0.90 | Run/pass drives every tendency finding |
| Play type | Abstention rate | ≤ 0.25 | Frame sampling may miss the handoff; some abstention is expected and honest |
| Evidence-only keys (`situation_*`) | Error rate (wrong non-null) | 0 observed on the held-out set | A fabricated down/distance is a contract violation (CONTRACTS §6) |
| Validator rejections | Share of calls rejected (bad JSON, foreign timestamps) | ≤ 0.02 | Higher means the prompt or provider is unstable |
| Usable coverage | correct / labeled, formation and play type | ≥ 0.60 | At 60% the coach still checks everything but types little |
| Correction burden | Coach minutes per game to accept/correct labels | ≤ 30 min for a 150-play game | To be checked against the usability protocol; a baseline without AI must be timed first |
| Full-game time | Wall-clock for 150 segments, sequential | ≤ 45 min | Fits an evening; parallelism can lower it later |
| Full-game cost | USD per game at the primary model | ≤ $10 measured (estimate $8.2 at claude-opus-5-5, see MODEL_CANDIDATES §4) | Keeps three games inside the $25 default job budget |

Targets are per model and per key; a model may pass play type and fail formation. The
owner decides whether a partial pass ships (for example, play type on, formation off).

## 5. What the harness reports today

- Per key: `n`, `predicted`, `abstained`, `missing` (no prediction row), `correct`,
  `accuracyOnPredicted`, `abstentionRate`, `usableCoverage`, `errorRate`, confusion matrix
  (`truth → prediction or <abstain>`).
- Leakage check across the game split.
- Segmentation: IoU, greedy one-to-one matching at a threshold, precision, recall, mean IoU,
  mean/median boundary errors, unmatched indices.

Not reported yet (follow-ups): cost and latency aggregation across stored provenance (needs
the API's label store, task B-owned), inter-coach agreement (needs two coaches), and
calibration of `uncertainty` against correctness.

## 6. Open decisions for the owner

1. Agree or change the targets in §4.
2. Which three games, and who labels them.
3. Whether a second paid key (OpenAI) is authorized for the comparison, or whether the
   comparison stays Anthropic-only across Opus 5.5 / Sonnet 5.5 / Haiku 5.5.

## 7. First live call checklist (before any job runs with a key)

No live call has been made as of 2026-10-25. The request shape follows the official docs
but has only been exercised against a fake transport. The first call is a **single
segment**, run by hand, and its result is recorded before `POST /assets/:assetId/infer`
is used on a game.

1. **Environment.** `ANTHROPIC_API_KEY` exported in the shell only (never in a file in the
   repository, never in a console message). `FOOTBALLOS_AI_MODEL` left at the default or set
   to the model under evaluation; `FOOTBALLOS_AI_JOB_BUDGET_USD=1` for this check so a
   surprise costs at most one dollar.
2. **Input.** One accepted segment of demo or permitted footage, 5–10 s long, extracted at
   1 fps with the production cap (`planFrameSampling({ fps: 1, maxFrames: 12 })` →
   `extractFrames(src, plan.timestampsSec, { height: 720 })`). Keys:
   `["unit", "formation_family", "play_type", "situation_down"]` (the last one must come back
   abstained unless a down marker is visible).
3. **Confirm the request shape** before sending (log the params with the image data
   replaced by `<jpeg n bytes>`): `model`, `max_tokens`, `system[0].cache_control`,
   `output_config.format.type === "json_schema"`, `output_config.effort`, one text/image pair
   per frame with `t=…s` in the text, the context block with `<team_cues untrusted="true">`.
   Nothing else; no `tool_choice`, no `fallbacks`.
4. **Send once.** If the API rejects the request (400), record the error body verbatim in
   `docs/ai/results/first-call-<date>.md` and fix the adapter; do not loop on retries.
5. **Record provenance.** From the returned `ModelProvenance`: `model` (the served id, which
   may be a dated snapshot), `promptId`/`promptHash`, `inputTokens`, `outputTokens`,
   `costUsd`, `latencyMs`, `inspected.frameTimestampsSec`. Compare `costUsd` with the
   invoice line in the provider console the next day and note any difference in the same
   results file.
6. **Check the labels against the frames by eye:** every non-null value cites frame
   timestamps that were sent; `situation_*` is abstained unless a marker is visible; the
   validator accepted the response without rewriting anything.
7. **Only then** raise the budget back to the default and run one asset through
   `POST /assets/:assetId/infer`; review the job's `skipped` list and total `costUsd`.

## 8. Recommendation usefulness: a review protocol for coaches (proposal, not a result)

`buildRecommendations` is deterministic, so its accuracy is the accuracy of the underlying
labels (§4). What it cannot measure about itself is whether the items are **useful** to the
staff. This protocol is proposed for the first two game weeks in which a staff uses the
recommendations panel; nothing below has been run.

**Setup.** One opponent with at least two reviewed games of film, an approved playbook with
installed concepts, personnel entered with availability for the week. Generate once
(`POST /games/:gameId/recommendations/generate`) and freeze the list for the review.

**Reviewers.** The coordinator of the unit and one position coach, independently, before the
weekly plan is written. Reviewers see the items exactly as the UI shows them (statement,
counts, evidence links, limitations, suggested concepts and packages).

**Per item, each reviewer records:**

| Field | Values | Why |
| --- | --- | --- |
| Agree with the tendency | yes / no / unsure | Do the counts match what the coach saw on film? Follow two evidence links before answering. |
| Would act on it | accept as is / accept with edit / reject / defer | Mirrors `POST /recommendations/:id/decide`, so the decision is also the measurement. |
| Concept suggestions | all apply / some apply / none apply | Tests the matching table in `docs/ai/RECOMMENDATIONS.md` §3. |
| Package suggestions | right / wrong / not applicable | Tests availability handling. |
| Limitations | helpful / noise / missing one (free text) | Are the caveats the ones a coach would state? |
| Minutes spent | number | Time cost of the review. |

**Also recorded per week:** the `blockedReasons` and `skipped` lists shown by the UI, with a
one-line coach judgement for each ("rightly withheld" / "should have been shown"); items the
coach added to the plan by hand that the generator did not propose (misses).

**Proposed targets (for the owner to agree or change):**

| Metric | Proposed target | Note |
| --- | --- | --- |
| Agreement with tendency (both reviewers) | ≥ 0.80 of items | Below this, the labels or the thresholds are wrong, not the wording |
| Acted on (accept or edit) | ≥ 0.50 of items | Recommendations are suggestions; half being useful is a strong week |
| Concept suggestions "none apply" | ≤ 0.20 of items | Higher means the matching table needs team-specific rows |
| Wrong package suggestions | 0 | A package with an `out` player is a defect |
| Inter-reviewer agreement on "would act" | ≥ 0.70 | Below this the statements are ambiguous |
| Review time | ≤ 15 min per unit per week | |
| "Should have been shown" among withheld | ≤ 0.10 | Tests `minSample` 4 and the 60 % / 25 % thresholds |

**Outputs.** A short table per week under `docs/ai/results/recommendations-<week>.md` with the
counts above and the free-text misses, plus any threshold or matching-table change proposed
from it. Changing a threshold or a table row is a code change with a documented reason, not
a per-game tweak.

**Not measured by this protocol.** Game outcomes: whether a plan "worked" depends on far
more than these items, and a season of games is too few to separate the two. The protocol
measures whether coaches found the items true, actionable and honestly caveated.

## 9. Coach-labeled set: the export B's API must produce

The harness scores a **truth** file against a **prediction** file, both JSONL, one row per
(segment, key). B's export of a reviewed asset or game produces both from stored rows:

Truth (`coach.jsonl`), one row per `Label` whose `accepted.status` is `accepted` or
`corrected` (a coach decision), plus `unknown` and `rejected` as `value: null`:

```json
{"segmentId":"<PlaySegment.id>","gameId":"<PlaySegment.gameId>","key":"<LabelKey>","value":"trips"}
{"segmentId":"<PlaySegment.id>","gameId":"<PlaySegment.gameId>","key":"situation_down","value":null}
```

Predictions (`predictions.jsonl`), one row per `Label` with a non-null `inferred` block,
regardless of what the coach later decided:

```json
{"segmentId":"<PlaySegment.id>","gameId":"<PlaySegment.gameId>","key":"<LabelKey>","value":"trips","abstained":false}
{"segmentId":"<PlaySegment.id>","gameId":"<PlaySegment.gameId>","key":"situation_down","value":null,"abstained":true}
```

Rules for the export:
- `value` is the raw stored string (`accepted.value` for truth, `inferred.value` for
  predictions); no normalisation beyond what the harness does (trim, case-insensitive
  `"unknown"` → null).
- Rows with `accepted.status === 'inferred'` are **not** truth: the coach has not looked.
- Superseded segments (`supersededBy.length > 0`) and `rejected` segments are omitted from
  both files.
- Include the `ModelProvenance` ids used for the predictions in a sidecar
  `provenance.json` (`{ promptHash, model, provenanceIds: [...] }`) so a run is tied to
  one prompt and model; the harness will refuse mixed prompt hashes in a later version.
- Labels made before the model ran (coach labeled first) are preferable; the export
  should carry `LabelRevision.at` so a later check can tell which came first.

Run: `node packages/ai/bin/eval.mjs --truth coach.jsonl --pred predictions.jsonl --held-out-games <gameId,...> --json docs/ai/results/<date>-<model>.json`.
