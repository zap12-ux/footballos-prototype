/**
 * `PageLabeler` over a local Ollama server: one page image per call, the versioned
 * `playbook-page` prompt, JSON-schema output and `ModelProvenance` from the real token counts.
 * Shares the client and error mapping of the segment labeler, so tests inject the same fake fetch.
 */
import { randomUUID } from "node:crypto";
import { DEFAULT_AI_CONFIG, type AiConfig } from "../config.js";
import { ProviderUnavailableError } from "../errors.js";
import { ANALYSIS_VERSION } from "../labeler/types.js";
import { estimateNumCtx, OllamaClient, thinkingOff, type FetchLike } from "../ollama/client.js";
import { loadPrompt } from "../prompts/index.js";
import type { ModelProvenance } from "../types.js";
import { PAGE_RESPONSE_JSON_SCHEMA, validatePageResponse } from "./schema.js";
import type { LabelPageInput, LabelPageOutput, PageLabeler } from "./types.js";

export const PLAYBOOK_PAGE_PROMPT_ID = "playbook-page";
export const PLAYBOOK_PAGE_PROMPT_VERSION = 1;

/** Largest page image accepted (base64 length); keeps one request well under a few MB. */
const MAX_IMAGE_BASE64_CHARS = 6_000_000;

export interface OllamaPageLabelerOptions {
  config?: Partial<AiConfig>;
  client?: OllamaClient;
  fetchImpl?: FetchLike;
  now?: () => Date;
}

/** The user-turn text after the image. Exported so tests can inspect it. */
export function buildPageContextText(input: LabelPageInput): string {
  const lines: string[] = [];
  lines.push(`Playbook page ${input.pageNumber}. The image is the whole page; nothing else was inspected.`);
  const vocab = input.vocabulary ?? {};
  const entries = Object.entries(vocab).filter(([, words]) => (words ?? []).length > 0);
  lines.push('<team_vocabulary untrusted="true">');
  if (entries.length === 0) lines.push("(none provided)");
  for (const [kind, words] of entries) lines.push(`${kind}: ${(words ?? []).map((w) => JSON.stringify(w)).join(", ")}`);
  lines.push("</team_vocabulary>");
  lines.push("Return the JSON object now.");
  return lines.join("\n");
}

export class OllamaPageLabeler implements PageLabeler {
  readonly provider = "ollama" as const;
  private readonly config: AiConfig;
  private readonly client: OllamaClient;
  private readonly now: () => Date;
  private think: Promise<boolean | undefined> | null = null;

  constructor(opts: OllamaPageLabelerOptions = {}) {
    this.config = { ...DEFAULT_AI_CONFIG, ...opts.config };
    this.now = opts.now ?? (() => new Date());
    this.client = opts.client ?? new OllamaClient({ host: this.config.ollamaHost, fetchImpl: opts.fetchImpl, timeoutMs: this.config.requestTimeoutMs });
  }

  isAvailable(): boolean {
    return true;
  }

  async labelPage(input: LabelPageInput): Promise<LabelPageOutput> {
    const reject = (message: string) => new ProviderUnavailableError({ provider: this.provider, reason: "input_rejected", retryable: false, message });
    if (!Number.isInteger(input.pageNumber) || input.pageNumber < 1) throw reject("pageNumber must be a positive integer");
    if (typeof input.image?.base64 !== "string" || input.image.base64.length === 0) throw reject("page image is empty");
    if (input.image.base64.length > MAX_IMAGE_BASE64_CHARS) throw reject("page image is too large for one request; render at a lower DPI");

    const prompt = loadPrompt(PLAYBOOK_PAGE_PROMPT_ID, PLAYBOOK_PAGE_PROMPT_VERSION);
    const contextText = buildPageContextText(input);

    this.think ??= thinkingOff(this.client, this.config.model).catch((err) => { this.think = null; throw err; });
    const think = await this.think;
    const requestedAt = this.now();
    const result = await this.client.chat({
      model: this.config.model,
      system: prompt.text,
      prompt: contextText,
      images: [input.image.base64],
      format: PAGE_RESPONSE_JSON_SCHEMA,
      numPredict: this.config.maxOutputTokens,
      numCtx: estimateNumCtx({ images: 1, textChars: prompt.text.length + contextText.length, numPredict: this.config.maxOutputTokens, maxNumCtx: this.config.maxNumCtx }),
      think,
      keepAlive: this.config.keepAlive,
    });
    const completedAt = this.now();

    if (result.doneReason === "length") {
      throw new ProviderUnavailableError({ provider: this.provider, reason: "truncated_output", retryable: false, message: `response hit num_predict=${this.config.maxOutputTokens}` });
    }
    let raw: unknown;
    try {
      raw = JSON.parse(result.content);
    } catch (err) {
      throw new ProviderUnavailableError({ provider: this.provider, reason: "invalid_model_output", retryable: true, message: "response text was not valid JSON", cause: err });
    }
    const body = validatePageResponse(raw, this.provider);

    const provenance: ModelProvenance = {
      id: randomUUID(),
      provider: this.provider,
      model: result.model,
      modelRevision: null,
      promptId: `${prompt.id}.v${prompt.version}`,
      promptHash: prompt.hash,
      // A page is a single still: no sampling, no clip. `inspected` is a frame concept; for a
      // document the proposals carry the page number and this block is zeroed.
      preprocessing: { samplingFps: null, frameCount: 1, clipSec: null, resolution: input.image.width && input.image.height ? `${input.image.width}x${input.image.height}` : "unknown" },
      inspected: { fromSec: 0, toSec: 0, frameTimestampsSec: [] },
      analysisVersion: ANALYSIS_VERSION,
      inputTokens: result.promptEvalCount,
      outputTokens: result.evalCount,
      costUsd: 0,
      latencyMs: Math.max(0, completedAt.getTime() - requestedAt.getTime()),
      requestedAt: requestedAt.toISOString(),
      completedAt: completedAt.toISOString(),
    };
    return { ...body, provenance };
  }
}
