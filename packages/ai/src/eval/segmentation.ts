/** Interval utilities for comparing proposed play segments with coach-marked ones. */

export interface Interval {
  id?: string;
  startSec: number;
  endSec: number;
}

export function intervalIoU(a: Interval, b: Interval): number {
  const inter = Math.max(0, Math.min(a.endSec, b.endSec) - Math.max(a.startSec, b.startSec));
  const union = Math.max(a.endSec, b.endSec) - Math.min(a.startSec, b.startSec);
  return union <= 0 ? 0 : inter / union;
}

export interface SegmentationReport {
  truthCount: number;
  predictedCount: number;
  matched: number;
  /** matched / predictedCount; null when no predictions. */
  precision: number | null;
  /** matched / truthCount; null when no truth. */
  recall: number | null;
  /** Mean IoU over matched pairs; null when none matched. */
  meanIoU: number | null;
  /** Absolute boundary errors (seconds) over matched pairs. */
  boundary: { meanStartErrorSec: number | null; meanEndErrorSec: number | null; medianStartErrorSec: number | null; medianEndErrorSec: number | null };
  pairs: { truthIndex: number; predictedIndex: number; iou: number; startErrorSec: number; endErrorSec: number }[];
  unmatchedTruthIndices: number[];
  unmatchedPredictedIndices: number[];
}

/**
 * Greedy one-to-one matching by descending IoU with a threshold (default 0.5). Greedy is
 * deterministic and adequate for non-overlapping play segments; it is not an optimal
 * assignment.
 */
export function matchSegments(truth: Interval[], predicted: Interval[], iouThreshold = 0.5): SegmentationReport {
  const candidates: { t: number; p: number; iou: number }[] = [];
  truth.forEach((tv, t) =>
    predicted.forEach((pv, p) => {
      const iou = intervalIoU(tv, pv);
      if (iou >= iouThreshold) candidates.push({ t, p, iou });
    }),
  );
  candidates.sort((a, b) => b.iou - a.iou || a.t - b.t || a.p - b.p);
  const usedT = new Set<number>();
  const usedP = new Set<number>();
  const pairs: SegmentationReport["pairs"] = [];
  for (const c of candidates) {
    if (usedT.has(c.t) || usedP.has(c.p)) continue;
    usedT.add(c.t);
    usedP.add(c.p);
    const tv = truth[c.t]!;
    const pv = predicted[c.p]!;
    pairs.push({ truthIndex: c.t, predictedIndex: c.p, iou: c.iou, startErrorSec: Math.abs(pv.startSec - tv.startSec), endErrorSec: Math.abs(pv.endSec - tv.endSec) });
  }
  const starts = pairs.map((p) => p.startErrorSec);
  const ends = pairs.map((p) => p.endErrorSec);
  return {
    truthCount: truth.length,
    predictedCount: predicted.length,
    matched: pairs.length,
    precision: predicted.length === 0 ? null : pairs.length / predicted.length,
    recall: truth.length === 0 ? null : pairs.length / truth.length,
    meanIoU: pairs.length === 0 ? null : mean(pairs.map((p) => p.iou)),
    boundary: { meanStartErrorSec: mean(starts), meanEndErrorSec: mean(ends), medianStartErrorSec: median(starts), medianEndErrorSec: median(ends) },
    pairs,
    unmatchedTruthIndices: truth.map((_, i) => i).filter((i) => !usedT.has(i)),
    unmatchedPredictedIndices: predicted.map((_, i) => i).filter((i) => !usedP.has(i)),
  };
}

function mean(xs: number[]): number | null {
  return xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;
}
function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}
