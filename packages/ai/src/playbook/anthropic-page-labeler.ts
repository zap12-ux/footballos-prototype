/**
 * `PageLabeler` over the Anthropic Messages API: one page image per call, the versioned
 * `playbook-page` prompt, JSON-schema output, budget reservation before the call and
 * `ModelProvenance` from the real `usage`. Shares the transport and error mapping of the
 * segment labeler, so tests inject the same fake transport. No call is made without a key.
 */
import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_AI_CONFIG, readAnthropicApiKey, type AiConfig } from "../config.js";
import { JobBudget } from "../cost/budget.js";
import { computeCostUsd, estimateCallCostUsd } from "../cost/pricing.js";
import { ProviderUnavailableError } from "../errors.js";
import { createAnthropicTransport, mapAnthropicError, type AnthropicTransport } from "../labeler/anthropic.js";
import { ANALYSIS_VERSION } from "../labeler/types.js";
import { loadPrompt } from "../prompts/index.js";
import type { ModelProvenance } from "../types.js";
import { PAGE_RESPONSE_JSON_SCHEMA, validatePageResponse } from "./schema.js";
import type { LabelPageInput, LabelPageOutput, PageLabeler } from "./types.js";

export const PLAYBOOK_PAGE_PROMPT_ID = "playbook-page";
export const PLAYBOOK_PAGE_PROMPT_VERSION = 1;

/** Largest page image accepted (base64 length); the API limit is about 5 MB per image. */
const MAX_IMAGE_BASE64_CHARS = 6_000_000;

export interface AnthropicPageLabelerOptions {
  config?: Partial<AiConfig>;
  transport?: AnthropicTransport;
  apiKey?: string | null;
  budget?: JobBudget;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
}

/** The user-turn text after the image. Exported so tests can inspect it. */
export function buildPageContextText(input: LabelPageInput): string {
  const lines: string[] = [];
  lines.push(`Playbook page ${input.pageNumber}. The image above is the whole page; nothing else was inspected.`);
  const vocab = input.vocabulary ?? {};
  const entries = Object.entries(vocab).filter(([, words]) => (words ?? []).length > 0);
  lines.push('<team_vocabulary untrusted="true">');
  if (entries.length === 0) lines.push("(none provided)");
  for (const [kind, words] of entries) lines.push(`${kind}: ${(words ?? []).map((w) => JSON.stringify(w)).join(", ")}`);
  lines.push("</team_vocabulary>");
  lines.push("Return the JSON object now.");
  return lines.join("\n");
}

export class AnthropicPageLabeler implements PageLabeler {
  readonly provider = "anthropic" as const;
  private readonly config: AiConfig;
  private readonly transport: AnthropicTransport | null;
  private readonly budget: JobBudget;
  private readonly now: () => Date;

  constructor(opts: AnthropicPageLabelerOptions = {}) {
    this.config = { ...DEFAULT_AI_CONFIG, ...opts.config };
    this.now = opts.now ?? (() => new Date());
    this.budget = opts.budget ?? new JobBudget(this.config.jobBudgetUsd);
    if (opts.transport) {
      this.transport = opts.transport;
    } else {
      const key = opts.apiKey === undefined ? readAnthropicApiKey(opts.env ?? process.env) : opts.apiKey;
      this.transport = key ? createAnthropicTransport(key, this.config.requestTimeoutMs) : null;
    }
  }

  isAvailable(): boolean {
    return this.transport !== null;
  }

  get jobBudget(): JobBudget {
    return this.budget;
  }

  async labelPage(input: LabelPageInput): Promise<LabelPageOutput> {
    if (!this.transport) {
      throw new ProviderUnavailableError({ provider: "anthropic", reason: "no_api_key", retryable: false, message: "ANTHROPIC_API_KEY is not set; the page stays unproposed" });
    }
    if (!Number.isInteger(input.pageNumber) || input.pageNumber < 1) {
      throw new ProviderUnavailableError({ provider: "anthropic", reason: "input_rejected", retryable: false, message: "pageNumber must be a positive integer" });
    }
    if (typeof input.image?.base64 !== "string" || input.image.base64.length === 0) {
      throw new ProviderUnavailableError({ provider: "anthropic", reason: "input_rejected", retryable: false, message: "page image is empty" });
    }
    if (input.image.base64.length > MAX_IMAGE_BASE64_CHARS) {
      throw new ProviderUnavailableError({ provider: "anthropic", reason: "input_rejected", retryable: false, message: "page image exceeds the provider's size limit; render at a lower DPI" });
    }

    const prompt = loadPrompt(PLAYBOOK_PAGE_PROMPT_ID, PLAYBOOK_PAGE_PROMPT_VERSION);
    const contextText = buildPageContextText(input);
    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: this.config.anthropicModel,
      max_tokens: this.config.maxOutputTokens,
      system: [{ type: "text", text: prompt.text, cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: `Page ${input.pageNumber}` },
            { type: "image", source: { type: "base64", media_type: input.image.mediaType, data: input.image.base64 } },
            { type: "text", text: contextText },
          ],
        },
      ],
      output_config: { effort: this.config.effort, format: { type: "json_schema", schema: PAGE_RESPONSE_JSON_SCHEMA } },
    };

    const budget = input.budget ?? this.budget;
    const reservation = budget.reserve(
      estimateCallCostUsd({ model: this.config.anthropicModel, frames: [{ width: input.image.width, height: input.image.height }], promptText: prompt.text + contextText, maxOutputTokens: this.config.maxOutputTokens }),
    );

    const requestedAt = this.now();
    let message: Anthropic.Message;
    try {
      message = await this.transport.createMessage(params);
    } catch (err) {
      reservation.release();
      throw mapAnthropicError(err);
    }
    const completedAt = this.now();

    const usage = {
      inputTokens: message.usage.input_tokens,
      cacheCreationInputTokens: message.usage.cache_creation_input_tokens ?? 0,
      cacheReadInputTokens: message.usage.cache_read_input_tokens ?? 0,
      outputTokens: message.usage.output_tokens,
    };
    const costUsd = computeCostUsd(message.model, usage) ?? computeCostUsd(this.config.anthropicModel, usage);
    reservation.settle(costUsd);
    if (costUsd === null) {
      throw new ProviderUnavailableError({ provider: "anthropic", reason: "unknown", retryable: false, message: `served model ${JSON.stringify(message.model)} is not in the price table; cost cannot be recorded` });
    }
    if (message.stop_reason === "refusal") {
      throw new ProviderUnavailableError({ provider: "anthropic", reason: "refusal", retryable: false, message: "model declined to read the page" });
    }
    if (message.stop_reason === "max_tokens") {
      throw new ProviderUnavailableError({ provider: "anthropic", reason: "truncated_output", retryable: false, message: `response hit max_tokens=${this.config.maxOutputTokens}` });
    }

    const text = message.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (err) {
      throw new ProviderUnavailableError({ provider: "anthropic", reason: "invalid_model_output", retryable: true, message: "response text was not valid JSON", cause: err });
    }
    const body = validatePageResponse(raw, "anthropic");

    const provenance: ModelProvenance = {
      id: randomUUID(),
      provider: "anthropic",
      model: message.model,
      modelRevision: null,
      promptId: `${prompt.id}.v${prompt.version}`,
      promptHash: prompt.hash,
      // A page is a single still: no sampling, no clip. `inspected` is a frame concept; for
      // a document the proposals carry the page number and this block is zeroed.
      preprocessing: { samplingFps: null, frameCount: 1, clipSec: null, resolution: input.image.width && input.image.height ? `${input.image.width}x${input.image.height}` : "unknown" },
      inspected: { fromSec: 0, toSec: 0, frameTimestampsSec: [] },
      analysisVersion: ANALYSIS_VERSION,
      inputTokens: usage.inputTokens + usage.cacheCreationInputTokens + usage.cacheReadInputTokens,
      outputTokens: usage.outputTokens,
      costUsd,
      latencyMs: completedAt.getTime() - requestedAt.getTime(),
      requestedAt: requestedAt.toISOString(),
      completedAt: completedAt.toISOString(),
    };
    return { ...body, provenance };
  }
}
