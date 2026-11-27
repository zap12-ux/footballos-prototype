# Model candidates for vision labeling (A4)

> **Historical (2026-11-27).** The project moved to a local open-source vision model served by
> Ollama (`qwen3-vl:4b` by default; see `packages/ai/README.md`). The hosted-API comparison
> below is kept as the record of the decision it informed and is no longer maintained.

Status: documentation-only comparison. **No model call has been made** in this environment
(no API key exists; see DECISIONS D-004). Every fact below carries the official page it
was read from and the access date. Figures that are *estimates* are labeled as such and are
not measurements. Prices and limits change; re-read the cited pages before any purchase.

Candidates, per the brief: Anthropic Claude (primary adapter), OpenAI GPT vision models
(second adapter, stub), Qwen3-VL (open source, evaluated on paper only).

## 1. Anthropic Claude (current family: Claude 5)

| Item | Fact | Source (accessed 2026-10-25) |
| --- | --- | --- |
| Model ids | `claude-fable-5-1`, `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5` (dateless ids are pinned snapshots) | https://platform.claude.com/docs/en/about-claude/models/overview |
| Image input | "All current models support text and image input, text output, multilingual capabilities, vision, and tool use." | same |
| Video input | Not offered as an input type; the vision page lists only `image` content blocks (base64, URL, Files API). Animated GIFs: "only the first frame is used." | https://platform.claude.com/docs/en/build-with-claude/vision |
| Context / max output | 1M tokens context, 128K max output for all four | models overview |
| Image formats | JPEG, PNG, GIF, WebP | vision page |
| Images per request | 600 per API request (100 for 200k-context models); above 20 images a stricter per-image dimension limit applies: resize so neither side exceeds 2000 px, or keep the request at 20 or fewer image blocks | vision page, "Request limits" |
| Per-image size / dimensions | 10 MB base64 on the Claude API; max 8000x8000 px; request body limit 32 MB | vision page |
| Image token cost | `⌈width/28⌉ × ⌈height/28⌉` visual tokens; high-resolution tier (Claude 4.7 and later): max long edge 2,576 px, max 4,784 visual tokens; a 1920x1080 frame costs 2,691 tokens on that tier | vision page, "Resolution and token cost" |
| Pricing (USD per MTok, input / output) | Fable 5.1 $10 / $50; Opus 5.5 $4 / $20; Sonnet 5.5 $2 / $10; Haiku 5.5 $0.10 / $0.50 (prompts up to 100k tokens; $0.50 / $2.50 above). Cache reads 0.05x base input on Opus 5.5 and Sonnet 5.5; Batch API 50% off input and output | https://platform.claude.com/docs/en/about-claude/pricing |
| Structured output | `output_config.format` with `type: "json_schema"`; GA, no beta header; `additionalProperties` must be `false`; no `minimum`/`maximum`/`minLength`; listed as supported on all four current models | https://platform.claude.com/docs/en/build-with-claude/structured-outputs |
| Training on API data | "By default, we will not use your inputs or outputs from our commercial products" to train models (API included) | https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training |
| | Commercial Terms, section B: "Anthropic may not train models on Customer Content from Services." | https://www.anthropic.com/legal/commercial-terms |
| Retention | "we automatically delete inputs and outputs on our backend within 30 days of receipt or generation, except" (Files API, agreed otherwise, Usage Policy enforcement, legal) | https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-data |
| | Images: "Image uploads are ephemeral and not stored beyond the duration of the API request." and "Anthropic does not use uploaded images to train models." | vision page, FAQ |
| Zero data retention | Available to "eligible Anthropic APIs" per organization, "subject to Anthropic's approval"; "for Covered Models, we require limited data retention and review as a part of our safety work" | https://privacy.claude.com/en/articles/8956058-i-have-a-zero-retention-agreement-with-anthropic-what-products-does-it-apply-to |
| Licensing | Proprietary hosted service under the Commercial Terms; customer owns Outputs | commercial terms page |
| Hosting needs | None (hosted API). Also offered through Amazon Bedrock, Google Cloud, Microsoft Foundry and Claude Platform on AWS with their own ids and limits (Bedrock: 5 MB per image) | models overview; vision page |
| Noted limitations | "Claude cannot be used to name people in images and refuses to do so"; counting "might not always be precisely accurate"; coordinates are approximate | vision page, "Limitations" |

Relevant to the adapter: with at most 12 frames per segment the request stays under the
20-image threshold, so frames may keep their native size up to 2,576 px long edge; frames
should still be downsampled to about 1280x720 to control tokens (see §4).

## 2. OpenAI GPT vision models

OpenAI's documentation moved from `platform.openai.com/docs` to `developers.openai.com`
(301 redirects observed on 2026-10-25). `https://openai.com/enterprise-privacy/` returned
HTTP 403 to automated fetching, so the data-usage facts below come from the API docs page.

| Item | Fact | Source (accessed 2026-10-25) |
| --- | --- | --- |
| Current models | `gpt-6-astra` (flagship), `gpt-6.1-sol` (flagship), `gpt-6-luna` ("most efficient model for focused, high-volume tasks"); context 1.05M, max output 128K, inputs text + image | https://developers.openai.com/api/docs/models |
| Image input | "All latest OpenAI models support text and image input, text output, multilingual capabilities, and vision." | same |
| Video input | Not mentioned on the images-and-vision guide | https://developers.openai.com/api/docs/guides/images-vision |
| Image formats | PNG, JPEG, WEBP, non-animated GIF | same |
| Images per request | "Up to 1,500 images per request."; "Up to 512 MB total payload per request." (no per-image byte limit stated) | same |
| Dimensions / tokens | 32x32-pixel patches: `ceil(width/32) × ceil(height/32)`, then a per-model multiplier (1.2 for `gpt-6-astra`); `high` detail "allows up to 2,500 patches and a 65,535-pixel maximum dimension"; "the API supports up to 30,000 patches per image" and oversize images "are rejected, not automatically resized"; a 1024x1024 image at `high` on `gpt-6-astra` is 1,229 tokens | same |
| Pricing (USD per MTok, input / cached / output, Standard tier, ≤272K context) | gpt-6-astra $10 / $1 / $50; gpt-6.1-sol $2 / $0.10 / $10; gpt-6-sol $2 / $0.20 / $10; gpt-6-luna $0.10 / $0.01 / $0.50; gpt-5.6-sol $4 / $0.40 / $20; gpt-5.5 $5 / $0.50 / $30; gpt-5.4-mini $0.75 / $0.075 / $4.50; gpt-5.4-nano $0.20 / $0.02 / $1.25. Image input is billed as text tokens (no separate image rate on text-model rows) | https://developers.openai.com/api/docs/pricing |
| Training on API data | "data sent to the OpenAI API is not used to train or improve OpenAI models" | https://developers.openai.com/api/docs/guides/your-data |
| Retention | "By default, abuse monitoring logs are generated for all API feature usage and retained for up to 30 days." | same |
| Zero data retention | Excludes content from abuse-monitoring logs; "Currently, these controls are subject to prior approval by OpenAI." Some endpoints are not ZDR-eligible | same |
| Licensing | Proprietary hosted service | models page |
| Hosting needs | None (hosted API) | — |
| Noted limitations | counting may be approximate; rotated images may be misread; "our system blocks the submission of CAPTCHAs"; not for specialized medical images | images-and-vision guide |

## 3. Qwen3-VL (open source)

| Item | Fact | Source (accessed 2026-10-25) |
| --- | --- | --- |
| Sizes / editions | 2B, 4B, 8B, 32B dense and 30B-A3B, 235B-A22B MoE; Instruct and Thinking editions; FP8 checkpoints | https://github.com/QwenLM/Qwen3-VL |
| Inputs | Images (path, URL, base64), video (frame list, file path, URL), text | same |
| Video | Supported natively; default sampling `fps=2`, overridable with `fps` or `num_frames`; visual tokens per video configurable "256-16384"; recommends `total_pixels` below 24576×32×32; no stated maximum video length | same |
| Context | "Native 256K context, expandable to 1M" (YaRN factor 2–3 recommended beyond 256K) | same; https://huggingface.co/Qwen/Qwen3-VL-8B-Instruct |
| License | Apache-2.0 (repository and 8B-Instruct model card metadata) | both |
| Hosting needs | `transformers >= 4.57.0`; `vllm >= 0.11.0`; sample vLLM launch "applicable to H100/H200"; FP8 checkpoint "Requires NVIDIA H100+ and CUDA 12+"; SGLang supported; FlashAttention-2 recommended. GPU memory per size is not stated on the page | GitHub README |
| Pricing | No list price (self-hosted). Cost = GPU rental or purchase plus operations; **not measured** and not estimated here because no hosting target exists (D-009 chose a 2 vCPU / 4 GiB droplet with no GPU) | — |
| Data retention / training | Self-hosted: footage never leaves the owner's host; retention is whatever the deployment keeps. Third-party hosted endpoints would have their own terms (not evaluated) | — |
| Release | 235B-A22B Instruct/Thinking released 2025-09-23; technical paper 2025-11-27 | GitHub README news |

## 4. Cost per segment and per game (estimates, not measurements)

Assumptions: 8 frames per play at 1280x720 (downsampled), ~1,000 text tokens of prompt and
context, ~600 output tokens including the structured JSON. Anthropic image tokens per
frame at 1280x720: ⌈1280/28⌉ × ⌈720/28⌉ = 46 × 26 = 1,196, so 8 frames ≈ 9,568 visual
tokens, ≈ 10,600 input tokens per segment. A game is assumed to have ~150 plays.
Adaptive thinking tokens are billed as output and are **not** included; real output may be
higher. These numbers exist only to size the budget question; the evaluation plan replaces
them with measured values.

| Model | Input $/seg | Output $/seg | ≈ $/segment | ≈ $/game (150) | Segments within the $25 default job budget |
| --- | --- | --- | --- | --- | --- |
| claude-opus-5-5 | 10,600 × $4/M = $0.0424 | 600 × $20/M = $0.012 | $0.054 | $8.2 | ~460 |
| claude-sonnet-5-5 | $0.0212 | $0.006 | $0.027 | $4.1 | ~920 |
| claude-haiku-5-5 | $0.00106 | $0.0003 | $0.0014 | $0.20 | ~18,000 |
| gpt-6-astra (patch formula, 32 px, ×1.2: 8 × ⌈1280/32⌉×⌈720/32⌉×1.2 = 8 × 1,104 = 8,832 + 1,000 text) | 9,832 × $10/M = $0.098 | 600 × $50/M = $0.03 | $0.128 | $19.3 | ~195 |
| gpt-6.1-sol (same tokens) | $0.0197 | $0.006 | $0.026 | $3.8 | ~970 |
| Qwen3-VL (self-hosted) | GPU time; not estimated | | | | n/a |

The pre-call estimator in `packages/ai/src/cost/pricing.ts` is deliberately more
conservative than this table: it assumes the full `maxOutputTokens` as output and the tier
cap (4,784 tokens) for frames with unknown dimensions.

## 5. Recommendation

1. **Keep Anthropic as the primary adapter** (D-004 stands). It satisfies every hard
   requirement in the brief with official documentation: image sequences with per-frame
   timestamps, JSON-schema structured output without a beta header, 30-day default
   deletion and no training on API content, and a per-request image count that leaves room
   for the 12-frame cap. Nothing in the documentation reviewed shows OpenAI ahead on these
   requirements; its advantages (1,500 images, 512 MB payload) are not needed here.
2. **Default model id `claude-opus-5-5`** in `FOOTBALLOS_AI_MODEL` with effort `medium`.
   Rationale: it is the documented default choice for most workloads and the model the
   other candidates must beat on *accuracy on predicted* and *abstention rate* before cost
   decides. Sonnet 5.5 (half the price) and Haiku 5.5 (~40x cheaper) are the first
   measurement targets; the estimate above says Haiku would make a full game cost cents, so
   the question is only whether its abstention and error rates are acceptable.
3. **Qwen3-VL stays on paper** until (a) real footage with coach labels exists, (b) a GPU
   host is approved and priced, and (c) the hosted candidates have a measured baseline.
   Its native video input is the one capability the hosted candidates lack and is worth a
   later experiment for play-type, which needs temporal evidence.

### What must be measured before switching models or providers

Run `docs/ai/EVALUATION_PLAN.md` on the same held-out games for each candidate and compare:

- accuracy on predicted and abstention rate per key (formation_family, play_type, unit,
  motion, special_teams_type), with the confusion matrices;
- usable coverage (correct / labeled) — the share of coach work actually saved;
- error rate on evidence-only keys (`situation_*`), which must be ~0;
- rate of rejected outputs (invalid JSON, timestamps outside the inspected set) from the
  validator, which is a provider-quality signal in itself;
- measured input/output tokens, cost and latency per segment from real `usage` fields
  (recorded in `ModelProvenance`), per game;
- for OpenAI: the same run through a real adapter (the current one is a stub), which first
  needs the owner's approval of a second paid key.

A switch is justified only when a cheaper candidate matches the primary on accuracy on
predicted and on the evidence-only error rate, with abstention within the agreed target.
