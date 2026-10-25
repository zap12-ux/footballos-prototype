import type { EvalReport, KeyMetrics, PredictionRow, TruthRow } from "./types.js";

const ABSTAIN = "<abstain>";

function norm(v: string): string {
  return v.trim().toLowerCase();
}

/**
 * Score predictions against coach truth on the held-out games only. Truth rows with a null
 * value are not scored (the coach did not know either). A labeled item with no prediction
 * row counts as an abstention (`missing`), never as correct. Values compare
 * case-insensitively after trimming.
 */
export function evaluate(truth: TruthRow[], predictions: PredictionRow[], heldOutGameIds: string[], trainingGameIds: string[] = []): EvalReport {
  const heldOut = new Set(heldOutGameIds);
  const training = new Set(trainingGameIds);

  // Leakage: a segment id that appears under a held-out game and also under a training game.
  const segGames = new Map<string, Set<string>>();
  for (const r of [...truth, ...predictions]) {
    let s = segGames.get(r.segmentId);
    if (!s) segGames.set(r.segmentId, (s = new Set()));
    s.add(r.gameId);
  }
  const offending = [...segGames.entries()]
    .filter(([, games]) => [...games].some((g) => heldOut.has(g)) && [...games].some((g) => training.has(g)))
    .map(([id]) => id)
    .sort();

  const predIndex = new Map<string, PredictionRow>();
  for (const p of predictions) {
    if (!heldOut.has(p.gameId)) continue;
    predIndex.set(`${p.segmentId}\u0000${p.key}`, p);
  }

  const perKey = new Map<string, KeyMetrics>();
  const segments = new Set<string>();
  for (const t of truth) {
    if (!heldOut.has(t.gameId) || t.value === null) continue;
    segments.add(t.segmentId);
    let m = perKey.get(t.key);
    if (!m) {
      m = { key: t.key, n: 0, predicted: 0, abstained: 0, missing: 0, correct: 0, accuracyOnPredicted: null, abstentionRate: null, usableCoverage: null, errorRate: null, confusion: {} };
      perKey.set(t.key, m);
    }
    m.n += 1;
    const truthVal = norm(t.value);
    const p = predIndex.get(`${t.segmentId}\u0000${t.key}`);
    let predVal: string;
    if (!p) {
      m.missing += 1;
      predVal = ABSTAIN;
    } else if (p.abstained || p.value === null) {
      m.abstained += 1;
      predVal = ABSTAIN;
    } else {
      m.predicted += 1;
      predVal = norm(p.value);
      if (predVal === truthVal) m.correct += 1;
    }
    const row = (m.confusion[truthVal] ??= {});
    row[predVal] = (row[predVal] ?? 0) + 1;
  }

  const metrics = [...perKey.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((m) => {
      const wrong = m.predicted - m.correct;
      return {
        ...m,
        accuracyOnPredicted: m.predicted === 0 ? null : round4(m.correct / m.predicted),
        abstentionRate: m.n === 0 ? null : round4((m.abstained + m.missing) / m.n),
        usableCoverage: m.n === 0 ? null : round4(m.correct / m.n),
        errorRate: m.n === 0 ? null : round4(wrong / m.n),
      };
    });

  return {
    evaluatedGameIds: [...heldOut].sort(),
    trainingGameIds: [...training].sort(),
    segmentsEvaluated: segments.size,
    perKey: metrics,
    leakageCheck: { ok: offending.length === 0, offendingSegmentIds: offending },
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
