import { and, asc, eq } from 'drizzle-orm';
import type { Recommendation, RecommendationDecisionRequest, RecommendationStatus, Unit } from '@footballos/contracts';
import type { AppContext } from '../context.js';
import type { Db } from '../db/db.js';
import { recommendations, type InputHashes } from '../db/schema.js';
import { errors } from '../errors.js';
import {
  buildRecommendations, recommendationInputHashes, REPORT_UNIT_FOR_PLAN_UNIT, type BuildRecommendationsResult, type RecommendationInputs,
} from '../libs/index.js';
import { writeAudit } from './audit.js';
import { ensureDraft, ensurePlan, appendItem, sectionKeyForItem } from './plans.js';
import { getDepthChart, listPackages, listPlayers, serializeDepthChart, serializePackage, serializePlayer } from './personnel.js';
import { approvedVersion, conceptsById, listConcepts, serializeConcept } from './playbook.js';
import type { GameRow } from './schedule.js';
import { computeScouting } from './scouting.js';

export type RecommendationRow = typeof recommendations.$inferSelect;

/** Stored decision plus the stale state computed on read; the stored row is never rewritten by a read. */
export function serializeRecommendation(r: RecommendationRow, stale: { stale: boolean; reason: string | null } = { stale: false, reason: null }): Recommendation {
  return {
    id: r.id, teamId: r.teamId, gameId: r.gameId, unit: r.unit as Unit, statement: r.statement, supportingFindings: r.supportingFindings, supportingEvidence: r.supportingEvidence,
    counts: r.counts, limitations: r.limitations, contraryEvidence: r.contraryEvidence, playbookConceptIds: r.playbookConceptIds, personnelPackageIds: r.personnelPackageIds,
    status: stale.stale ? 'stale' : (r.status as RecommendationStatus), staleReason: stale.stale ? stale.reason : r.staleReason, decidedBy: r.decidedBy, decidedAt: r.decidedAt,
    inputsHash: r.inputsHash, createdAt: r.createdAt, version: r.version, editedStatement: r.editedStatement, decisionNote: r.decisionNote, storedStatus: r.status as RecommendationStatus, planItemId: r.planItemId,
  };
}

// Inputs ---------------------------------------------------------------------------------------------

/**
 * §15.3 inputs for a game and our unit: the reviewed-only scouting report on the opponent's
 * counterpart unit, the approved playbook version of the game's season, and current personnel for
 * the game week. Pure read; the same function feeds generation, stale checks and review flags.
 */
export function loadInputs(ctx: AppContext, game: GameRow, unit: Unit): RecommendationInputs & { teamId: string } {
  const reportUnit = REPORT_UNIT_FOR_PLAN_UNIT[unit];
  const report = game.opponentId
    ? computeScouting(ctx, game.teamId, game.opponentId, { unit: reportUnit, reviewBasis: 'reviewed_only' })
    : { teamId: game.teamId, opponentId: '', unit: reportUnit, reviewBasis: 'reviewed_only' as const, findings: [], inputsHash: 'no-opponent' };
  const version = approvedVersion(ctx.db, game.teamId, unit, game.seasonId);
  const playbook = version
    ? { versionId: version.id, status: 'approved' as const, concepts: listConcepts(ctx.db, version.id).map(serializeConcept) }
    : { versionId: null, status: null, concepts: [] };
  const depth = getDepthChart(ctx.db, game.teamId, game.seasonId, unit);
  const personnel = {
    players: listPlayers(ctx.db, game.teamId, game.seasonId, 'all').map(serializePlayer),
    packages: listPackages(ctx.db, game.teamId, game.seasonId).map(serializePackage),
    depthChart: depth ? serializeDepthChart(depth) : null,
    week: game.week,
  };
  return { report: { teamId: report.teamId, opponentId: report.opponentId, unit: report.unit, reviewBasis: report.reviewBasis, findings: report.findings, inputsHash: report.inputsHash }, playbook, personnel, unit, gameId: game.id, teamId: game.teamId };
}

export function currentHashes(ctx: AppContext, game: GameRow, unit: Unit): InputHashes {
  return recommendationInputHashes(loadInputs(ctx, game, unit));
}

// Generation -------------------------------------------------------------------------------------------

export type GenerateResult = BuildRecommendationsResult & { rows: RecommendationRow[]; supersededIds: string[] };

export function generate(ctx: AppContext, actorUserId: string, game: GameRow, unit: Unit): GenerateResult {
  const inputs = loadInputs(ctx, game, unit);
  const result = buildRecommendations({ ...inputs, now: ctx.now });
  const hashes = recommendationInputHashes(inputs);
  const nowIso = ctx.now().toISOString();
  const generationId = crypto.randomUUID();
  const rows: RecommendationRow[] = result.items.map((item) => ({
    id: item.id, teamId: game.teamId, gameId: game.id, unit, statement: item.statement, supportingFindings: item.supportingFindings, supportingEvidence: item.supportingEvidence,
    counts: item.counts, limitations: item.limitations, contraryEvidence: item.contraryEvidence, playbookConceptIds: item.playbookConceptIds, personnelPackageIds: item.personnelPackageIds,
    status: 'proposed', staleReason: null, decidedBy: null, decidedAt: null, editedStatement: null, decisionNote: null, planItemId: null, inputsHash: item.inputsHash,
    inputHashes: hashes, generationId, createdBy: actorUserId, createdAt: nowIso, version: 1,
  }));
  const supersededIds: string[] = [];
  ctx.db.transaction((tx) => {
    // Re-generation supersedes undecided recommendations and leaves decided ones (§15.3).
    const undecided = tx.select().from(recommendations).where(and(eq(recommendations.gameId, game.id), eq(recommendations.unit, unit), eq(recommendations.status, 'proposed'))).all();
    for (const u of undecided) {
      tx.update(recommendations).set({ status: 'rejected', staleReason: 'regenerated', version: u.version + 1 }).where(eq(recommendations.id, u.id)).run();
      supersededIds.push(u.id);
    }
    if (rows.length) tx.insert(recommendations).values(rows).run();
    writeAudit(ctx, {
      teamId: game.teamId, actorUserId, action: 'recommendation.generated', targetType: 'game', targetId: game.id,
      details: { unit, generated: rows.length, superseded: supersededIds.length, blockedReasons: result.blockedReasons, inputsHash: result.inputsHash, generationId },
    });
  });
  return { ...result, rows, supersededIds };
}

// Listing with stale computation -----------------------------------------------------------------------------

export function listRows(db: Db, gameId: string, unit?: Unit): RecommendationRow[] {
  const where = unit ? and(eq(recommendations.gameId, gameId), eq(recommendations.unit, unit)) : eq(recommendations.gameId, gameId);
  return db.select().from(recommendations).where(where).orderBy(asc(recommendations.createdAt)).all();
}

export function getRecommendation(ctx: AppContext, id: string): RecommendationRow | undefined {
  return ctx.db.select().from(recommendations).where(eq(recommendations.id, id)).get();
}

export function staleReasonFor(row: RecommendationRow, current: InputHashes): { stale: boolean; reason: string | null } {
  if (row.status === 'rejected') return { stale: false, reason: null };
  if (row.inputsHash === current.inputsHash) return { stale: false, reason: null };
  const changed: string[] = [];
  if (row.inputHashes.labelsHash !== current.labelsHash) changed.push('film labels');
  if (row.inputHashes.playbookHash !== current.playbookHash) changed.push('approved playbook');
  if (row.inputHashes.personnelHash !== current.personnelHash) changed.push('personnel or availability');
  return { stale: true, reason: changed.length ? `${changed.join(', ')} changed since generation` : 'inputs changed since generation' };
}

/** §15.3 list: every item with `stale` computed against the current inputs of its unit; stored decisions untouched. */
export function listForGame(ctx: AppContext, game: GameRow, unit?: Unit): Recommendation[] {
  const rows = listRows(ctx.db, game.id, unit);
  const units = [...new Set(rows.map((r) => r.unit as Unit))];
  const hashes = new Map(units.map((u) => [u, currentHashes(ctx, game, u)]));
  return rows.map((r) => serializeRecommendation(r, staleReasonFor(r, hashes.get(r.unit as Unit)!)));
}

export function serializeMany(ctx: AppContext, game: GameRow, rows: RecommendationRow[]): Recommendation[] {
  const units = [...new Set(rows.map((r) => r.unit as Unit))];
  const hashes = new Map(units.map((u) => [u, currentHashes(ctx, game, u)]));
  return rows.map((r) => serializeRecommendation(r, staleReasonFor(r, hashes.get(r.unit as Unit)!)));
}

// Decisions ---------------------------------------------------------------------------------------------------

const DECISION_STATUS: Record<RecommendationDecisionRequest['decision'], RecommendationStatus> = { accept: 'accepted', edit: 'edited', reject: 'rejected', defer: 'deferred' };

export function decide(ctx: AppContext, actorUserId: string, game: GameRow, row: RecommendationRow, body: RecommendationDecisionRequest): { row: RecommendationRow; planVersionId: string | null; planItemId: string | null } {
  if (body.expectedVersion !== undefined && body.expectedVersion !== row.version) {
    throw errors.conflict(`Recommendation version ${body.expectedVersion} expected, current is ${row.version}`, { currentVersion: row.version });
  }
  if (row.status === 'rejected' && row.staleReason === 'regenerated') throw errors.conflict('This recommendation was superseded by a newer generation', { currentStatus: row.status, reason: 'regenerated' });
  if (row.planItemId) throw errors.conflict('This recommendation was already placed in a plan', { currentStatus: row.status, planItemId: row.planItemId });
  const unit = row.unit as Unit;
  const nowIso = ctx.now().toISOString();
  const status = DECISION_STATUS[body.decision];
  return ctx.db.transaction((tx) => {
    let planVersionId: string | null = null;
    let planItemId: string | null = null;
    if (body.decision === 'accept' || body.decision === 'edit') {
      const hashes = currentHashes(ctx, game, unit);
      const { plan } = ensurePlan(ctx, tx, game, unit, actorUserId, hashes);
      const draft = ensureDraft(ctx, tx, plan, actorUserId, hashes);
      const firstConcept = conceptsById(tx, row.playbookConceptIds)[0];
      const text = body.decision === 'edit' ? body.editedStatement! : row.statement;
      const r = appendItem(ctx, tx, draft, sectionKeyForItem(unit, firstConcept?.kind ?? null), { text, sourceRecommendationId: row.id, conceptIds: row.playbookConceptIds, packageIds: row.personnelPackageIds });
      planVersionId = draft.id;
      planItemId = r.item.id;
    }
    const next: RecommendationRow = {
      ...row, status, staleReason: null, decidedBy: actorUserId, decidedAt: nowIso, editedStatement: body.decision === 'edit' ? body.editedStatement! : row.editedStatement,
      decisionNote: body.note ?? row.decisionNote, planItemId: planItemId ?? row.planItemId, version: row.version + 1,
    };
    tx.update(recommendations)
      .set({ status: next.status, staleReason: null, decidedBy: actorUserId, decidedAt: nowIso, editedStatement: next.editedStatement, decisionNote: next.decisionNote, planItemId: next.planItemId, version: next.version })
      .where(eq(recommendations.id, row.id)).run();
    writeAudit(ctx, {
      teamId: row.teamId, actorUserId, action: 'recommendation.decided', targetType: 'recommendation', targetId: row.id,
      details: { decision: body.decision, unit, gameId: game.id, planVersionId, planItemId, note: body.note ?? null, staleAtDecision: row.inputsHash !== currentHashes(ctx, game, unit).inputsHash },
    });
    return { row: next, planVersionId, planItemId };
  });
}

/** Recommendations of a game and unit as the review flags need them (with stale computed and stored component hashes). */
export function recommendationsForFlags(ctx: AppContext, game: GameRow, unit: Unit, hashes: InputHashes) {
  const rows = listRows(ctx.db, game.id, unit);
  return rows.map((r) => ({ ...serializeRecommendation(r, staleReasonFor(r, hashes)), inputHashes: r.inputHashes }));
}

