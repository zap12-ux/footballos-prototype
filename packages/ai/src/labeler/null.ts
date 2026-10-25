import { ProviderUnavailableError } from "../errors.js";
import type { LabelSegmentInput, LabelSegmentOutput, VisionLabeler } from "./types.js";

/** For environments without any provider: every call reports `provider_unavailable`. */
export class NullLabeler implements VisionLabeler {
  readonly provider = "none" as const;

  isAvailable(): boolean {
    return false;
  }

  async labelSegment(_input: LabelSegmentInput): Promise<LabelSegmentOutput> {
    throw new ProviderUnavailableError({
      provider: "none",
      reason: "no_api_key",
      retryable: false,
      message: "no vision provider is configured; label this segment manually",
    });
  }
}
