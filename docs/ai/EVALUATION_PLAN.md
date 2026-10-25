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
