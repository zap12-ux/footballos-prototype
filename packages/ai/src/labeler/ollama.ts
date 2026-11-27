/**
 * `VisionLabeler` over a local Ollama server. One non-streaming `/api/chat` call per segment:
 * the versioned `label-segment` prompt as the system message, the frames as `images` in
 * timestamp order, a user text that names every timestamp shown, and the label JSON schema as
 * `format`. The response is validated like any other model output; nothing is ever defaulted.
 */
import { randomUUID } from "node:crypto";
import { DEFAULT_AI_CONFIG, type AiConfig } from "../config.js";
import { ProviderUnavailableError } from "../errors.js";
import { estimateNumCtx, OllamaClient, thinkingOff, type FetchLike } from "../ollama/client.js";
import { LABEL_SEGMENT_PROMPT_ID, LABEL_SEGMENT_PROMPT_VERSION, loadPrompt } from "../prompts/index.js";
import type { ModelProvenance } from "../types.js";
import { assertLabelInput } from "./input.js";
import { LABEL_RESPONSE_JSON_SCHEMA, LABEL_VOCABULARY } from "./schema.js";
import { ANALYSIS_VERSION, type LabelSegmentInput, type LabelSegmentOutput, type VisionLabeler } from "./types.js";
import { validateLabelResponse } from "./validate.js";

export interface OllamaVisionLabelerOptions {
  config?: Partial<AiConfig>;
  /** Injected client (tests); otherwise one is built from `config.ollamaHost`. */
  client?: OllamaClient;
  fetchImpl?: FetchLike;
  now?: () => Date;
}

/**
 * The user-turn text that follows the frames. Ollama takes the images as a separate array in
 * the same order, so the text lists each frame's position and timestamp. Exported for tests.
 */
export function buildContextText(input: LabelSegmentInput): string {
  const lines: string[] = [];
  input.frames.forEach((frame, i) => lines.push(`Frame ${i + 1} of ${input.frames.length} — t=${frame.atSec.toFixed(3)}s`));
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

export class OllamaVisionLabeler implements VisionLabeler {
  readonly provider = "ollama" as const;
  private readonly config: AiConfig;
  private readonly client: OllamaClient;
  private readonly now: () => Date;
  private think: Promise<boolean | undefined> | null = null;

  constructor(opts: OllamaVisionLabelerOptions = {}) {
    this.config = { ...DEFAULT_AI_CONFIG, ...opts.config };
    this.now = opts.now ?? (() => new Date());
    this.client = opts.client ?? new OllamaClient({ host: this.config.ollamaHost, fetchImpl: opts.fetchImpl, timeoutMs: this.config.requestTimeoutMs });
  }

  /** Always true: there is no key to check. `checkOllama` answers whether a call can succeed. */
  isAvailable(): boolean {
    return true;
  }

  async labelSegment(input: LabelSegmentInput): Promise<LabelSegmentOutput> {
    assertLabelInput(input, this.provider, this.config.maxFramesPerSegment);

    const prompt = loadPrompt(LABEL_SEGMENT_PROMPT_ID, LABEL_SEGMENT_PROMPT_VERSION);
    const contextText = buildContextText(input);
    const timestamps = input.frames.map((f) => f.atSec);

    this.think ??= thinkingOff(this.client, this.config.model).catch((err) => { this.think = null; throw err; });
    const think = await this.think;
    const requestedAt = this.now();
    const result = await this.client.chat({
      model: this.config.model,
      system: prompt.text,
      prompt: contextText,
      images: input.frames.map((f) => f.jpegBase64),
      format: LABEL_RESPONSE_JSON_SCHEMA,
      numPredict: this.config.maxOutputTokens,
      numCtx: estimateNumCtx({ images: input.frames.length, textChars: prompt.text.length + contextText.length, numPredict: this.config.maxOutputTokens, maxNumCtx: this.config.maxNumCtx }),
      think,
      keepAlive: this.config.keepAlive,
    });
    const completedAt = this.now();

    if (result.doneReason === "length") {
      throw new ProviderUnavailableError({
        provider: this.provider,
        reason: "truncated_output",
        retryable: false,
        message: `response hit num_predict=${this.config.maxOutputTokens}; raise FOOTBALLOS_AI_MAX_OUTPUT_TOKENS`,
      });
    }

    let raw: unknown;
    try {
      raw = JSON.parse(result.content);
    } catch (err) {
      throw new ProviderUnavailableError({ provider: this.provider, reason: "invalid_model_output", retryable: true, message: "response text was not valid JSON", cause: err });
    }

    const labels = validateLabelResponse(raw, {
      provider: this.provider,
      assetId: input.segment.assetId,
      requestedKeys: input.labelKeys,
      inspectedTimestampsSec: timestamps,
    });

    const provenance: ModelProvenance = {
      id: randomUUID(),
      provider: this.provider,
      // The model tag that actually served the request, as Ollama reports it.
      model: result.model,
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
      inputTokens: result.promptEvalCount,
      outputTokens: result.evalCount,
      // Local inference: no per-call charge.
      costUsd: 0,
      latencyMs: Math.max(0, completedAt.getTime() - requestedAt.getTime()),
      requestedAt: requestedAt.toISOString(),
      completedAt: completedAt.toISOString(),
    };

    return { labels, provenance };
  }
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
