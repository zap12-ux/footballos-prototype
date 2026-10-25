import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_AI_CONFIG, readAnthropicApiKey, type AiConfig } from "../config.js";
import { JobBudget } from "../cost/budget.js";
import { computeCostUsd, estimateCallCostUsd } from "../cost/pricing.js";
import { ProviderUnavailableError } from "../errors.js";
import { LABEL_SEGMENT_PROMPT_ID, LABEL_SEGMENT_PROMPT_VERSION, loadPrompt } from "../prompts/index.js";
import type { ModelProvenance } from "../types.js";
import { assertLabelInput } from "./input.js";
import { LABEL_RESPONSE_JSON_SCHEMA, LABEL_VOCABULARY } from "./schema.js";
import { ANALYSIS_VERSION, type LabelSegmentInput, type LabelSegmentOutput, type VisionLabeler } from "./types.js";
import { validateLabelResponse } from "./validate.js";

/**
 * The only thing the adapter needs from the SDK: send one non-streaming Messages request
 * and get the Message back. Tests inject a fake; production wraps `client.messages.create`.
 */
export interface AnthropicTransport {
  createMessage(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
}

export interface AnthropicVisionLabelerOptions {
  config?: Partial<AiConfig>;
  /** Injected for tests. When absent, a real client is built from the API key. */
  transport?: AnthropicTransport;
  /** Explicit key (otherwise ANTHROPIC_API_KEY from `env`). Never logged. */
  apiKey?: string | null;
  /** Shared per-job budget; when absent a fresh budget with `config.jobBudgetUsd` is used. */
  budget?: JobBudget;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
}

export function createAnthropicTransport(apiKey: string, timeoutMs: number): AnthropicTransport {
  // maxRetries 0: the job runner owns retries so every attempt is budgeted and recorded.
  const client = new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 0 });
  return {
    createMessage: (params) => client.messages.create(params),
  };
}

/** Build the user-turn text that follows the frames. Exported so tests can inspect it. */
export function buildContextText(input: LabelSegmentInput): string {
  const lines: string[] = [];
  lines.push(`Segment ${input.segment.id} of asset ${input.segment.assetId}: ${input.segment.startSec.toFixed(3)}s to ${input.segment.endSec.toFixed(3)}s.`);
  lines.push(`Frames shown (seconds): ${input.frames.map((f) => f.atSec.toFixed(3)).join(", ")}. Nothing between or outside these timestamps was inspected.`);
  lines.push(`Analyzed team: ${input.context.analyzedTeam}. Analyzed unit: ${input.context.analyzedUnit}. Camera perspective: ${input.context.perspective}.`);
  lines.push('<team_cues untrusted="true">');
  lines.push(input.context.teamCues ?? "(none provided)");
  lines.push("</team_cues>");
  lines.push("Requested keys and allowed values:");
  for (const key of input.labelKeys) {
    const vocab = LABEL_VOCABULARY[key];
    if (key === "formation_family" && input.formationVocabulary && input.formationVocabulary.length > 0) {
      lines.push(`- ${key}: one of ${input.formationVocabulary.map((v) => JSON.stringify(v)).join(", ")} or null`);
    } else if (vocab) {
      lines.push(`- ${key}: one of ${vocab.map((v) => JSON.stringify(v)).join(", ")} or null`);
    } else {
      lines.push(`- ${key}: short free text or null`);
    }
  }
  lines.push("Return the JSON object now.");
  return lines.join("\n");
}

export class AnthropicVisionLabeler implements VisionLabeler {
  readonly provider = "anthropic" as const;
  private readonly config: AiConfig;
  private readonly transport: AnthropicTransport | null;
  private readonly budget: JobBudget;
  private readonly now: () => Date;

  constructor(opts: AnthropicVisionLabelerOptions = {}) {
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

  async labelSegment(input: LabelSegmentInput): Promise<LabelSegmentOutput> {
    if (!this.transport) {
      throw new ProviderUnavailableError({
        provider: "anthropic",
        reason: "no_api_key",
        retryable: false,
        message: "ANTHROPIC_API_KEY is not set; manual labeling remains available",
      });
    }
    assertLabelInput(input, "anthropic", this.config.maxFramesPerSegment);

    const prompt = loadPrompt(LABEL_SEGMENT_PROMPT_ID, LABEL_SEGMENT_PROMPT_VERSION);
    const contextText = buildContextText(input);
    const timestamps = input.frames.map((f) => f.atSec);

    const content: Anthropic.ContentBlockParam[] = [];
    input.frames.forEach((frame, i) => {
      content.push({ type: "text", text: `Frame ${i + 1} of ${input.frames.length} — t=${frame.atSec.toFixed(3)}s` });
      content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: frame.jpegBase64 } });
    });
    content.push({ type: "text", text: contextText });

    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: this.config.anthropicModel,
      max_tokens: this.config.maxOutputTokens,
      // Stable prompt first with a cache breakpoint; the volatile frames follow in the user turn.
      system: [{ type: "text", text: prompt.text, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content }],
      output_config: {
        effort: this.config.effort,
        format: { type: "json_schema", schema: LABEL_RESPONSE_JSON_SCHEMA },
      },
    };

    const reservation = this.budget.reserve(
      estimateCallCostUsd({
        model: this.config.anthropicModel,
        frames: input.frames.map((f) => ({ width: f.width ?? null, height: f.height ?? null })),
        promptText: prompt.text + contextText,
        maxOutputTokens: this.config.maxOutputTokens,
      }),
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
    const costUsd = computeCostUsd(message.model, usage);
    reservation.settle(costUsd);

    if (message.stop_reason === "refusal") {
      const category = message.stop_details?.category;
      throw new ProviderUnavailableError({
        provider: "anthropic",
        reason: "refusal",
        retryable: false,
        message: `model declined the request${category ? ` (category ${category})` : ""}`,
      });
    }
    if (message.stop_reason === "max_tokens") {
      throw new ProviderUnavailableError({
        provider: "anthropic",
        reason: "truncated_output",
        retryable: false,
        message: `response hit max_tokens=${this.config.maxOutputTokens}; raise FOOTBALLOS_AI_MAX_OUTPUT_TOKENS`,
      });
    }

    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (err) {
      throw new ProviderUnavailableError({
        provider: "anthropic",
        reason: "invalid_model_output",
        retryable: true,
        message: "response text was not valid JSON",
        cause: err,
      });
    }

    const labels = validateLabelResponse(raw, {
      provider: "anthropic",
      assetId: input.segment.assetId,
      requestedKeys: input.labelKeys,
      inspectedTimestampsSec: timestamps,
    });

    const provenance: ModelProvenance = {
      id: randomUUID(),
      provider: "anthropic",
      // The model that actually served the request, as reported by the API.
      model: message.model,
      modelRevision: null,
      promptId: `${prompt.id}.v${prompt.version}`,
      promptHash: prompt.hash,
      preprocessing: {
        samplingFps: input.samplingFps ?? null,
        frameCount: input.frames.length,
        clipSec: round3(input.segment.endSec - input.segment.startSec),
        resolution: input.resolution ?? "unknown",
      },
      inspected: {
        fromSec: timestamps[0] as number,
        toSec: timestamps[timestamps.length - 1] as number,
        frameTimestampsSec: timestamps,
      },
      analysisVersion: ANALYSIS_VERSION,
      // Total input the model saw: uncached + cache writes + cache reads (cost uses each rate).
      inputTokens: usage.inputTokens + usage.cacheCreationInputTokens + usage.cacheReadInputTokens,
      outputTokens: usage.outputTokens,
      costUsd,
      latencyMs: completedAt.getTime() - requestedAt.getTime(),
      requestedAt: requestedAt.toISOString(),
      completedAt: completedAt.toISOString(),
    };

    return { labels, provenance };
  }
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Map SDK errors to `provider_unavailable`, most specific first. */
export function mapAnthropicError(err: unknown): ProviderUnavailableError {
  if (err instanceof ProviderUnavailableError) return err;
  const base = { provider: "anthropic" as const, cause: err };
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new ProviderUnavailableError({ ...base, reason: "auth", retryable: false, status: err.status, message: "API key rejected" });
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new ProviderUnavailableError({ ...base, reason: "rate_limited", retryable: true, status: err.status, message: "rate limited by the provider" });
  }
  if (err instanceof Anthropic.BadRequestError || err instanceof Anthropic.UnprocessableEntityError || err instanceof Anthropic.NotFoundError) {
    return new ProviderUnavailableError({ ...base, reason: "bad_request", retryable: false, status: err.status, message: `provider rejected the request: ${err.message}` });
  }
  if (err instanceof Anthropic.InternalServerError) {
    return new ProviderUnavailableError({ ...base, reason: "server_error", retryable: true, status: err.status, message: "provider server error" });
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new ProviderUnavailableError({ ...base, reason: "network", retryable: true, message: "could not reach the provider" });
  }
  if (err instanceof Anthropic.APIError) {
    const status = typeof err.status === "number" ? err.status : null;
    const serverSide = status !== null && status >= 500;
    return new ProviderUnavailableError({ ...base, reason: serverSide ? "server_error" : "unknown", retryable: serverSide, status, message: err.message });
  }
  return new ProviderUnavailableError({ ...base, reason: "unknown", retryable: false, message: err instanceof Error ? err.message : String(err) });
}
