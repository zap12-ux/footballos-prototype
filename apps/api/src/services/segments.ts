import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { CreateSegmentRequest, MergeSegmentsRequest, PatchSegmentRequest, PlaySegment, SplitSegmentRequest } from '@footballos/contracts';
import { renumber, splitSegment } from '@footballos/media';
import type { AppContext } from '../context.js';
import type { Db } from '../db/db.js';
import { labels as labelsTable, playSegments } from '../db/schema.js';
import { errors } from '../errors.js';
import { ensureDefaultLabels } from './labels.js';
import type { AssetRow } from './media.js';

export type SegmentRow = typeof playSegments.$inferSelect;

export function serializeSegment(s: SegmentRow): PlaySegment {
  return { id: s.id, teamId: s.teamId, assetId: s.assetId, gameId: s.gameId, index: s.index, startSec: s.startSec, endSec: s.endSec, origin: s.origin as PlaySegment['origin'], reviewStatus: s.reviewStatus as PlaySegment['reviewStatus'], supersededBy: s.supersededBy, version: s.version, createdAt: s.createdAt, updatedAt: s.updatedAt };
}

export function getSegment(ctx: AppContext, segmentId: string): SegmentRow | undefined {
  return ctx.db.select().from(playSegments).where(eq(playSegments.id, segmentId)).get();
}

export function requireSegment(ctx: AppContext, segmentId: string, teamIds: string[]): SegmentRow {
  const s = getSegment(ctx, segmentId);
  if (!s || !teamIds.includes(s.teamId)) throw errors.notFound('Segment');
  return s;
}

/** Non-superseded segments of an asset ordered by time. */
export function listLiveSegments(db: Db, assetId: string): SegmentRow[] {
  return db.select().from(playSegments).where(eq(playSegments.assetId, assetId)).orderBy(asc(playSegments.startSec), asc(playSegments.endSec)).all().filter((s) => s.supersededBy.length === 0);
}

export function listAllSegments(db: Db, assetId: string): SegmentRow[] {
  return db.select().from(playSegments).where(eq(playSegments.assetId, assetId)).orderBy(asc(playSegments.startSec)).all();
}

function renumberLive(tx: Db, assetId: string, nowIso: string): void {
  const live = listLiveSegments(tx, assetId).map(serializeSegment);
  for (const s of renumber(live, () => new Date(nowIso))) {
    const before = live.find((x) => x.id === s.id)!;
    if (before.index !== s.index) tx.update(playSegments).set({ index: s.index, updatedAt: nowIso }).where(eq(playSegments.id, s.id)).run();
  }
}

function assertNoOverlap(tx: Db, assetId: string, candidate: { id: string | null; startSec: number; endSec: number }): void {
  for (const s of listLiveSegments(tx, assetId)) {
    if (s.id === candidate.id) continue;
    if (candidate.startSec < s.endSec && s.startSec < candidate.endSec) {
      throw errors.conflict(`Overlaps segment ${s.id} (${s.startSec}–${s.endSec} s)`, { overlapsSegmentId: s.id });
    }
  }
}

function insertSegment(tx: Db, row: SegmentRow): void {
  tx.insert(playSegments).values(row).run();
  ensureDefaultLabels(tx, row, row.createdAt);
}

/** Replaces the previous machine proposals that no coach has touched; keeps reviewed or edited segments. */
export function storeProposedSegments(tx: Db, asset: AssetRow, proposals: PlaySegment[], nowIso: string): { stored: number; kept: number } {
  const existing = listAllSegments(tx, asset.id);
  const coachTouched = new Set<string>(
    existing.length === 0
      ? []
      : tx
          .select({ segmentId: labelsTable.segmentId })
          .from(labelsTable)
          .where(and(inArray(labelsTable.segmentId, existing.map((s) => s.id)), sql`json_extract(${labelsTable.accepted}, '$.byUserId') IS NOT NULL`))
          .all()
          .map((r) => r.segmentId),
  );
  const removable = existing.filter((s) => s.origin === 'proposed' && s.reviewStatus === 'proposed' && s.supersededBy.length === 0 && !coachTouched.has(s.id));
  for (const s of removable) tx.delete(playSegments).where(eq(playSegments.id, s.id)).run();
  const kept = existing.length - removable.length;
  let stored = 0;
  for (const p of proposals) {
    const overlapsKept = listLiveSegments(tx, asset.id).some((s) => p.startSec < s.endSec && s.startSec < p.endSec);
    if (overlapsKept) continue;
    insertSegment(tx, { id: p.id, teamId: asset.teamId, assetId: asset.id, gameId: asset.gameId, index: p.index, startSec: p.startSec, endSec: p.endSec, origin: 'proposed', reviewStatus: 'proposed', supersededBy: [], version: 1, createdAt: nowIso, updatedAt: nowIso });
    stored += 1;
  }
  renumberLive(tx, asset.id, nowIso);
  return { stored, kept };
}

export function createSegment(ctx: AppContext, asset: AssetRow, body: CreateSegmentRequest): SegmentRow {
  const nowIso = ctx.now().toISOString();
  if (asset.durationSec !== null && body.endSec > asset.durationSec + 0.5) throw errors.validation(`endSec ${body.endSec} is past the end of the film (${asset.durationSec} s)`);
  return ctx.db.transaction((tx) => {
    assertNoOverlap(tx, asset.id, { id: null, startSec: body.startSec, endSec: body.endSec });
    const row: SegmentRow = { id: crypto.randomUUID(), teamId: asset.teamId, assetId: asset.id, gameId: asset.gameId, index: 0, startSec: body.startSec, endSec: body.endSec, origin: 'coach_created', reviewStatus: 'accepted', supersededBy: [], version: 1, createdAt: nowIso, updatedAt: nowIso };
    insertSegment(tx, row);
    renumberLive(tx, asset.id, nowIso);
    return tx.select().from(playSegments).where(eq(playSegments.id, row.id)).get()!;
  });
}

export function split(ctx: AppContext, seg: SegmentRow, body: SplitSegmentRequest): { segments: [SegmentRow, SegmentRow]; superseded: SegmentRow } {
  if (seg.version !== body.expectedVersion) throw errors.conflict(`Segment version ${body.expectedVersion} expected, current is ${seg.version}`, { currentVersion: seg.version });
  if (seg.supersededBy.length > 0) throw errors.conflict('Segment was already split or merged', { supersededBy: seg.supersededBy });
  if (!(body.atSec > seg.startSec && body.atSec < seg.endSec)) throw errors.validation(`atSec must lie strictly inside ${seg.startSec}–${seg.endSec}`);
  const now = ctx.now();
  const r = splitSegment(serializeSegment(seg), body.atSec, { now: () => now });
  return ctx.db.transaction((tx) => {
    tx.update(playSegments).set({ supersededBy: r.original.supersededBy, version: r.original.version, updatedAt: r.original.updatedAt }).where(eq(playSegments.id, seg.id)).run();
    for (const p of r.parts) insertSegment(tx, { ...p });
    renumberLive(tx, seg.assetId, now.toISOString());
    const [a, b] = r.parts.map((p) => tx.select().from(playSegments).where(eq(playSegments.id, p.id)).get()!) as [SegmentRow, SegmentRow];
    return { segments: [a, b], superseded: tx.select().from(playSegments).where(eq(playSegments.id, seg.id)).get()! };
  });
}

/** Merges two or more live segments of one asset into one spanning segment; the originals are kept and marked superseded. */
export function merge(ctx: AppContext, teamIds: string[], body: MergeSegmentsRequest): { segment: SegmentRow; superseded: SegmentRow[] } {
  const ids = [...new Set(body.segmentIds)];
  const rows = ctx.db.select().from(playSegments).where(inArray(playSegments.id, ids)).all();
  if (rows.length !== ids.length || rows.some((r) => !teamIds.includes(r.teamId))) throw errors.notFound('Segment');
  const assetId = rows[0]!.assetId;
  if (rows.some((r) => r.assetId !== assetId)) throw errors.validation('Segments must belong to the same asset');
  for (const r of rows) {
    const expected = body.expectedVersion[r.id];
    if (expected === undefined) throw errors.validation(`expectedVersion missing for segment ${r.id}`);
    if (expected !== r.version) throw errors.conflict(`Segment ${r.id} version ${expected} expected, current is ${r.version}`, { currentVersion: r.version, segmentId: r.id });
    if (r.supersededBy.length > 0) throw errors.conflict(`Segment ${r.id} was already split or merged`, { segmentId: r.id, supersededBy: r.supersededBy });
  }
  const nowIso = ctx.now().toISOString();
  const merged: SegmentRow = {
    id: crypto.randomUUID(), teamId: rows[0]!.teamId, assetId, gameId: rows[0]!.gameId, index: Math.min(...rows.map((r) => r.index)),
    startSec: Math.min(...rows.map((r) => r.startSec)), endSec: Math.max(...rows.map((r) => r.endSec)), origin: 'coach_merged', reviewStatus: 'accepted',
    supersededBy: [], version: 1, createdAt: nowIso, updatedAt: nowIso,
  };
  return ctx.db.transaction((tx) => {
    for (const r of rows) tx.update(playSegments).set({ supersededBy: [...r.supersededBy, merged.id], version: r.version + 1, updatedAt: nowIso }).where(eq(playSegments.id, r.id)).run();
    assertNoOverlap(tx, assetId, { id: null, startSec: merged.startSec, endSec: merged.endSec });
    insertSegment(tx, merged);
    renumberLive(tx, assetId, nowIso);
    return { segment: tx.select().from(playSegments).where(eq(playSegments.id, merged.id)).get()!, superseded: tx.select().from(playSegments).where(inArray(playSegments.id, ids)).all() };
  });
}

export function patchSegment(ctx: AppContext, seg: SegmentRow, body: PatchSegmentRequest): SegmentRow {
  if (seg.version !== body.expectedVersion) throw errors.conflict(`Segment version ${body.expectedVersion} expected, current is ${seg.version}`, { currentVersion: seg.version });
  if (seg.supersededBy.length > 0) throw errors.conflict('Segment was already split or merged', { supersededBy: seg.supersededBy });
  const startSec = body.startSec ?? seg.startSec;
  const endSec = body.endSec ?? seg.endSec;
  if (!(endSec > startSec)) throw errors.validation('endSec must be after startSec');
  const nowIso = ctx.now().toISOString();
  return ctx.db.transaction((tx) => {
    if (startSec !== seg.startSec || endSec !== seg.endSec) assertNoOverlap(tx, seg.assetId, { id: seg.id, startSec, endSec });
    const updated = tx.update(playSegments).set({ startSec, endSec, reviewStatus: body.reviewStatus ?? seg.reviewStatus, version: seg.version + 1, updatedAt: nowIso }).where(and(eq(playSegments.id, seg.id), eq(playSegments.version, seg.version))).returning().get();
    if (!updated) throw errors.conflict('Segment changed concurrently', { currentVersion: seg.version + 1 });
    renumberLive(tx, seg.assetId, nowIso);
    return tx.select().from(playSegments).where(eq(playSegments.id, seg.id)).get()!;
  });
}
