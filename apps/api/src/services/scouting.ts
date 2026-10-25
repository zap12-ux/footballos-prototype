import { and, asc, eq, inArray } from 'drizzle-orm';
import type { CreateSnapshotRequest, ReportSnapshot, ScoutingFinding, ScoutingQuery, Unit } from '@footballos/contracts';
import { buildScoutingReport, snapshotFromReport, type ScoutingReport } from '@footballos/ai';
import type { AppContext } from '../context.js';
import { mediaAssets, playSegments, reportSnapshots, scheduledGames } from '../db/schema.js';
import { errors } from '../errors.js';
import { listLabelsForSegments, serializeLabel } from './labels.js';
import { serializeAsset } from './media.js';
import { serializeSegment } from './segments.js';

export type SnapshotRow = typeof reportSnapshots.$inferSelect;

export function serializeSnapshot(s: SnapshotRow): ReportSnapshot {
  return { id: s.id, teamId: s.teamId, opponentId: s.opponentId, title: s.title, findings: s.findings, generatedBy: s.generatedBy, generatedAt: s.generatedAt, inputsHash: s.inputsHash };
}

/**
 * §14.6: loads the opponent's games, their opponent film, segments and labels, and hands them to
 * `@footballos/ai` `buildScoutingReport` (computed on every call, never stored except as snapshots).
 */
export function computeScouting(ctx: AppContext, teamId: string, opponentId: string, q: ScoutingQuery): ScoutingReport {
  const games = ctx.db
    .select({ id: scheduledGames.id, opponentId: scheduledGames.opponentId })
    .from(scheduledGames)
    .where(and(eq(scheduledGames.teamId, teamId), eq(scheduledGames.opponentId, opponentId)))
    .orderBy(asc(scheduledGames.scheduledAt), asc(scheduledGames.createdAt))
    .all();
  const gameIds = games.map((g) => g.id);
  const assets = gameIds.length ? ctx.db.select().from(mediaAssets).where(and(eq(mediaAssets.teamId, teamId), inArray(mediaAssets.gameId, gameIds))).all().map(serializeAsset) : [];
  const assetIds = assets.map((a) => a.id);
  const segments = assetIds.length ? ctx.db.select().from(playSegments).where(inArray(playSegments.assetId, assetIds)).orderBy(asc(playSegments.assetId), asc(playSegments.startSec)).all().map(serializeSegment) : [];
  const labels = listLabelsForSegments(ctx.db, segments.map((s) => s.id)).map(serializeLabel);
  const now = ctx.now();
  return buildScoutingReport({ teamId, opponentId, unit: q.unit, reviewBasis: q.reviewBasis, games, gameIds: q.gameIds ?? null, assets, segments, labels, now: () => now });
}

export function createSnapshot(ctx: AppContext, userId: string, teamId: string, opponentId: string, body: CreateSnapshotRequest): SnapshotRow {
  const units: Unit[] = body.unit ? [body.unit] : ['offense', 'defense', 'special_teams'];
  const reports = units.map((unit) => computeScouting(ctx, teamId, opponentId, { unit, reviewBasis: body.reviewBasis, gameIds: body.gameIds }));
  const first = reports[0];
  if (!first) throw errors.validation('Nothing to snapshot');
  const combined: ScoutingReport = {
    ...first,
    findings: reports.flatMap((r) => r.findings) as ScoutingFinding[],
    inputsHash: reports.length === 1 ? first.inputsHash : reports.map((r) => `${r.unit}:${r.inputsHash}`).join('|'),
  };
  const snap = snapshotFromReport(combined, body.title, userId, { now: () => ctx.now() });
  const row: SnapshotRow = { id: snap.id, teamId: snap.teamId, opponentId: snap.opponentId, title: snap.title, findings: snap.findings, generatedBy: snap.generatedBy, generatedAt: snap.generatedAt, inputsHash: snap.inputsHash };
  ctx.db.insert(reportSnapshots).values(row).run();
  return row;
}

export function listSnapshots(ctx: AppContext, teamId: string, opponentId: string): SnapshotRow[] {
  return ctx.db.select().from(reportSnapshots).where(and(eq(reportSnapshots.teamId, teamId), eq(reportSnapshots.opponentId, opponentId))).orderBy(asc(reportSnapshots.generatedAt)).all();
}
