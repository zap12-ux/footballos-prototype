# @footballos/ai

Applied-AI library for FootballOS (task A4). It provides:

- a replaceable **`VisionLabeler`** adapter with the **Anthropic Messages API** as the
  primary implementation, an **OpenAI stub** and a **`NullLabeler`**;
- honest **abstention and provenance**: every label carries `value | null`, `abstained`,
  a short `rationale`, `evidence` that references only frames that were actually sent,
  and a `ModelProvenance` record filled from the real response `usage`;
- a **frame-sampling plan** (which timestamps to inspect, and what is *not* inspected);
- deterministic **scouting statistics** from stored labels (`ScoutingFinding[]`);
- an **evaluation harness** for coach-labeled footage with a held-out-by-game split;
- documentation: `docs/ai/MODEL_CANDIDATES.md` (official-doc comparison with URLs and
  access dates) and `docs/ai/EVALUATION_PLAN.md` (proposed acceptance targets).

No API key exists in the development environment and **no paid call has been made**; all
adapter tests run through a fake transport.

## Architecture

```
packages/ai/src
├── types.ts            structural copies of CONTRACTS §5–§7, §10 (until @footballos/contracts lands)
├── errors.ts           ProviderUnavailableError { reason, retryable } — the only adapter error
├── config.ts           defaults + env overrides (model, effort, budget, frame caps, timeout)
├── cost/
│   ├── pricing.ts      price table (dated source), cost from usage, pre-call estimate
│   └── budget.ts       JobBudget: reserve → call → settle; aborts before an over-budget call
├── prompts/
│   ├── label-segment.v1.md   versioned prompt; sha256 → ModelProvenance.promptHash
│   └── index.ts
├── labeler/
│   ├── types.ts        VisionLabeler, LabelSegmentInput/Output
│   ├── schema.ts       JSON schema sent as output_config.format + zod mirror + vocabularies
│   ├── validate.ts     rejects foreign timestamps, valueless abstentions, missing evidence…
│   ├── input.ts        rejects malformed/oversized input before spending
│   ├── anthropic.ts    AnthropicVisionLabeler (injectable transport)
│   ├── openai.ts       stub → provider_unavailable (no_api_key / not_implemented)
│   ├── null.ts         NullLabeler → provider_unavailable
│   └── factory.ts      createVisionLabeler('anthropic'|'openai'|'none')
├── frames/plan.ts      planFrameSampling({startSec,endSec,fps,maxFrames}) → timestamps + gaps
├── stats/              resolve.ts (effective value per review basis), findings.ts
└── eval/               jsonl.ts, split.ts, metrics.ts, segmentation.ts, cli.ts
bin/eval.mjs            CLI (needs `npm run build` first)
```

### Request flow (Anthropic)

1. `assertLabelInput` — frames non-empty, strictly ascending, ≤ `maxFramesPerSegment`.
2. Build the request: system prompt (cached block) + user turn of
   `Frame i of N — t=12.000s` text / JPEG image pairs, then a context block that names the
   exact timestamps shown, the asset context and the requested keys. Coach-provided
   `teamCues` are wrapped as `<team_cues untrusted="true">` data.
3. `JobBudget.reserve(estimate)` — the conservative pre-call estimate (frame tokens from
   `⌈w/28⌉×⌈h/28⌉`, full `maxOutputTokens`) must fit the remaining budget or the call is
   refused with `budget_exceeded`.
4. One non-streaming `messages.create` with `output_config.format = { type: "json_schema" }`
   and `output_config.effort` (adaptive thinking stays on for the Claude 5 family; forced
   `tool_choice` is not used because it is rejected on these models).
5. `stop_reason` checks: `refusal` → `provider_unavailable(refusal)`; `max_tokens` →
   `truncated_output`. Then JSON parse and `validateLabelResponse`.
6. `ModelProvenance` from `message.model` (the model that actually served) and `usage`
   (input, cache write, cache read, output tokens → `costUsd` from the price table).

Anything that goes wrong raises `ProviderUnavailableError` with a `reason` and
`retryable` flag. There is never a canned label.

## Running with a key

```bash
export ANTHROPIC_API_KEY=...            # never committed, never logged
export FOOTBALLOS_AI_MODEL=claude-opus-5-5   # default; see docs/ai/MODEL_CANDIDATES.md
export FOOTBALLOS_AI_EFFORT=medium
export FOOTBALLOS_AI_JOB_BUDGET_USD=25  # owner decision 2026-10-25
```

```ts
import { createVisionLabeler, planFrameSampling, JobBudget } from "@footballos/ai";

const budget = new JobBudget(25);
const labeler = createVisionLabeler("anthropic", { budget });
if (!labeler.isAvailable()) {
  // provider_unavailable path: show the manual-labeling UI
}
const plan = planFrameSampling({ startSec: seg.startSec, endSec: seg.endSec, fps: 1, maxFrames: 12 });
// @footballos/media extracts JPEGs at plan.timestampsSec → frames[]
const { labels, provenance } = await labeler.labelSegment({
  segment: seg, frames, context: asset.context,
  labelKeys: ["unit", "formation_family", "play_type", "motion"],
  samplingFps: 1, resolution: "1280x720",
});
```

Store `provenance` and reference it from each `Label.provenanceId`. `provenance.inspected`
and `plan.note` together say exactly what the model saw and did not see.

## Cost controls

| Control | Default | Env |
| --- | --- | --- |
| Per-job abort threshold | $25 | `FOOTBALLOS_AI_JOB_BUDGET_USD` |
| Max frames per segment | 12 | `FOOTBALLOS_AI_MAX_FRAMES_PER_SEGMENT` |
| Max segments per job | 200 | `FOOTBALLOS_AI_MAX_SEGMENTS_PER_JOB` (enforced by the job runner; exported in config) |
| Max output tokens | 4096 | `FOOTBALLOS_AI_MAX_OUTPUT_TOKENS` |
| Request timeout | 120 s | `FOOTBALLOS_AI_REQUEST_TIMEOUT_MS` |

The budget is a `JobBudget` instance shared across all calls of one job: every call is
reserved before it is sent and settled with the real cost from `usage`. A model that is not
in the price table is refused (we never spend an amount we cannot account for). SDK
retries are disabled (`maxRetries: 0`) so the job runner owns retries and each attempt is
budgeted and recorded.

## Evaluation harness

```bash
npm run build -w packages/ai
node packages/ai/bin/eval.mjs --truth coach.jsonl --pred predictions.jsonl --held-out-games game_3 [--json report.json]
```

Synthetic fixtures live in `test/fixtures/`. See `docs/ai/EVALUATION_PLAN.md`.

## Tests

```bash
npm run typecheck -w packages/ai
npm test -w packages/ai
```

## What is untested / known limitations

- **No real model call has been made.** The request shape follows the official
  structured-outputs and vision docs (cited in `docs/ai/MODEL_CANDIDATES.md`), but the
  first live call with a key may surface schema or parameter issues (for example the
  `enum` containing `null` for `uncertainty`). Run one segment manually before a job.
- `costUsd` is computed from a hand-maintained price table dated 2026-10-25; it is `null`
  for unknown models. Adaptive-thinking tokens are billed as output and are included only
  through the real `usage.output_tokens`.
- Refusal fallbacks (`fallbacks` parameter) are deliberately **not** enabled: a silent
  model switch would make `ModelProvenance.model` differ from the configured model without
  the job noticing. A refusal is reported as `provider_unavailable(refusal)` instead.
- The OpenAI adapter is a stub; Qwen3-VL is documentation only.
- `types.ts` duplicates the contract shapes until `@footballos/contracts` exists.
- Statistics use `StatSegment.unit`, which the API layer must derive from the asset's
  `analyzedUnit` or the coach's `unit` label.
