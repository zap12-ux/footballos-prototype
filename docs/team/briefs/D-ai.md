# Brief D — Applied AI / Scouting Engineer (task A4)

Read `COMMON.md` first. Worktree: `/Users/zachariahparkhill/Desktop/Developing AI Solutions/FootballOS/.worktrees/d-ai`, branch `wt/d-ai`.
Allowed paths: `packages/ai/**`, `docs/ai/**`. No API keys exist in this environment and
**no paid call may be made**; everything is tested through fake transports.

## Goal
A library package `@footballos/ai` providing: a replaceable vision-labeling adapter with
the Anthropic Messages API as the primary implementation, honest abstention and provenance,
deterministic scouting statistics computed from stored labels, an evaluation harness for
coach-labeled footage, and a model-candidate comparison grounded in current official
documentation.

## Stack (decided)
TypeScript ESM, `@anthropic-ai/sdk` (official), `zod`, vitest. OpenAI adapter may use
`openai` official SDK but must be a stub that conforms to the interface and returns a
truthful `provider_unavailable` error without a key. Types follow
`docs/team/CONTRACTS.md` §6–§7 and §10 (`Label.inferred`, `EvidenceRef`,
`ModelProvenance`, `ScoutingFinding`, `Recommendation`); until `@footballos/contracts`
lands, declare structural types with the same field names in `src/types.ts` and note it.

## Deliverables
1. `VisionLabeler` interface: `labelSegment(input: { segment, frames: { atSec, jpegBase64 }[] (ordered), context: { analyzedTeam, analyzedUnit, perspective, teamCues (untrusted text) }, labelKeys[] }) → { labels: InferredLabel[], provenance: ModelProvenance }`. Frames carry timestamps in the prompt text; the response schema forces `value | null` with `abstained` and a short `rationale` and `evidence` referencing only timestamps that were actually sent. Reject any model output referencing a timestamp outside the inspected set.
2. `AnthropicVisionLabeler`: uses the official SDK with an injectable `transport`/client
   for tests; model id from config (verify current vision-capable model ids and the image
   limits per request from official docs; the newest Claude family is Claude 5: ids
   `claude-sonnet-5-5`, `claude-opus-5-5`, `claude-haiku-5-5`, `claude-fable-5-1`; confirm
   which support image input and their per-image limits and prices, with URLs and access
   dates); structured output via a JSON schema or tool-use definition; prompt templates
   versioned in `src/prompts/*.md` with a computed `promptHash`; `ModelProvenance` filled
   from real response usage fields; errors mapped to `provider_unavailable` (retryable or
   not) — never a canned result.
3. `OpenAIVisionLabeler` stub as above; `NullLabeler` for environments without a provider
   that returns `provider_unavailable` so manual labeling remains the path.
4. `frames/`: frame-sampling plan from a segment (`startSec`, `endSec`, `fps`, cap of N
   frames) returning the exact timestamps to extract, with a note of what is not inspected
   (the media package extracts actual JPEGs; you consume them). Include a test that
   sampling at 1 fps over a 7 s play yields ordered timestamps and that the plan records
   coverage gaps.
5. `stats/`: pure functions from `(segments, labels)` to `ScoutingFinding[]`: formation
   frequency, play type by formation, tendency by available situation keys, per unit; each
   with numerator, denominator, percent (null when denominator 0), includedSegmentIds,
   excludedSegmentIds with reasons (`unknown`, `rejected`, `unreviewed` when
   `reviewBasis:'reviewed_only'`), and `reviewBasis`. Tests with hand-computed expectations,
   including unknown handling and the reviewed-only vs includes-inferred difference.
6. `eval/`: harness that reads coach labels (JSONL: segmentId, gameId, key, value) and
   predictions (same shape plus `abstained`), splits by `gameId` (held-out games, no clip
   leakage), and reports per key: accuracy on non-abstained, abstention rate, usable
   coverage, confusion matrix, plus segmentation IoU/boundary error utilities. Tests on a
   small synthetic set. CLI `bin/eval.mjs`.
7. `docs/ai/MODEL_CANDIDATES.md`: Anthropic Claude, OpenAI GPT vision models, Qwen3-VL
   (open source): supported inputs (image/video), per-request media limits, context,
   pricing, data retention/training policy, licensing, hosting needs; every fact with its
   official URL and the date you read it; a recommendation for the primary adapter and what
   measurement is needed before switching. Use web research of official documentation
   only. `docs/ai/EVALUATION_PLAN.md`: proposed measurable acceptance targets for the
   owner to agree (segmentation, formation, play type, abstention/coverage, correction
   burden, full-game time and cost), clearly marked as proposals.
8. README: architecture, how to run with a key (`ANTHROPIC_API_KEY`), cost controls
   (max frames per segment, max segments per job, per-job budget abort), what is untested.

## Acceptance (TASK_BOARD A4)
Adapter tests with a fake transport; stats tests with hand-computed expectations; harness
runs on a synthetic labeled set; comparison doc cites current official pages; no paid call.
`npm run typecheck -w packages/ai`, `npm test -w packages/ai`.

## Genuine owner questions you may ask
- The monthly evaluation budget cap to encode as the default per-job abort threshold.
  Recommend: $25 for development evaluation. Non-blocking.
