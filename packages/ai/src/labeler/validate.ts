import { ProviderUnavailableError } from "../errors.js";
import type { EvidenceRef, InferredLabel, LabelKey, Provider } from "../types.js";
import { LABEL_VOCABULARY, labelResponseSchema } from "./schema.js";

export interface ValidationContext {
  provider: Provider;
  assetId: string;
  requestedKeys: LabelKey[];
  /** Exactly the timestamps that were sent, in order. */
  inspectedTimestampsSec: number[];
}

const EPS = 1e-6;

function invalid(provider: Provider, message: string): ProviderUnavailableError {
  return new ProviderUnavailableError({
    provider,
    reason: "invalid_model_output",
    // A fresh sample may be valid; the job runner may retry within budget.
    retryable: true,
    message,
  });
}

/**
 * Turn raw model JSON into `InferredLabel[]`, rejecting anything that breaks the contract:
 * unknown or duplicate keys, keys that were not requested, evidence timestamps outside the
 * inspected set, abstained entries with a value, null values not marked abstained, non-null
 * values without evidence, values outside a closed vocabulary. Requested keys the model
 * omitted become explicit abstentions (value null, abstained true) so a missing key is never
 * mistaken for an answer.
 */
export function validateLabelResponse(raw: unknown, ctx: ValidationContext): InferredLabel[] {
  const parsed = labelResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw invalid(ctx.provider, `response did not match the label schema: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  }
  const requested = new Set<string>(ctx.requestedKeys);
  const seen = new Set<string>();
  const inspected = ctx.inspectedTimestampsSec;
  const byKey = new Map<LabelKey, InferredLabel>();

  for (const entry of parsed.data.labels) {
    if (!requested.has(entry.key)) throw invalid(ctx.provider, `model returned key "${entry.key}" that was not requested`);
    if (seen.has(entry.key)) throw invalid(ctx.provider, `model returned key "${entry.key}" twice`);
    seen.add(entry.key);

    const evidence: EvidenceRef[] = [];
    for (const ts of entry.evidence_timestamps_sec) {
      const idx = inspected.findIndex((t) => Math.abs(t - ts) < EPS);
      if (idx === -1) {
        throw invalid(ctx.provider, `model cited timestamp ${ts}s for "${entry.key}" which was not among the inspected frames`);
      }
      evidence.push({ assetId: ctx.assetId, atSec: inspected[idx] as number, toSec: null, frameIndex: idx, note: null });
    }

    if (entry.abstained && entry.value !== null) {
      throw invalid(ctx.provider, `model abstained on "${entry.key}" but still returned a value`);
    }
    if (!entry.abstained && entry.value === null) {
      throw invalid(ctx.provider, `model returned null for "${entry.key}" without marking it abstained`);
    }
    if (entry.value !== null && evidence.length === 0) {
      throw invalid(ctx.provider, `model set "${entry.key}" without citing any inspected frame`);
    }
    const vocab = LABEL_VOCABULARY[entry.key];
    if (entry.value !== null && vocab && !vocab.includes(entry.value.trim().toLowerCase())) {
      throw invalid(ctx.provider, `model value "${entry.value}" for "${entry.key}" is outside the allowed vocabulary`);
    }
    const value = entry.value === null ? null : vocab ? entry.value.trim().toLowerCase() : entry.value.trim();
    byKey.set(entry.key as LabelKey, {
      key: entry.key as LabelKey,
      inferred: {
        value,
        abstained: entry.abstained,
        rationale: entry.rationale.trim(),
        evidence,
        uncertainty: entry.abstained ? null : entry.uncertainty,
      },
    });
  }

  // Preserve the requested order; fill omissions with explicit abstentions.
  return ctx.requestedKeys.map(
    (key) =>
      byKey.get(key) ?? {
        key,
        inferred: {
          value: null,
          abstained: true,
          rationale: "The model returned no entry for this key; recorded as an abstention.",
          evidence: [],
          uncertainty: null,
        },
      },
  );
}
