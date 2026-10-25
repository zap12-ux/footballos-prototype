import { and, asc, eq, inArray } from 'drizzle-orm';
import { LabelKeySchema, type BulkAcceptRequest, type Label, type LabelKey, type LabelRevision, type ModelProvenance, type PatchLabelRequest } from '@footballos/contracts';
import type { AppContext } from '../context.js';
import type { Db } from '../db/db.js';
import { labelRevisions, labels, modelProvenance, playSegments } from '../db/schema.js';
import { errors } from '../errors.js';
import { writeAudit } from './audit.js';

export type LabelRow = typeof labels.$inferSelect;
export type RevisionRow = typeof labelRevisions.$inferSelect;
export type ProvenanceRow = typeof modelProvenance.$inferSelect;

export const LABEL_KEYS: readonly LabelKey[] = LabelKeySchema.options;

export function serializeLabel(l: LabelRow): Label {
  return { id: l.id, teamId: l.teamId, segmentId: l.segmentId, key: l.key as LabelKey, inferred: l.inferred ?? null, accepted: l.accepted, provenanceId: l.provenanceId, version: l.version, createdAt: l.createdAt, updatedAt: l.updatedAt };
}

export function serializeRevision(r: RevisionRow): LabelRevision {
  return { id: r.id, labelId: r.labelId, previousValue: r.previousValue, newValue: r.newValue, previousStatus: r.previousStatus as LabelRevision['previousStatus'], newStatus: r.newStatus as LabelRevision['newStatus'], byUserId: r.byUserId, at: r.at, reason: r.reason };
}

export function serializeProvenance(p: ProvenanceRow): ModelProvenance {
  return {
    id: p.id, provider: p.provider as ModelProvenance['provider'], model: p.model, modelRevision: p.modelRevision, promptId: p.promptId, promptHash: p.promptHash,
    preprocessing: p.preprocessing, inspected: p.inspected, analysisVersion: p.analysisVersion, inputTokens: p.inputTokens, outputTokens: p.outputTokens,
    costUsd: p.costUsd, latencyMs: p.latencyMs, requestedAt: p.requestedAt, completedAt: p.completedAt,
  };
}

/**
 * Every segment carries one row per LabelKey from the moment it exists, with `inferred: null` and
 * `accepted.status: 'unknown'` ("not established", CONTRACTS §1). This is what makes manual
 * labeling available through `PATCH /labels/:id` when no model provider is configured (§14.5).
 */
export function ensureDefaultLabels(tx: Db, seg: { id: string; teamId: string }, nowIso: string): void {
  const existing = new Set(tx.select({ key: labels.key }).from(labels).where(eq(labels.segmentId, seg.id)).all().map((r) => r.key));
  const rows: LabelRow[] = [];
  for (const key of LABEL_KEYS) {
    if (existing.has(key)) continue;
    rows.push({ id: crypto.randomUUID(), teamId: seg.teamId, segmentId: seg.id, key, inferred: null, accepted: { value: null, status: 'unknown', byUserId: null, at: null }, provenanceId: null, version: 1, createdAt: nowIso, updatedAt: nowIso });
  }
  if (rows.length) tx.insert(labels).values(rows).run();
}

export function listLabelsForSegment(ctx: AppContext, segmentId: string): LabelRow[] {
  return ctx.db.select().from(labels).where(eq(labels.segmentId, segmentId)).orderBy(asc(labels.key)).all();
}

export function listLabelsForAsset(ctx: AppContext, assetId: string): LabelRow[] {
  return ctx.db
    .select({ label: labels })
    .from(labels)
    .innerJoin(playSegments, eq(playSegments.id, labels.segmentId))
    .where(eq(playSegments.assetId, assetId))
    .orderBy(asc(playSegments.startSec), asc(labels.key))
    .all()
    .map((r) => r.label);
}

export function listLabelsForSegments(db: Db, segmentIds: string[]): LabelRow[] {
  if (segmentIds.length === 0) return [];
  return db.select().from(labels).where(inArray(labels.segmentId, segmentIds)).all();
}

export function getLabel(ctx: AppContext, labelId: string): LabelRow | undefined {
  return ctx.db.select().from(labels).where(eq(labels.id, labelId)).get();
}

/** Coach correction (§14.5): new `accepted` block, version bump, one LabelRevision. */
export function correctLabel(ctx: AppContext, userId: string, label: LabelRow, body: PatchLabelRequest): LabelRow {
  if (label.version !== body.expectedVersion) {
    throw errors.conflict(`Label version ${body.expectedVersion} expected, current is ${label.version}`, { currentVersion: label.version });
  }
  const nowIso = ctx.now().toISOString();
  const value = body.accepted.status === 'rejected' || body.accepted.status === 'unknown' ? null : body.accepted.value;
  const accepted = { value, status: body.accepted.status, byUserId: userId, at: nowIso };
  return ctx.db.transaction((tx) => {
    tx.insert(labelRevisions).values({
      id: crypto.randomUUID(), labelId: label.id, previousValue: label.accepted.value, newValue: value, previousStatus: label.accepted.status,
      newStatus: body.accepted.status, byUserId: userId, at: nowIso, reason: body.reason ?? null,
    }).run();
    return tx.update(labels).set({ accepted, version: label.version + 1, updatedAt: nowIso }).where(eq(labels.id, label.id)).returning().get()!;
  });
}

export function listRevisions(ctx: AppContext, labelId: string): RevisionRow[] {
  return ctx.db.select().from(labelRevisions).where(eq(labelRevisions.labelId, labelId)).orderBy(asc(labelRevisions.at)).all();
}

/** Only labels with `accepted.status === 'inferred'` and a non-abstained inference change; everything else is counted as skipped. */
export function bulkAccept(ctx: AppContext, userId: string, asset: { id: string; teamId: string }, body: BulkAcceptRequest): { accepted: number; skipped: number } {
  const nowIso = ctx.now().toISOString();
  const assetSegmentIds = new Set(ctx.db.select({ id: playSegments.id }).from(playSegments).where(eq(playSegments.assetId, asset.id)).all().map((s) => s.id));
  const segmentIds = body.segmentIds.filter((id) => assetSegmentIds.has(id));
  if (segmentIds.length === 0) return { accepted: 0, skipped: 0 };
  const rows = ctx.db.select().from(labels).where(and(inArray(labels.segmentId, segmentIds), inArray(labels.key, body.keys))).all();
  let accepted = 0;
  let skipped = 0;
  ctx.db.transaction((tx) => {
    for (const l of rows) {
      if (l.accepted.status !== 'inferred' || !l.inferred || l.inferred.abstained) { skipped += 1; continue; }
      const next = { value: l.inferred.value, status: 'accepted' as const, byUserId: userId, at: nowIso };
      tx.insert(labelRevisions).values({
        id: crypto.randomUUID(), labelId: l.id, previousValue: l.accepted.value, newValue: next.value, previousStatus: l.accepted.status, newStatus: 'accepted',
        byUserId: userId, at: nowIso, reason: 'bulk accept',
      }).run();
      tx.update(labels).set({ accepted: next, version: l.version + 1, updatedAt: nowIso }).where(eq(labels.id, l.id)).run();
      accepted += 1;
    }
  });
  writeAudit(ctx, { teamId: asset.teamId, actorUserId: userId, action: 'labels.bulk_accepted', targetType: 'media_asset', targetId: asset.id, details: { accepted, skipped, keys: body.keys, segmentCount: segmentIds.length } });
  return { accepted, skipped };
}

export function listProvenanceForAsset(ctx: AppContext, assetId: string): ProvenanceRow[] {
  return ctx.db.select().from(modelProvenance).where(eq(modelProvenance.assetId, assetId)).orderBy(asc(modelProvenance.completedAt)).all();
}
