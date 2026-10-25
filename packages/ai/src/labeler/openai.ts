import { ProviderUnavailableError } from "../errors.js";
import type { LabelSegmentInput, LabelSegmentOutput, VisionLabeler } from "./types.js";

/**
 * Second-candidate adapter (DECISIONS D-004). This is a stub that conforms to the
 * interface and reports truthfully that it cannot label. It does not depend on the
 * `openai` package yet; when the owner approves a measured comparison, implement it with
 * the official SDK (`openai`, Apache-2.0) behind the same `VisionLabeler` contract and the
 * same validator, and add the dependency to this workspace's package.json.
 */
export class OpenAIVisionLabeler implements VisionLabeler {
  readonly provider = "openai" as const;
  private readonly hasKey: boolean;

  constructor(opts: { apiKey?: string | null; env?: NodeJS.ProcessEnv } = {}) {
    const key = opts.apiKey === undefined ? (opts.env ?? process.env).OPENAI_API_KEY : opts.apiKey;
    this.hasKey = typeof key === "string" && key.trim() !== "";
  }

  isAvailable(): boolean {
    return false;
  }

  async labelSegment(_input: LabelSegmentInput): Promise<LabelSegmentOutput> {
    if (!this.hasKey) {
      throw new ProviderUnavailableError({
        provider: "openai",
        reason: "no_api_key",
        retryable: false,
        message: "OPENAI_API_KEY is not set; the OpenAI adapter is also not yet implemented",
      });
    }
    throw new ProviderUnavailableError({
      provider: "openai",
      reason: "not_implemented",
      retryable: false,
      message: "the OpenAI adapter is a stub pending owner approval of a measured comparison",
    });
  }
}
