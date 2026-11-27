# @footballos/ai

Applied-AI library for FootballOS (tasks A4, B4-lib, B5-lib, C3-lib). It provides:

- the **`VisionLabeler`** adapter over a **local Ollama server** running an open-source vision
  model (default `qwen3-vl:4b`); no API key, no per-call cost, film never leaves the host;
- honest **abstention and provenance**: every label carries `value | null`, `abstained`,
  a short `rationale`, `evidence` that references only frames that were actually sent,
  and a `ModelProvenance` record filled from the real token counts Ollama reports;
- a **frame-sampling plan** (which timestamps to inspect, and what is *not* inspected);
- deterministic **scouting statistics** from stored labels (`ScoutingFinding[]`), the
  **scouting report** body of CONTRACTS §14.6 and its `ReportSnapshot`;
- the **`infer_labels` job handler** (CONTRACTS §14.8) that B's worker hosts, plus
  `applyInference` (coach corrections survive reprocessing) and `bulkAcceptPlan`;
- **playbook proposals** (`proposeFromPages`, CONTRACTS §15.1/§15.5): text heuristics on
  extracted pages, and a `PageLabeler` (Ollama implementation, versioned `playbook-page`
  prompt) for image-only pages that abstains and records provenance; nothing is proposed
  from a diagram without a model result;
- **grounded recommendations** (`buildRecommendations`, §15.3), `recommendationInputsHash`
  and `planReviewFlags` (§15.4): deterministic, cite findings and evidence, reference only
  installed approved concepts and available packages; rules in `docs/ai/RECOMMENDATIONS.md`;
- an **evaluation harness** for coach-labeled footage with a held-out-by-game split;
- documentation: `docs/ai/MODEL_CANDIDATES.md` (the historical hosted-model comparison) and
  `docs/ai/EVALUATION_PLAN.md` (proposed acceptance targets).

All adapter tests run through a fake `fetch` that behaves like Ollama's three endpoints; a
live call needs Ollama running with the model pulled (see "Running against Ollama").

## Architecture

```
packages/ai/src
├── types.ts            thin aliases over @footballos/contracts (Label, ModelProvenance, PlaySegment, …)
├── errors.ts           ProviderUnavailableError { reason, retryable } — the only adapter error
├── config.ts           defaults + env overrides (OLLAMA_HOST, model, frame caps, timeout, keep_alive)
├── ollama/client.ts    OllamaClient (/api/version, /api/show, /api/chat) + checkOllama preflight + error mapping
├── prompts/
│   ├── label-segment.v1.md   versioned prompt; sha256 → ModelProvenance.promptHash
│   └── index.ts
├── labeler/
│   ├── types.ts        VisionLabeler, LabelSegmentInput/Output
│   ├── schema.ts       JSON schema sent as Ollama `format` + zod mirror + vocabularies
│   ├── validate.ts     rejects foreign timestamps, valueless abstentions, missing evidence…
│   ├── input.ts        rejects malformed/oversized input before any request
│   ├── ollama.ts       OllamaVisionLabeler (injectable client / fetch)
│   └── factory.ts      createVisionLabeler({ env?, config?, fetchImpl? }), createPageLabeler(...)
├── frames/plan.ts      planFrameSampling({startSec,endSec,fps,maxFrames}) → timestamps + gaps
├── jobs/infer-labels.ts   createInferLabelsHandler({ labeler, extractFrames, maxFramesPerSegment, … }) (§14.8)
├── labels/apply.ts     applyInference(existing, segmentId, inferred, provenanceId), bulkAcceptPlan
├── stats/              resolve.ts (effective value per review basis), findings.ts
├── scouting/report.ts  buildScoutingReport(...) → §14.6 body; snapshotFromReport(...) → ReportSnapshot
├── playbook/
│   ├── types.ts        ProposalPage, ProposedConcept/Term, PageLabeler, ProposeResult
│   ├── vocabulary.ts   DEFAULT_CONCEPT_VOCABULARY, guessKind (team vocabulary merged over it)
│   ├── heuristics.ts   headings / numbered plays → concepts; "Term — definition" → terms
│   ├── schema.ts       JSON schema + zod for the page model output, validatePageResponse
│   ├── ollama-page-labeler.ts  OllamaPageLabeler (one page image per call)
│   └── propose.ts      proposeFromPages(pages, { labeler?, vocabulary?, loadImage?, modelUnavailable? })
├── recommendations/
│   ├── matching.ts     REPORT_UNIT_FOR_PLAN_UNIT, CONCEPT_KINDS_BY_RECOMMENDATION, classifyFinding
│   ├── build.ts        buildRecommendations(...) → { items, blockedReasons, inputsHash, skipped, packages, types }
│   ├── hash.ts         recommendationInputsHash / recommendationInputHashes (labels, playbook, personnel)
│   └── flags.ts        planReviewFlags({ version, recommendations, currentHashes, baselineHashes? })
├── prompts/playbook-page.v1.md   document prompt (sha256 → promptHash)
└── eval/               jsonl.ts, split.ts, metrics.ts, segmentation.ts, cli.ts
bin/eval.mjs            CLI (needs `npm run build` first)
```

### Request flow (Ollama)

1. `assertLabelInput` — frames non-empty, strictly ascending, ≤ `maxFramesPerSegment`.
2. Build the request: the system message is the versioned prompt; the user message carries the
   JPEG frames as `images` in timestamp order and a text that lists `Frame i of N — t=12.000s`
   for each one, the exact timestamps shown, the asset context and the requested keys.
   Coach-provided `teamCues` are wrapped as `<team_cues untrusted="true">` data.
3. One non-streaming `POST /api/chat` with `format` = the label JSON schema,
   `options.temperature = 0`, `options.num_predict = maxOutputTokens` and `keep_alive`.
4. `done_reason === 'length'` → `provider_unavailable(truncated_output)`. Then JSON parse and
   `validateLabelResponse` (foreign timestamps, valueless abstentions, missing evidence are rejected).
5. `ModelProvenance` from the response's `model` (the tag that actually served) and
   `prompt_eval_count` / `eval_count` (input / output tokens); `costUsd` is 0.

Anything that goes wrong raises `ProviderUnavailableError` with a `reason` and
`retryable` flag: `unreachable` (server down; names the host and `ollama serve`),
`model_missing` (names `ollama pull <model>`), `model_not_vision`, `network` (timeout,
retryable), `server_error` (retryable), `bad_request`, `truncated_output`,
`invalid_model_output` (retryable: a fresh sample may validate), `input_rejected`.
There is never a canned label.

## Running against Ollama

```bash
# once per machine
brew install ollama            # or https://ollama.com/download
ollama serve                   # the desktop app does this for you
ollama pull qwen3-vl:4b        # ~3.5 GB; qwen3-vl:8b (~6 GB) on a 16 GiB+ server

export OLLAMA_HOST=http://127.0.0.1:11434   # default
export FOOTBALLOS_AI_MODEL=qwen3-vl:4b      # any tag whose `ollama show` lists the vision capability
```

```ts
import { checkOllama, createVisionLabeler, loadAiConfig, planFrameSampling } from "@footballos/ai";

const config = loadAiConfig();
const status = await checkOllama(config);        // { ok: true, version, model } | { ok: false, reason, message }
if (!status.ok) {
  // provider_unavailable path: show the manual-labeling UI and the message (it names the fix)
}
const labeler = createVisionLabeler({ config });
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

## The `infer_labels` job (B hosts it)

```ts
import { checkOllama, createInferLabelsHandler, createVisionLabeler, applyInference } from "@footballos/ai";
import { extractFrames } from "@footballos/media";

const status = await checkOllama(config);
if (!status.ok) throw new NonRetryableError("provider_unavailable", `${status.reason}: ${status.message}`);
const handler = createInferLabelsHandler({
  labeler: createVisionLabeler({ config }),
  extractFrames,
  maxFramesPerSegment: 12,  // FOOTBALLOS_AI_MAX_FRAMES_PER_SEGMENT
});
// job.input = { assetId, sourcePath, context, labelKeys, segments: [{ id, startSec, endSec, fps }] }
const result = await handler({ id: job.id, input }, { signal, progress: (done, total, message) => … });
// result = { perSegment: [{ segmentId, labels, provenance }], skipped: [{ segmentId, reason, detail }], costUsd: 0 }
for (const p of result.perSegment) {
  const { upserts } = applyInference(existingLabelsOfSegment, p.segmentId, p.labels, p.provenance.id, { teamId });
  // persist p.provenance and upserts in one transaction
}
```

- `skipped.reason` is one of `provider_unavailable` (segment-local, non-retryable: truncated or
  invalid output, rejected input), `no_frames`, `frame_extraction_failed`, `invalid_segment`,
  `canceled` (after `ctx.signal` aborted). A **retryable** provider error (timeout, 5xx) and a
  job-wide one (`unreachable`, `model_missing`, `model_not_vision`) are **thrown** as
  `ProviderUnavailableError` with `retryable` preserved; `labeler.isAvailable() === false`
  fails the job before any extraction. Run `checkOllama` first so the job fails with the fix in
  its message before a single frame is extracted.
- `applyInference` never changes `accepted` when its status is `accepted`, `corrected` or
  `rejected`; it bumps `version`, writes the new `inferred` block and `provenanceId`.
  `bulkAcceptPlan(labels, { segmentIds, keys })` lists exactly the ids a bulk accept changes
  (`accepted.status === 'inferred'` and not abstained) and why each other label is skipped.

## Scouting report

```ts
const report = buildScoutingReport({ teamId, opponentId, unit: "offense", reviewBasis: "reviewed_only", games, assets, segments, labels, gameIds });
// → { findings, games: [{ gameId, assetIds }], sampleSize, computedAt, computeVersion, inputsHash, teamId, opponentId, unit, reviewBasis }
const snapshot = snapshotFromReport(report, title, userId);   // ReportSnapshot (§7)
```

Only the opponent's games (optionally filtered by `gameIds`), their assets with
`context.analyzedTeam === 'opponent'` that are not `deleted`/`rejected`, and the segments of
those assets are used. A segment's unit is the coach's `unit` label when it names a unit,
else the asset's `analyzedUnit` unless that is `mixed`, else unknown (excluded, never guessed).
`inputsHash` is a sha256 over the row ids and versions and the parameters, so a snapshot
can be compared with a recomputation. Finding ids are deterministic UUIDs (RFC 9562 v8 over a
sha256 of the finding's inputs).

## Playbook proposals (C3-lib)

```ts
import { checkOllama, createPageLabeler, proposeFromPages } from "@footballos/ai";

// pages: C's extractDocument(...).pages, or PlaybookPage rows mapped to { pageNumber, text, textSource, imagePath }
const status = await checkOllama(config);
const r = await proposeFromPages(pages, status.ok
  ? { labeler: createPageLabeler({ config }), vocabulary: team.conceptVocabulary }
  : { modelUnavailable: `${status.reason}: ${status.message}`, vocabulary: team.conceptVocabulary });
// r = { concepts: ProposedConcept[], terms: ProposedTerm[], basis: 'text'|'model'|'none', note, pages: PageOutcome[], provenance: ModelProvenance[] }
```

- Pages with text (`textSource: 'pdf_text' | 'ocr'`) go through the heuristics: a short
  Title-Case/ALL-CAPS line is a concept heading, `1. Name — description` is a numbered play,
  `Term — definition` / `Term: definition` is a term. Section headings ("Run Game",
  "Protections", "Terms") set the kind of what follows and are not themselves concepts;
  install-day, week and title lines are ignored. `kind` is guessed from the team vocabulary
  merged over `DEFAULT_CONCEPT_VOCABULARY` (longest phrase wins), else the section's kind,
  else `other`. Every text proposal cites `{ pageNumber, excerpt }` and `basis: 'text'`.
- Pages with `textSource: 'none'` are sent as an image **only** when a `labeler` is given and
  `isAvailable()`; the model may abstain. Model proposals carry `basis: 'model'`, the page
  number only (`excerpt: null`) and a note naming the model; `provenance[]` holds one
  `ModelProvenance` per call (for a page, `preprocessing.frameCount` is 1 and `inspected` is
  zeroed: a page has no timestamps). Without a labeler the page yields nothing and
  `pages[i].note` says so, quoting `modelUnavailable` when given. A page-local provider error
  skips the page; `unreachable`, `model_missing`, `model_not_vision` stop further calls.
- Persisting (B): `ProposedConcept` → `Concept { status:'proposed', installed:false, sources:
  sources.map(s => ({ documentId, pageNumber: s.pageNumber, bbox: null, excerpt: s.excerpt })) }`;
  `basis` and `note` are the §15.1 fields on the proposal.

## Recommendations (C3-lib)

```ts
import { buildRecommendations, recommendationInputHashes, planReviewFlags } from "@footballos/ai";

const { items, blockedReasons, inputsHash, skipped, packages } = buildRecommendations({
  report,                                   // buildScoutingReport(..., reviewBasis: 'reviewed_only') on the OPPONENT unit
  playbook: { versionId, status, concepts }, // the approved version and its concepts (any status)
  personnel: { players, packages, depthChart, week },
  unit: "defense", gameId,
});
const hashes = recommendationInputHashes({ report, playbook, personnel, unit, gameId }); // { inputsHash, labelsHash, playbookHash, personnelHash }
const flags = planReviewFlags({ version, recommendations, currentHashes: hashes, baselineHashes });
```

Rules, thresholds (`minSample` 4, tendency 60 %, formation share 25 %) and the matching table
are in `docs/ai/RECOMMENDATIONS.md`. `Player.availability` and `ReviewFlag` are typed in this
package (`PlayerAvailability`, `ReviewFlag`) until the contracts package carries them.

## Limits and configuration

| Setting | Default | Env |
| --- | --- | --- |
| Ollama server | `http://127.0.0.1:11434` | `OLLAMA_HOST` (scheme optional, as for the Ollama CLI) |
| Model tag | `qwen3-vl:4b` | `FOOTBALLOS_AI_MODEL` (must list the `vision` capability in `ollama show`) |
| Max frames per segment | 12 | `FOOTBALLOS_AI_MAX_FRAMES_PER_SEGMENT` |
| Max segments per job | 200 | `FOOTBALLOS_AI_MAX_SEGMENTS_PER_JOB` (enforced by the job runner; exported in config) |
| Max output tokens (`num_predict`) | 4096 | `FOOTBALLOS_AI_MAX_OUTPUT_TOKENS` |
| Request timeout | 300 s | `FOOTBALLOS_AI_REQUEST_TIMEOUT_MS` (CPU inference over 12 frames is slow) |
| Keep the model loaded | `10m` | `FOOTBALLOS_AI_KEEP_ALIVE` |
| Context-window cap (`num_ctx`) | 32 768 | `FOOTBALLOS_AI_MAX_NUM_CTX`; each call is sized to its frames (about 1 400 tokens per image plus the answer) and capped here. Ollama's own default of 4 096 would silently truncate a multi-frame request. |

Local inference has no per-call charge: `ModelProvenance.costUsd` is always 0 and there is no
spend cap. The real limits are time and memory on the host: `qwen3-vl:4b` needs about 3.5 GB
of RAM, `qwen3-vl:8b` about 6 GB, and a segment of 12 frames can take a minute or more on a
laptop CPU. The job runner owns retries; the client never retries on its own.

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

- **No real model call has been made from the test suite.** The request shape follows the
  Ollama API documentation (`/api/chat` with `images`, `format` as a JSON schema, `options`,
  `keep_alive`), but the first live call may surface differences in how a given model follows
  the schema (for example a `null` `uncertainty`). Run one segment manually before a job.
- Which open-source model labels film well is unmeasured. `qwen3-vl:4b` is the default because
  it fits the development machine; the evaluation harness exists to compare tags on
  coach-labeled footage before trusting any of them.
- `ModelProvenance.model` is the tag Ollama reports; it does not pin the model's digest. Record
  `ollama show <tag>` on the host when a result must be reproducible.
- `types.ts` imports the contracts; this package's `InferredLabel` is `{ key, inferred }`
  (the contracts' `InferredLabel` is the `inferred` block alone, aliased here as
  `InferredLabelBody`).
- A job that fails on a retryable provider error loses the segments already labeled in that
  attempt (the result is only returned on completion); per-segment checkpointing is a
  follow-up for the job runner.
- `extractFrames` is injected; the handler has not been run against C's real implementation.
- The playbook heuristics are rules, not understanding: a Title-Case sentence fragment can
  become a concept and a schedule-like "X: Y" line a term. The coach's review is the filter.
  No real playbook PDF has been processed (none exists in the repository, board X1).
- `OllamaPageLabeler` has only been exercised against a fake server; the same
  first-live-call caution as for the segment labeler applies.
- `buildRecommendations` reads a finding's dimensions (formation, play type, situation) back
  from the statement `stats/findings.ts` wrote; a finding from another compute version is
  skipped, not guessed. A structured field on `ScoutingFinding` is proposed to the contracts
  owner.

## Thinking models

qwen3-vl advertises the `thinking` capability. Left on, it spends the whole `num_predict` on hidden reasoning and returns an empty, truncated answer (`done_reason: length`), so both adapters read `/api/show` once per instance and send `think: false` to any model that lists `thinking`. Models without the capability get no `think` field, because older models reject it.
