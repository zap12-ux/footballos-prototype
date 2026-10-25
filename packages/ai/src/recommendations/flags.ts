/**
 * `planReviewFlags` (CONTRACTS §15.4): computed on read, never mutating a plan version. Flags
 * come from comparing the `inputsHash` stored on the recommendations a version's items came
 * from (and, when available, component hashes) against the current hashes.
 */
import type { PlanItem } from "@footballos/contracts";
import type { PlanReviewFlagsInput, RecommendationInputHashes, ReviewFlag } from "./types.js";

const KIND_ORDER: Record<ReviewFlag["kind"], number> = { labels_changed: 0, playbook_changed: 1, personnel_changed: 2, stale_recommendation: 3 };

const COMPONENTS: { key: keyof Omit<RecommendationInputHashes, "inputsHash">; kind: Exclude<ReviewFlag["kind"], "stale_recommendation">; what: string }[] = [
  { key: "labelsHash", kind: "labels_changed", what: "Film labels or segments behind the scouting findings" },
  { key: "playbookHash", kind: "playbook_changed", what: "The approved playbook or its installed concepts" },
  { key: "personnelHash", kind: "personnel_changed", what: "Personnel (roster, availability, packages or depth chart)" },
];

export function planReviewFlags(input: PlanReviewFlagsInput): ReviewFlag[] {
  const { version, recommendations, currentHashes, baselineHashes } = input;
  if (!version || !Array.isArray(version.sections)) throw new TypeError("version.sections is required");
  if (!currentHashes || typeof currentHashes.inputsHash !== "string") throw new TypeError("currentHashes.inputsHash is required");
  if (version.status === "superseded") return [];

  const recById = new Map(recommendations.map((r) => [r.id, r]));
  const flags: ReviewFlag[] = [];
  const items: PlanItem[] = version.sections.flatMap((s) => s.items);
  const referenced = new Set<string>();

  for (const item of items) {
    if (!item.sourceRecommendationId) continue;
    const rec = recById.get(item.sourceRecommendationId);
    if (!rec) {
      flags.push({ kind: "stale_recommendation", message: "The recommendation this item came from is no longer available; review the item.", itemId: item.id, since: version.createdAt });
      continue;
    }
    referenced.add(rec.id);
    if (rec.status === "stale") {
      flags.push({ kind: "stale_recommendation", message: `The recommendation behind this item is stale${rec.staleReason ? ` (${rec.staleReason})` : ""}; review the item.`, itemId: item.id, since: rec.decidedAt ?? rec.createdAt });
    } else if (rec.inputsHash !== currentHashes.inputsHash) {
      flags.push({ kind: "stale_recommendation", message: "The film labels, playbook or personnel this item was based on have changed since it was generated; review the item.", itemId: item.id, since: rec.createdAt });
    }
  }

  // Component flags: from the explicit baseline, else from hashes stored with the referenced recommendations.
  let baseline: Partial<RecommendationInputHashes> | null = baselineHashes ?? null;
  let since = baselineHashes?.at ?? version.approvedAt ?? version.createdAt;
  if (!baseline) {
    const withHashes = recommendations.filter((r) => referenced.has(r.id) && r.inputHashes).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const latest = withHashes[0];
    if (latest?.inputHashes) {
      baseline = latest.inputHashes;
      since = latest.createdAt;
    }
  }
  if (baseline) {
    const affected = flags.filter((f) => f.kind === "stale_recommendation" && f.itemId).length;
    for (const c of COMPONENTS) {
      const was = baseline[c.key];
      const is = currentHashes[c.key];
      if (typeof was === "string" && typeof is === "string" && was !== is) {
        flags.push({ kind: c.kind, message: `${c.what} changed after this plan version was prepared${affected > 0 ? `; ${affected} item(s) came from recommendations that need review` : ""}.`, since });
      }
    }
  }

  return flags.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.itemId ?? "").localeCompare(b.itemId ?? ""));
}
