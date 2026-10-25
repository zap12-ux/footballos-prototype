/** Coach-labeled truth row (JSONL). */
export interface TruthRow {
  segmentId: string;
  gameId: string;
  key: string;
  /** null means the coach marked it unknown; such rows are not scored. */
  value: string | null;
}

/** Model prediction row (JSONL). */
export interface PredictionRow extends TruthRow {
  abstained: boolean;
}

export interface KeyMetrics {
  key: string;
  /** Coach-labeled items with a non-null truth value in the evaluated games. */
  n: number;
  predicted: number;
  abstained: number;
  /** Predictions missing for a labeled item count as abstentions. */
  missing: number;
  correct: number;
  /** correct / predicted; null when nothing was predicted. */
  accuracyOnPredicted: number | null;
  /** (abstained + missing) / n; null when n = 0. */
  abstentionRate: number | null;
  /** correct / n: the share of coach work the model saves without error; null when n = 0. */
  usableCoverage: number | null;
  /** wrong / n; null when n = 0. */
  errorRate: number | null;
  /** truth → (prediction or "<abstain>") → count. */
  confusion: Record<string, Record<string, number>>;
}

export interface EvalReport {
  evaluatedGameIds: string[];
  trainingGameIds: string[];
  segmentsEvaluated: number;
  perKey: KeyMetrics[];
  /** Hard check: no evaluated segment appears in a training game. */
  leakageCheck: { ok: boolean; offendingSegmentIds: string[] };
}
