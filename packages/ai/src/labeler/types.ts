import type { AssetContext, InferredLabel, LabelKey, ModelProvenance, PlaySegmentRef } from "../types.js";

/** One JPEG frame extracted by `@footballos/media` at a planned timestamp. */
export interface LabelFrame {
  /** Seconds from the start of the asset. Must be strictly ascending across the array. */
  atSec: number;
  /** Raw base64 (no data: prefix) of a JPEG. */
  jpegBase64: string;
  /** Pixel dimensions when known; used for the pre-call cost estimate only. */
  width?: number | null;
  height?: number | null;
}

export interface LabelSegmentInput {
  segment: Pick<PlaySegmentRef, "id" | "assetId" | "gameId" | "startSec" | "endSec">;
  /** Ordered frames; each carries its timestamp into the prompt text. */
  frames: LabelFrame[];
  context: AssetContext;
  /** Keys the caller wants. Keys not listed are never returned. */
  labelKeys: LabelKey[];
  /** Optional team vocabulary for `formation_family`; included in the prompt verbatim as data. */
  formationVocabulary?: string[];
  /** Metadata for provenance.preprocessing; null when unknown. */
  samplingFps?: number | null;
  /** e.g. "1280x720"; "unknown" when not supplied. */
  resolution?: string;
}

export interface LabelSegmentOutput {
  labels: InferredLabel[];
  provenance: ModelProvenance;
}

/**
 * The replaceable adapter (DECISIONS D-004). Implementations either return labels with
 * complete provenance or throw `ProviderUnavailableError`; they never return a canned
 * result and never set a value without evidence.
 */
export interface VisionLabeler {
  readonly provider: ModelProvenance["provider"];
  /** True when a real call could be attempted (key present, implementation available). */
  isAvailable(): boolean;
  labelSegment(input: LabelSegmentInput): Promise<LabelSegmentOutput>;
}

export const ANALYSIS_VERSION = "0.1.0";
