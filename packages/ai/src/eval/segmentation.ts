/** Interval utilities for segmentation quality (proposed play boundaries vs coach boundaries). */

export interface Interval {
  id?: string;
  startSec: number;
  endSec: number;
}

export function intervalIoU(a: Interval, b: Interval): number {
  const inter = Math.max(0, Math.min(a.endSec, b.endSec) - Math.max(a.startSec, b.startSec));
  const union = a.endSec - a.startSec + (b.endSec - b.startSec) - inter;
  return union <= 0 ? 0 : inter / union;
}

export interface SegmentationMatch {
  truthIndex: number;
  predIndex: number;
  iou: number;
  startErrorSec: number;
  endErrorSec: number;
}

export interface SegmentationReport {
  truthCount: number;
  predCount: number;
  matched: number;
  precision: number | null;
  recall: number | null;
  meanIoU: number | null;
  meanStartErrorSec: number | null;
  meanEndErrorSec: number | null;
  medianBoundaryErrorSec: number | null;
  matches: SegmentationMatch[];
  unmatchedTruth: number[];
  unmatchedPred: number[];
}

function mean(xs: number[]): number | null {
  return xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * Greedy one-to-one matching by descending IoU with a threshold. Simple and deterministic;
 * adequate for play segments, which rarely overlap heavily.
 */
export function matchSegments(truth: Interval[], pred: Interval[], iouThreshold = 0.5): SegmentationReport {
  const candidates: { t: number; p: number; iou: number }[] = [];
  truth.forEach((t, ti) => pred.forEach((p, pi) => {
    const iou = intervalIoU(t, p);
    if (iou >= iouThreshold) candidates.push({ t: ti, p: pi, iou });
  }));
  candidates.sort((a, b) => b.iou - a.iou || a.t - b.t || a.p - b.p);
  const usedT = new Set<number>();
  const usedP = new Set<number>();
  const matches: SegmentationMatch[] = [];
  for (const c of candidates) {
    if (usedT.has(c.t) || usedP.has(c.p)) continue;
    usedT.add(c.t);
    usedP.add(c.p);
    matches.push({
      truthIndex: c.t,
      predIndex: c.p,
      iou: c.iou,
      startErrorSec: Math.abs(pred[c.p]!.startSec - truth[c.t]!.startSec),
      endErrorSec: Math.abs(pred[c.p]!.endSec - truth[c.t]!.endSec),
    });
  }
  const boundaryErrors = matches.flatMap((m) => [m.startErrorSec, m.endErrorSec]);
  return {
    truthCount: truth.length,
    predCount: pred.length,
    matched: matches.length,
    precision: pred.length === 0 ? null : matches.length / pred.length,
    recall: truth.length === 0 ? null : matches.length / truth.length,
    meanIoU: mean(matches.map((m) => m.iou)),
    meanStartErrorSec: mean(matches.map((m) => m.startErrorSec)),
    meanEndErrorSec: mean(matches.map((m) => m.endErrorSec)),
    medianBoundaryErrorSec: median(boundaryErrors),
    matches,
    unmatchedTruth: truth.map((_, i) => i).filter((i) => !usedT.has(i)),
    unmatchedPred: pred.map((_, i) => i).filter((i) => !usedP.has(i)),
  };
}
