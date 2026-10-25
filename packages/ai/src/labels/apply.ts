/**
 * Writing model inferences into `Label` rows (CONTRACTS §6, §14.5, §14.8) and the
 * bulk-accept rule (§14.5). Pure functions over records: B's API persists the `upserts`
 * inside one transaction per job completion; A's UI uses `bulkAcceptPlan` to show exactly
 * which labels a bulk accept will change.
 */
import { randomUUID } from "node:crypto";
import type { AcceptedStatus, InferredLabel, Label, LabelKey } from "../types.js";

export interface ApplyInferenceOptions {
  /** Required when a key has no existing label for the segment (new rows need a teamId). */
  teamId?: string;
  /** Injected for deterministic tests. */
  now?: () => Date;
  newId?: () => string;
}

export interface ApplyInferenceResult {
  /** Rows to insert (version 1) or replace (version bumped), in the order of `inferred`. */
  upserts: Label[];
}

/** Statuses a coach set; reprocessing must never overwrite them (CONTRACTS §6). */
export const COACH_OWNED_STATUSES: ReadonlySet<AcceptedStatus> = new Set(["accepted", "corrected", "rejected"]);

function acceptedFromInference(body: InferredLabel["inferred"]): Label["accepted"] {
  const abstained = body.abstained || body.value === null;
  return { value: abstained ? null : body.value, status: abstained ? "unknown" : "inferred", byUserId: null, at: null };
}

/** Latest-version label per key for one segment. */
function latestByKey(existing: Label[], segmentId: string): Map<LabelKey, Label> {
  const m = new Map<LabelKey, Label>();
  for (const l of existing) {
    if (l.segmentId !== segmentId) continue;
    const prev = m.get(l.key);
    if (!prev || l.version >= prev.version) m.set(l.key, l);
  }
  return m;
}

/**
 * Merge a fresh inference into the segment's labels.
 * - A key with no label → a new row whose `accepted` mirrors the inference
 *   (`inferred` status, or `unknown` when the model abstained).
 * - An existing row → a new `inferred` block, the new `provenanceId`, `version + 1`.
 *   `accepted` is recomputed only while its status is `inferred` or `unknown`; a status of
 *   `accepted`, `corrected` or `rejected` is a coach decision and is copied unchanged.
 * Labels of other segments and keys not in `inferred` are left alone and not returned.
 */
export function applyInference(
  existing: Label[],
  segmentId: string,
  inferred: InferredLabel[],
  provenanceId: string,
  opts: ApplyInferenceOptions = {},
): ApplyInferenceResult {
  if (typeof segmentId !== "string" || segmentId === "") throw new TypeError("segmentId is required");
  if (typeof provenanceId !== "string" || provenanceId === "") throw new TypeError("provenanceId is required");
  const seen = new Set<LabelKey>();
  for (const l of inferred) {
    if (seen.has(l.key)) throw new TypeError(`duplicate inferred key ${l.key}`);
    seen.add(l.key);
    if (l.inferred.abstained && l.inferred.value !== null) throw new TypeError(`${l.key}: an abstention must carry value null`);
  }

  const now = (opts.now ?? (() => new Date()))().toISOString();
  const newId = opts.newId ?? randomUUID;
  const current = latestByKey(existing, segmentId);
  const upserts: Label[] = [];

  for (const { key, inferred: body } of inferred) {
    const prev = current.get(key);
    if (!prev) {
      const teamId = opts.teamId ?? [...current.values()][0]?.teamId;
      if (!teamId) throw new TypeError(`cannot create a label for ${key}: no existing label on segment ${segmentId} and no teamId given`);
      upserts.push({
        id: newId(),
        teamId,
        segmentId,
        key,
        inferred: body,
        accepted: acceptedFromInference(body),
        provenanceId,
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
      continue;
    }
    const accepted = COACH_OWNED_STATUSES.has(prev.accepted.status) ? { ...prev.accepted } : acceptedFromInference(body);
    upserts.push({ ...prev, inferred: body, accepted, provenanceId, version: prev.version + 1, updatedAt: now });
  }
  return { upserts };
}

export type BulkAcceptSkipReason =
  | "status_accepted"
  | "status_corrected"
  | "status_rejected"
  | "status_unknown"
  /** `accepted.status` is `inferred` but the model abstained (or has no value). */
  | "abstained"
  /** No `inferred` block at all (manually created label). */
  | "no_inference";

export interface BulkAcceptPlan {
  /** Label ids whose `accepted` becomes `{ value: inferred.value, status: 'accepted' }`. */
  toAccept: string[];
  skipped: { id: string; reason: BulkAcceptSkipReason }[];
}

export interface BulkAcceptSelection {
  /** Segments in scope; `undefined` = every segment among `labels`. */
  segmentIds?: string[];
  /** Keys in scope; `undefined` = every key. */
  keys?: LabelKey[];
}

/**
 * Which labels a bulk accept (§14.5 `POST /assets/:assetId/labels/bulk-accept`) changes:
 * only those in scope whose `accepted.status === 'inferred'` and
 * `inferred.abstained === false` with a non-null value. Everything else in scope is listed
 * with the reason so the UI can explain the count. Labels out of scope are not reported.
 */
export function bulkAcceptPlan(labels: Label[], selection: BulkAcceptSelection): BulkAcceptPlan {
  const segments = selection.segmentIds ? new Set(selection.segmentIds) : null;
  const keys = selection.keys ? new Set<LabelKey>(selection.keys) : null;
  const toAccept: string[] = [];
  const skipped: BulkAcceptPlan["skipped"] = [];
  const seen = new Set<string>();
  for (const l of labels) {
    if (seen.has(l.id)) continue;
    seen.add(l.id);
    if (segments && !segments.has(l.segmentId)) continue;
    if (keys && !keys.has(l.key)) continue;
    if (l.accepted.status !== "inferred") {
      skipped.push({ id: l.id, reason: `status_${l.accepted.status}` as BulkAcceptSkipReason });
      continue;
    }
    if (!l.inferred) {
      skipped.push({ id: l.id, reason: "no_inference" });
      continue;
    }
    if (l.inferred.abstained || l.inferred.value === null) {
      skipped.push({ id: l.id, reason: "abstained" });
      continue;
    }
    toAccept.push(l.id);
  }
  return { toAccept, skipped };
}
