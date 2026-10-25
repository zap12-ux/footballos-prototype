import type { AssetContext, InferredLabel, LabelKey, ModelProvenance, PlaySegmentRef } from "../types.js";

/** One JPEG frame already extracted by `packages/media`, with the timestamp it was taken at. */
export interface LabelFrame {
  atSec: number;
  jpegBase64: string;
  /** Pixel dimensions when known; used only for the pre-call cost estimate. */
  width?: number | null;
  height?: number | null;
}

export interface LabelSegmentInput {
  segment: Pick<PlaySegmentRef, "id" | "assetId" | "gameId" | "startSec" | "endSec">;
  /** Ordered by `atSec` ascending; the adapter rejects unordered input. */
  frames: LabelFrame[];
  context: AssetContext;
  labelKeys: LabelKey[];
  /** Recorded into provenance.preprocessing; null when the plan did not fix a rate. */
  samplingFps?: number | null;
  /** Free-text description of the frame resolution, e.g. "1280x720". */
  resolution?: string;
}

export interface LabelSegmentOutput {
  labels: InferredLabel[];
  provenance: ModelProvenance;
}

/**
 * The replaceable adapter (DECISIONS D-004). Implementations either return labels with
 * full provenance, or throw `ProviderUnavailableError`. They never return a canned result.
 */
export interface VisionLabeler {
  readonly provider: ModelProvenance["provider"];
  labelSegment(input: LabelSegmentInput): Promise<LabelSegmentOutput>;
}
