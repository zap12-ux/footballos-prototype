/**
 * Frame-sampling plan for one play segment. This package decides *which* timestamps to
 * inspect; `@footballos/media` extracts the JPEGs. The plan is explicit about what is NOT
 * inspected so that provenance and the UI can say so.
 */

export interface FramePlanInput {
  startSec: number;
  endSec: number;
  /** Frames per second to sample (e.g. 1). Must be > 0. */
  fps: number;
  /** Hard cap on the number of frames (cost control). Must be an integer >= 1. */
  maxFrames: number;
}

export interface CoverageGap {
  fromSec: number;
  toSec: number;
  /** Why the span is not inspected. */
  reason: "between_samples" | "after_last_sample" | "cap_reached";
}

export interface FramePlan {
  /** Ascending timestamps to extract, each inside [startSec, endSec). */
  timestampsSec: number[];
  /** fps actually achieved after the cap (may be lower than requested). */
  effectiveFps: number;
  requestedFps: number;
  /** True when the cap forced sparser sampling than requested. */
  capped: boolean;
  /** Spans of the segment that no frame represents (between samples and the tail). */
  gaps: CoverageGap[];
  /** Largest uninspected span in seconds. */
  maxGapSec: number;
  /** Plain-language note for provenance and UI. */
  note: string;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function planFrameSampling(input: FramePlanInput): FramePlan {
  const { startSec, endSec, fps, maxFrames } = input;
  if (!(endSec > startSec)) throw new Error("endSec must be greater than startSec");
  if (!(fps > 0) || !Number.isFinite(fps)) throw new Error("fps must be a positive number");
  if (!(maxFrames >= 1) || !Number.isInteger(maxFrames)) throw new Error("maxFrames must be an integer >= 1");

  const duration = endSec - startSec;
  // Samples at start, start+1/fps, ... while < endSec (the end boundary is a cut, not a frame).
  const naturalCount = Math.max(1, Math.ceil(duration * fps - 1e-9));
  const capped = naturalCount > maxFrames;
  const count = capped ? maxFrames : naturalCount;
  // When capped, spread the allowed frames evenly over the segment instead of truncating the tail.
  const step = capped ? duration / count : 1 / fps;
  const timestampsSec: number[] = [];
  for (let i = 0; i < count; i++) {
    const t = round3(startSec + i * step);
    if (t >= endSec) break;
    timestampsSec.push(t);
  }
  const effectiveFps = round3(timestampsSec.length / duration);

  const gaps: CoverageGap[] = [];
  for (let i = 1; i < timestampsSec.length; i++) {
    const a = timestampsSec[i - 1] as number;
    const b = timestampsSec[i] as number;
    if (b - a > 1e-9) gaps.push({ fromSec: a, toSec: b, reason: capped ? "cap_reached" : "between_samples" });
  }
  const last = timestampsSec[timestampsSec.length - 1] as number;
  if (endSec - last > 1e-9) gaps.push({ fromSec: last, toSec: round3(endSec), reason: "after_last_sample" });
  const maxGapSec = gaps.reduce((m, g) => Math.max(m, round3(g.toSec - g.fromSec)), 0);

  const note = capped
    ? `Sampled ${timestampsSec.length} frames (cap ${maxFrames}) over ${round3(duration)} s at about ${effectiveFps} fps instead of the requested ${fps} fps; motion between frames (up to ${maxGapSec} s) was not inspected.`
    : `Sampled ${timestampsSec.length} frames over ${round3(duration)} s at ${fps} fps; motion between frames (up to ${maxGapSec} s) was not inspected.`;

  return { timestampsSec, effectiveFps, requestedFps: fps, capped, gaps, maxGapSec, note };
}
