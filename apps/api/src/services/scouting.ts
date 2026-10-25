import { createHash } from 'node:crypto';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import type { CreateSnapshotRequest, ReportSnapshot, ScoutingFinding, ScoutingQuery, ScoutingResponse, Unit } from '@footballos/contracts';
import { COMPUTE_VERSION, computeFindings, resolveLabelValue, type StatSegment } from '@footballos/ai';
import type { AppContext } from '../context.js';
import { mediaAssets, playSegments, reportSnapshots, scheduledGames } from '../db/schema.js';
import { errors } from '../errors.js';
import { listLabelsForSegments, serializeLabel } from './labels.js';

export type SnapshotRow = typeof reportSnapshots.$inferSelect;

export function serializeSnapshot(s: SnapshotRow): ReportSnapshot {
  return { id: s.id, teamId: s.teamId, opponentId: s.opponentId, title: s.title, findings: s.findings, generatedBy: s.generatedBy, generatedAt: s.generatedAt, inputsHash: s.inputsHash };
}

type Inputs = {
  games: { gameId: string; assetIds: string[] }[];
  segments: StatSegment[];
  labels: ReturnType<typeof serializeLabel>[];
  inputsHash: string;
};

/** Stored segments and labels of opponent film (`context.analyzedTeam === 'opponent'`) for the opponent's games. */
function gatherInputs(ctx: AppContext, teamId: string, opponentId: string, basis: ScoutingQuery['reviewBasis'], gameIds?: string[]): Inputs {
  const conds = [eq(scheduledGames.teamId, teamId), eq(scheduledGames.opponentId, opponentId)];
  if (gameIds && gameIds.length > 0) conds.push(inArray(scheduledGames.id, gameIds));
  const games = ctx.db.select({ id: scheduledGames.id }).from(scheduledGames).where(and(...conds)).orderBy(asc(scheduledGames.scheduledAt), asc(scheduledGames.createdAt)).all();
  const gameIdList = games.map((g) => g.id);
  const assets = gameIdList.length
    ? ctx.db.select().from(mediaAssets).where(and(eq(mediaAssets.teamId, teamId), inArray(mediaAssets.gameId, gameIdList), ne(mediaAssets.status, 'deleted'))).all()
        .filter((a) => a.context.analyzedTeam === 'opponent')
    : [];
  const assetIds = assets.map((a) => a.id);
  const segRows = assetIds.length ? ctx.db.select().from(playSegments).where(inArray(playSegments.assetId, assetIds)).orderBy(asc(playSegments.assetId), asc(playSegments.startSec)).all() : [];
  const labelRows = listLabelsForSegments(ctx.db, segRows.map((s) => s.id)).map(serializeLabel);
  const labelsBySeg = new Map<string, typeof labelRows>();
  for (const l of labelRows) { const arr = labelsBySeg.get(l.segmentId) ?? []; arr.push(l); labelsBySeg.set(l.segmentId, arr); }
  const assetUnit = new Map(assets.map((a) => [a.id, a.context.analyzedUnit]));
  const segments: StatSegment[] = segRows.map((s) => {
    const unitLabel = labelsBySeg.get(s.id)?.find((l) => l.key === 'unit');
    const resolved = resolveLabelValue(unitLabel, basis);
    const fromLabel = resolved.value && ['offense', 'defense', 'special_teams'].includes(resolved.value) ? (resolved.value as Unit) : null;
    const fromAsset = assetUnit.get(s.assetId);
    return { id: s.id, gameId: s.gameId, unit: fromLabel ?? (fromAsset && fromAsset !== 'mixed' ? fromAsset : null), reviewStatus: s.reviewStatus as StatSegment['reviewStatus'], supersededBy: s.supersededBy };
  });
  const hash = createHash('sha256');
  for (const s of segRows) hash.update(`${s.id}:${s.version}:${s.reviewStatus}\n`);
  for (const l of labelRows) hash.update(`${l.id}:${l.version}\n`);
  hash.update(basis);
  return {
    games: games.map((g) => ({ gameId: g.id, assetIds: assets.filter((a) => a.gameId === g.id).map((a) => a.id) })),
    segments, labels: labelRows, inputsHash: hash.digest('hex'),
  };
}

export function computeScouting(ctx: AppContext, teamId: string, opponentId: string, q: ScoutingQuery): ScoutingResponse & { inputsHash: string } {
  const inputs = gatherInputs(ctx, teamId, opponentId, q.reviewBasis, q.gameIds);
  const now = ctx.now();
  const findings = computeFindings(inputs.segments, inputs.labels, { teamId, opponentId, unit: q.unit, reviewBasis: q.reviewBasis, now: () => now }) as ScoutingFinding[];
  const eligible = inputs.segments.filter((s) => s.supersededBy.length === 0 && s.reviewStatus !== 'rejected' && s.unit === q.unit && (q.reviewBasis === 'includes_inferred' || s.reviewStatus === 'accepted'));
  return { findings, games: inputs.games, sampleSize: eligible.length, computedAt: now.toISOString(), computeVersion: COMPUTE_VERSION, inputsHash: inputs.inputsHash };
}

export function createSnapshot(ctx: AppContext, userId: string, teamId: string, opponentId: string, body: CreateSnapshotRequest): SnapshotRow {
  const units: Unit[] = body.unit ? [body.unit] : ['offense', 'defense', 'special_teams'];
  const findings: ScoutingFinding[] = [];
  let inputsHash = '';
  for (const unit of units) {
    const r = computeScouting(ctx, teamId, opponentId, { unit, reviewBasis: body.reviewBasis, gameIds: body.gameIds });
    findings.push(...r.findings);
    inputsHash = r.inputsHash;
  }
  if (!inputsHash) throw errors.validation('Nothing to snapshot');
  const row: SnapshotRow = { id: crypto.randomUUID(), teamId, opponentId, title: body.title, findings, generatedBy: userId, generatedAt: ctx.now().toISOString(), inputsHash: createHash('sha256').update(inputsHash).update(units.join(',')).digest('hex') };
  ctx.db.insert(reportSnapshots).values(row).run();
  return row;
}

export function listSnapshots(ctx: AppContext, teamId: string, opponentId: string): SnapshotRow[] {
  return ctx.db.select().from(reportSnapshots).where(and(eq(reportSnapshots.teamId, teamId), eq(reportSnapshots.opponentId, opponentId))).orderBy(asc(reportSnapshots.generatedAt)).all();
}
