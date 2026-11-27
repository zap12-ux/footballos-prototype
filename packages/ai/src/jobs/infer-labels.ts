/**
 * `infer_labels` job handler (CONTRACTS §14.8, hosted by B's worker). For every segment in
 * the job input it plans which frames to inspect, asks the injected `extractFrames` (C's
 * `@footballos/media` implementation in production) for those JPEGs, and sends them to the
 * `VisionLabeler`. Nothing is ever labeled without a model call; a segment that cannot be
 * labeled is listed in `skipped` with the reason, never given a default.
 */
import { DEFAULT_AI_CONFIG } from "../config.js";
import { ProviderUnavailableError, isProviderUnavailable, type ProviderUnavailableReason } from "../errors.js";
import { planFrameSampling } from "../frames/plan.js";
import type { LabelFrame, VisionLabeler } from "../labeler/types.js";
import { LABEL_KEYS, type AssetContext, type InferredLabel, type LabelKey, type ModelProvenance } from "../types.js";

/** C's `extractFrames(src, timestampsSec, { height? })` (CONTRACTS §14.8). */
export interface ExtractedFrame {
  atSec: number;
  jpeg: Uint8Array;
  width: number;
  height: number;
}
export type ExtractFrames = (
  src: string,
  timestampsSec: number[],
  opts: { height?: number },
) => Promise<ExtractedFrame[]>;

export interface InferLabelsSegmentInput {
  id: string;
  startSec: number;
  endSec: number;
  /** Requested sampling rate; defaults to 1 fps when missing or invalid. */
  fps?: number | null;
}

/** `ProcessingJob.input` for kind `infer_labels`. */
export interface InferLabelsJobInput {
  assetId: string;
  /** Path of the file frames are extracted from (proxy when present, else the original). */
  sourcePath: string;
  context: AssetContext;
  /** Keys to request; falls back to the handler's `labelKeys`, then to every key. */
  labelKeys?: LabelKey[] | null;
  segments: InferLabelsSegmentInput[];
}

export interface InferLabelsJob {
  id: string;
  input: InferLabelsJobInput;
}

export interface InferLabelsContext {
  signal: AbortSignal;
  progress(done: number, total: number, message: string): void | Promise<void>;
}

export type InferLabelsSkipReason =
  /** The provider refused this segment for a non-retryable, segment-local reason (refusal, truncated or invalid output, rejected input). */
  | "provider_unavailable"
  /** `extractFrames` returned no usable frame for the planned timestamps. */
  | "no_frames"
  /** `extractFrames` threw for this segment. */
  | "frame_extraction_failed"
  /** The segment record itself is unusable (missing id, endSec <= startSec). */
  | "invalid_segment"
  /** `ctx.signal` was aborted before this segment started. */
  | "canceled";

export interface InferLabelsSkipped {
  segmentId: string;
  reason: InferLabelsSkipReason;
  /** Human-readable detail (provider reason and message, extraction error, ...). Never a secret. */
  detail: string;
}

export interface InferLabelsPerSegment {
  segmentId: string;
  labels: InferredLabel[];
  provenance: ModelProvenance;
}

export interface InferLabelsResult {
  perSegment: InferLabelsPerSegment[];
  skipped: InferLabelsSkipped[];
  /** Sum of `provenance.costUsd` over the calls that completed (USD, 6 decimals). Always 0 with local Ollama inference. */
  costUsd: number;
}

export interface InferLabelsHandlerOptions {
  labeler: VisionLabeler;
  extractFrames: ExtractFrames;
  /** Default 12. */
  maxFramesPerSegment?: number;
  /** Keys requested when the job input has none; default: every `LabelKey`. */
  labelKeys?: LabelKey[];
  /** Extraction height passed to `extractFrames`; default 720. */
  frameHeight?: number;
}

export type InferLabelsHandler = (job: InferLabelsJob, ctx: InferLabelsContext) => Promise<InferLabelsResult>;

/**
 * Provider reasons that mean *no* segment of this job can succeed. They fail the job
 * (thrown, `retryable` preserved) instead of being recorded per segment.
 */
const JOB_WIDE_REASONS: ReadonlySet<ProviderUnavailableReason> = new Set(["unreachable", "model_missing", "model_not_vision"]);

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function validateLabelKeys(keys: LabelKey[] | null | undefined, fallback: readonly LabelKey[]): LabelKey[] {
  const chosen = keys && keys.length > 0 ? keys : [...fallback];
  const unknown = chosen.filter((k) => !LABEL_KEYS.includes(k));
  if (unknown.length > 0) throw new TypeError(`unknown label keys: ${unknown.join(", ")}`);
  if (new Set(chosen).size !== chosen.length) throw new TypeError("duplicate label keys requested");
  return chosen;
}

/** Frames as the labeler needs them: ascending, deduplicated, base64. */
function toLabelFrames(extracted: ExtractedFrame[]): LabelFrame[] {
  const sorted = [...extracted]
    .filter((f) => Number.isFinite(f.atSec) && f.atSec >= 0 && f.jpeg && f.jpeg.byteLength > 0)
    .sort((a, b) => a.atSec - b.atSec);
  const out: LabelFrame[] = [];
  for (const f of sorted) {
    const prev = out[out.length - 1];
    if (prev && f.atSec <= prev.atSec) continue;
    out.push({ atSec: f.atSec, jpegBase64: Buffer.from(f.jpeg).toString("base64"), width: f.width, height: f.height });
  }
  return out;
}

export function createInferLabelsHandler(options: InferLabelsHandlerOptions): InferLabelsHandler {
  const { labeler, extractFrames } = options;
  if (!labeler || typeof labeler.labelSegment !== "function") throw new TypeError("labeler is required");
  if (typeof extractFrames !== "function") throw new TypeError("extractFrames is required");
  const maxFramesPerSegment = options.maxFramesPerSegment ?? DEFAULT_AI_CONFIG.maxFramesPerSegment;
  if (!Number.isInteger(maxFramesPerSegment) || maxFramesPerSegment < 1) throw new TypeError("maxFramesPerSegment must be an integer >= 1");
  const defaultKeys = validateLabelKeys(options.labelKeys, LABEL_KEYS);
  const frameHeight = options.frameHeight ?? 720;

  return async function inferLabels(job, ctx): Promise<InferLabelsResult> {
    const input = job.input;
    if (!input || !Array.isArray(input.segments)) throw new TypeError(`job ${job.id}: input.segments must be an array`);
    if (typeof input.sourcePath !== "string" || input.sourcePath === "") throw new TypeError(`job ${job.id}: input.sourcePath is required`);
    const labelKeys = validateLabelKeys(input.labelKeys, defaultKeys);

    // CONTRACTS §14.5: no usable model server → the job fails immediately, non-retryable,
    // before any frame is extracted. Manual labeling stays available.
    if (!labeler.isAvailable()) {
      throw new ProviderUnavailableError({
        provider: labeler.provider,
        reason: "unreachable",
        retryable: false,
        message: "The model server is not available",
      });
    }

    const perSegment: InferLabelsPerSegment[] = [];
    const skipped: InferLabelsSkipped[] = [];
    const total = input.segments.length;
    let spentUsd = 0;

    await ctx.progress(0, total, `Labeling ${total} segment${total === 1 ? "" : "s"}`);

    for (let i = 0; i < total; i++) {
      const seg = input.segments[i]!;
      const segmentId = typeof seg?.id === "string" ? seg.id : `<segment ${i}>`;
      const done = () => ctx.progress(i + 1, total, `Segment ${i + 1} of ${total}`);

      if (ctx.signal.aborted) {
        skipped.push({ segmentId, reason: "canceled", detail: "job canceled before this segment started" });
        continue;
      }
      if (typeof seg?.id !== "string" || seg.id === "" || !Number.isFinite(seg.startSec) || !Number.isFinite(seg.endSec) || !(seg.endSec > seg.startSec)) {
        skipped.push({ segmentId, reason: "invalid_segment", detail: "segment needs an id and endSec > startSec" });
        await done();
        continue;
      }

      const fps = typeof seg.fps === "number" && Number.isFinite(seg.fps) && seg.fps > 0 ? seg.fps : 1;
      const plan = planFrameSampling({ startSec: seg.startSec, endSec: seg.endSec, fps, maxFrames: maxFramesPerSegment });

      let frames: LabelFrame[];
      try {
        frames = toLabelFrames(await extractFrames(input.sourcePath, plan.timestampsSec, { height: frameHeight }));
      } catch (err) {
        skipped.push({ segmentId, reason: "frame_extraction_failed", detail: err instanceof Error ? err.message : String(err) });
        await done();
        continue;
      }
      if (frames.length === 0) {
        skipped.push({ segmentId, reason: "no_frames", detail: `no frame extracted at ${plan.timestampsSec.length} planned timestamps` });
        await done();
        continue;
      }
      const first = frames[0]!;
      const resolution = first.width && first.height ? `${first.width}x${first.height}` : "unknown";

      try {
        const out = await labeler.labelSegment({
          segment: { id: seg.id, assetId: input.assetId, startSec: seg.startSec, endSec: seg.endSec },
          frames,
          context: input.context,
          labelKeys,
          samplingFps: plan.effectiveFps,
          resolution,
        });
        perSegment.push({ segmentId: seg.id, labels: out.labels, provenance: out.provenance });
        spentUsd = round6(spentUsd + out.provenance.costUsd);
      } catch (err) {
        if (!isProviderUnavailable(err)) throw err;
        // Retryable (timeout, 5xx) or job-wide (server down, model missing): the job fails and
        // the runner decides on a retry from `retryable`.
        if (err.retryable || JOB_WIDE_REASONS.has(err.reason)) throw err;
        skipped.push({ segmentId, reason: "provider_unavailable", detail: `${err.reason}: ${err.message}` });
      }
      await done();
    }

    return { perSegment, skipped, costUsd: round6(spentUsd) };
  };
}
