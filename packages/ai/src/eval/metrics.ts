import type { PredictionRecord, TruthRecord } from "./jsonl.js";
import { assertNoClipLeakage, splitByGame, type GameSplit } from "./split.js";

export const ABSTAIN = "<abstain>";
export const MISSING = "<missing>";

export interface KeyMetrics {
  key: string;
  /** Coach-labeled items in the scored set (held-out games). */
  n: number;
  /** Items where the coach's value is null ("coach says unknown"); scored only for abstention. */
  coachUnknown: number;
  predicted: number;
  abstained: number;
  /** No prediction record at all; counted with abstentions in rates and shown separately. */
  missing: number;
  correct: number;
  /** correct / predicted (null when nothing was predicted). */
  accuracyOnPredicted: number | null;
  /** (abstained + missing) / n. */
  abstentionRate: number | null;
  /** correct / n: the share of coach labels the model got right without help. */
  usableCoverage: number | null;
  /** Predicted (non-abstained) where the coach said unknown: a sign of guessing. */
  predictedWhenCoachUnknown: number;
  /** truth value -> predicted value (or ABSTAIN / MISSING) -> count. */
  confusion: Record<string, Record<string, number>>;
}

export interface EvalReport {
  split: GameSplit;
  scoredGameIds: string[];
  scoredSegments: number;
  perKey: KeyMetrics[];
  overall: {
    n: number;
    predicted: number;
    correct: number;
    accuracyOnPredicted: number | null;
    abstentionRate: number | null;
    usableCoverage: number | null;
  };
}

function ratio(n: number, d: number): number | null {
  return d === 0 ? null : Math.round((n / d) * 10000) / 10000;
}

export function normalizeValue(v: string | null): string | null {
  return v === null ? null : v.trim().toLowerCase();
}

export interface EvaluateOptions {
  heldOutGameIds?: string[];
  heldOutFraction?: number;
  seed?: string;
  /** Score every game (no split); only for reports where no tuning happened. */
  scoreAllGames?: boolean;
}

export function evaluateLabels(truth: TruthRecord[], predictions: PredictionRecord[], opts: EvaluateOptions = {}): EvalReport {
  const allGames = new Set<string>([...truth.map((t) => t.gameId), ...predictions.map((p) => p.gameId)]);
  const split: GameSplit = opts.scoreAllGames
    ? { heldOutGameIds: [...allGames].sort(), developmentGameIds: [] }
    : splitByGame(allGames, { heldOutGameIds: opts.heldOutGameIds, heldOutFraction: opts.heldOutFraction, seed: opts.seed });
  assertNoClipLeakage([...truth, ...predictions], split);
  const scored = new Set(split.heldOutGameIds);

  const predIndex = new Map<string, PredictionRecord>();
  for (const p of predictions) {
    const id = `${p.segmentId}\u0000${p.key}`;
    if (predIndex.has(id)) throw new Error(`duplicate prediction for segment ${p.segmentId} key ${p.key}`);
    predIndex.set(id, p);
  }

  const perKey = new Map<string, KeyMetrics>();
  const segments = new Set<string>();
  const seenTruth = new Set<string>();
  for (const t of truth) {
    if (!scored.has(t.gameId)) continue;
    const id = `${t.segmentId}\u0000${t.key}`;
    if (seenTruth.has(id)) throw new Error(`duplicate coach label for segment ${t.segmentId} key ${t.key}`);
    seenTruth.add(id);
    segments.add(t.segmentId);
    let m = perKey.get(t.key);
    if (!m) {
      m = { key: t.key, n: 0, coachUnknown: 0, predicted: 0, abstained: 0, missing: 0, correct: 0, accuracyOnPredicted: null, abstentionRate: null, usableCoverage: null, predictedWhenCoachUnknown: 0, confusion: {} };
      perKey.set(t.key, m);
    }
    m.n += 1;
    const truthValue = normalizeValue(t.value);
    const truthKey = truthValue ?? "<unknown>";
    const p = predIndex.get(id);
    let predKey: string;
    if (!p) {
      m.missing += 1;
      predKey = MISSING;
    } else if (p.abstained || p.value === null) {
      m.abstained += 1;
      predKey = ABSTAIN;
    } else {
      m.predicted += 1;
      const predValue = normalizeValue(p.value)!;
      predKey = predValue;
      if (truthValue === null) m.predictedWhenCoachUnknown += 1;
      else if (predValue === truthValue) m.correct += 1;
    }
    if (truthValue === null) m.coachUnknown += 1;
    const row = (m.confusion[truthKey] ??= {});
    row[predKey] = (row[predKey] ?? 0) + 1;
  }

  const keys = [...perKey.values()].sort((a, b) => a.key.localeCompare(b.key));
  for (const m of keys) {
    const answerable = m.n - m.coachUnknown;
    const predictedOnAnswerable = m.predicted - m.predictedWhenCoachUnknown;
    m.accuracyOnPredicted = ratio(m.correct, predictedOnAnswerable);
    m.abstentionRate = ratio(m.abstained + m.missing, m.n);
    m.usableCoverage = ratio(m.correct, answerable);
  }
  const n = keys.reduce((s, m) => s + m.n, 0);
  const predicted = keys.reduce((s, m) => s + m.predicted - m.predictedWhenCoachUnknown, 0);
  const correct = keys.reduce((s, m) => s + m.correct, 0);
  const answerable = keys.reduce((s, m) => s + m.n - m.coachUnknown, 0);
  const abstainedAll = keys.reduce((s, m) => s + m.abstained + m.missing, 0);
  return {
    split,
    scoredGameIds: split.heldOutGameIds,
    scoredSegments: segments.size,
    perKey: keys,
    overall: {
      n,
      predicted,
      correct,
      accuracyOnPredicted: ratio(correct, predicted),
      abstentionRate: ratio(abstainedAll, n),
      usableCoverage: ratio(correct, answerable),
    },
  };
}

export function formatReport(report: EvalReport): string {
  const pct = (x: number | null) => (x === null ? "n/a" : `${(x * 100).toFixed(1)}%`);
  const lines: string[] = [];
  lines.push(`Scored games (held out): ${report.scoredGameIds.join(", ") || "none"}`);
  lines.push(`Development games (not scored): ${report.split.developmentGameIds.join(", ") || "none"}`);
  lines.push(`Scored segments: ${report.scoredSegments}`);
  lines.push("");
  lines.push("key | n | predicted | abstained | missing | correct | acc(pred) | abstention | usable coverage | guessed-when-unknown");
  for (const m of report.perKey) {
    lines.push(`${m.key} | ${m.n} | ${m.predicted} | ${m.abstained} | ${m.missing} | ${m.correct} | ${pct(m.accuracyOnPredicted)} | ${pct(m.abstentionRate)} | ${pct(m.usableCoverage)} | ${m.predictedWhenCoachUnknown}`);
  }
  lines.push("");
  const o = report.overall;
  lines.push(`overall | n=${o.n} predicted=${o.predicted} correct=${o.correct} acc(pred)=${pct(o.accuracyOnPredicted)} abstention=${pct(o.abstentionRate)} usable=${pct(o.usableCoverage)}`);
  lines.push("");
  for (const m of report.perKey) {
    lines.push(`confusion for ${m.key} (truth -> prediction: count)`);
    for (const [truthV, row] of Object.entries(m.confusion).sort()) {
      lines.push(`  ${truthV} -> ${Object.entries(row).sort().map(([p, c]) => `${p}: ${c}`).join(", ")}`);
    }
  }
  return lines.join("\n");
}
