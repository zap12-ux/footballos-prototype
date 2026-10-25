import { and, asc, eq, sql } from 'drizzle-orm';
import type {
  CreateGameRequest, CreateOpponentRequest, CreateSeasonRequest, GameStatus, PatchGameRequest, ScheduleImportApplyRequest,
  ScheduleImportField, SeasonRecord,
} from '@footballos/contracts';
import type { AppContext } from '../context.js';
import { errors } from '../errors.js';
import { gameWorkspaces, opponents, scheduledGames, scheduleImports, seasons } from '../db/schema.js';
import { writeAudit } from './audit.js';
import { previewSchedule } from './schedule-import.js';

export type SeasonRow = typeof seasons.$inferSelect;
export type OpponentRow = typeof opponents.$inferSelect;
export type GameRow = typeof scheduledGames.$inferSelect;
export type ImportRow = typeof scheduleImports.$inferSelect;

// Seasons -------------------------------------------------------------------------------------

export function listSeasons(ctx: AppContext, teamId: string): SeasonRow[] {
  return ctx.db.select().from(seasons).where(eq(seasons.teamId, teamId)).orderBy(asc(seasons.startsOn)).all();
}

export function getSeason(ctx: AppContext, teamId: string, seasonId: string): SeasonRow | undefined {
  return ctx.db.select().from(seasons).where(and(eq(seasons.id, seasonId), eq(seasons.teamId, teamId))).get();
}

export function createSeason(ctx: AppContext, teamId: string, input: CreateSeasonRequest): SeasonRow {
  const row: SeasonRow = { id: crypto.randomUUID(), teamId, label: input.label, startsOn: input.startsOn, endsOn: input.endsOn, isCurrent: input.isCurrent, createdAt: ctx.now().toISOString() };
  ctx.db.transaction((tx) => {
    if (input.isCurrent) tx.update(seasons).set({ isCurrent: false }).where(eq(seasons.teamId, teamId)).run();
    tx.insert(seasons).values(row).run();
  });
  return row;
}

// Opponents -----------------------------------------------------------------------------------

export function listOpponents(ctx: AppContext, teamId: string): OpponentRow[] {
  return ctx.db.select().from(opponents).where(eq(opponents.teamId, teamId)).orderBy(asc(opponents.name)).all();
}

export function getOpponent(ctx: AppContext, teamId: string, opponentId: string): OpponentRow | undefined {
  return ctx.db.select().from(opponents).where(and(eq(opponents.id, opponentId), eq(opponents.teamId, teamId))).get();
}

export function createOpponent(ctx: AppContext, teamId: string, input: CreateOpponentRequest): OpponentRow {
  const row: OpponentRow = {
    id: crypto.randomUUID(), teamId, name: input.name, shortName: input.shortName ?? defaultShortName(input.name), notes: input.notes ?? '', createdAt: ctx.now().toISOString(),
  };
  ctx.db.insert(opponents).values(row).run();
  return row;
}

function defaultShortName(name: string): string {
  const letters = name.replace(/\(.*?\)/g, '').replace(/[^A-Za-z0-9 ]/g, '').trim();
  return (letters.length <= 4 ? letters : letters.slice(0, 3)).toUpperCase() || 'OPP';
}

function findOpponentByName(ctx: AppContext, teamId: string, name: string): OpponentRow | undefined {
  return ctx.db.select().from(opponents).where(and(eq(opponents.teamId, teamId), sql`lower(${opponents.name}) = lower(${name})`)).get();
}

// Games ---------------------------------------------------------------------------------------

export function listGames(ctx: AppContext, teamId: string, seasonId: string): GameRow[] {
  return ctx.db
    .select()
    .from(scheduledGames)
    .where(and(eq(scheduledGames.teamId, teamId), eq(scheduledGames.seasonId, seasonId)))
    .orderBy(sql`${scheduledGames.week} IS NULL`, asc(scheduledGames.week), sql`${scheduledGames.scheduledAt} IS NULL`, asc(scheduledGames.scheduledAt), asc(scheduledGames.createdAt))
    .all();
}

export function getGame(ctx: AppContext, gameId: string): GameRow | undefined {
  return ctx.db.select().from(scheduledGames).where(eq(scheduledGames.id, gameId)).get();
}

export function createGame(ctx: AppContext, teamId: string, seasonId: string, input: CreateGameRequest): GameRow {
  if (input.opponentId && !getOpponent(ctx, teamId, input.opponentId)) throw errors.notFound('Opponent');
  if (input.kind === 'bye' && input.opponentId) throw errors.validation('A bye week has no opponent');
  if (input.kind !== 'bye' && !input.opponentId) throw errors.validation('opponentId is required unless kind is bye');
  const now = ctx.now().toISOString();
  const row: GameRow = {
    id: crypto.randomUUID(), teamId, seasonId, week: input.week, kind: input.kind, opponentId: input.opponentId, location: input.location,
    scheduledAt: input.scheduledAt, status: 'scheduled', result: null, notes: input.notes, version: 1, createdAt: now, updatedAt: now,
  };
  ctx.db.transaction((tx) => {
    tx.insert(scheduledGames).values(row).run();
    tx.insert(gameWorkspaces).values({ id: crypto.randomUUID(), gameId: row.id, teamId }).run();
  });
  return row;
}

/** Allowed status transitions. `final` only accepts result corrections (stays `final`). */
const TRANSITIONS: Record<GameStatus, readonly GameStatus[]> = {
  scheduled: ['rescheduled', 'postponed', 'canceled', 'final'],
  rescheduled: ['rescheduled', 'postponed', 'canceled', 'final'],
  postponed: ['rescheduled', 'canceled', 'final'],
  canceled: ['scheduled', 'rescheduled'],
  final: ['final'],
};

export function patchGame(ctx: AppContext, game: GameRow, patch: PatchGameRequest): GameRow {
  if (patch.expectedVersion !== game.version) {
    throw errors.conflict(`Game version ${patch.expectedVersion} expected, current is ${game.version}`, { currentVersion: game.version });
  }
  const nextStatus = patch.status ?? (game.status as GameStatus);
  if (patch.status && patch.status !== game.status && !TRANSITIONS[game.status as GameStatus].includes(patch.status)) {
    throw errors.conflict(`Cannot change a ${game.status} game to ${patch.status}`, { currentStatus: game.status, allowed: TRANSITIONS[game.status as GameStatus] });
  }
  const nextKind = patch.kind ?? game.kind;
  const nextOpponent = patch.opponentId !== undefined ? patch.opponentId : game.opponentId;
  if (nextOpponent && nextOpponent !== game.opponentId && !getOpponent(ctx, game.teamId, nextOpponent)) throw errors.notFound('Opponent');
  if (nextKind === 'bye' && nextOpponent) throw errors.validation('A bye week has no opponent');
  const nextResult = patch.result !== undefined ? patch.result : game.result ?? null;
  if (nextStatus === 'final' && nextKind !== 'bye' && !nextResult) throw errors.conflict('A final game needs a result', { missing: 'result' });
  if (nextStatus !== 'final' && patch.result) throw errors.conflict('A result can only be entered on a final game', { currentStatus: nextStatus });
  if (nextKind === 'bye' && nextResult) throw errors.validation('A bye week has no result');
  if (game.status === 'final' && patch.result === null) throw errors.conflict('A final game keeps its result; reopen is not supported');
  const now = ctx.now().toISOString();
  const next: GameRow = {
    ...game,
    week: patch.week !== undefined ? patch.week : game.week,
    kind: nextKind,
    opponentId: nextOpponent,
    location: patch.location !== undefined ? patch.location : game.location,
    scheduledAt: patch.scheduledAt !== undefined ? patch.scheduledAt : game.scheduledAt,
    status: nextStatus,
    result: nextStatus === 'final' ? nextResult : null,
    notes: patch.notes ?? game.notes,
    version: game.version + 1,
    updatedAt: now,
  };
  const res = ctx.db
    .update(scheduledGames)
    .set({ week: next.week, kind: next.kind, opponentId: next.opponentId, location: next.location, scheduledAt: next.scheduledAt, status: next.status, result: next.result, notes: next.notes, version: next.version, updatedAt: now })
    .where(and(eq(scheduledGames.id, game.id), eq(scheduledGames.version, game.version)))
    .run();
  if (res.changes !== 1) {
    const current = getGame(ctx, game.id);
    throw errors.conflict(`Game version ${patch.expectedVersion} expected, current is ${current?.version ?? 'unknown'}`, { currentVersion: current?.version ?? null });
  }
  return next;
}

/** Season record from `final` games with a result; bye and canceled games never count. Never stored. */
export function computeSeasonRecord(games: Pick<GameRow, 'status' | 'kind' | 'result'>[]): SeasonRecord {
  const rec: SeasonRecord = { wins: 0, losses: 0, ties: 0, played: 0 };
  for (const g of games) {
    if (g.status !== 'final' || g.kind === 'bye' || !g.result) continue;
    rec.played++;
    if (g.result.outcome === 'win') rec.wins++;
    else if (g.result.outcome === 'loss') rec.losses++;
    else rec.ties++;
  }
  return rec;
}

// Schedule import -------------------------------------------------------------------------------

export function createImportPreview(
  ctx: AppContext,
  actorUserId: string,
  teamId: string,
  seasonId: string,
  timezone: string,
  input: { filename: string; content: string; mapping?: Record<string, ScheduleImportField> },
): ImportRow {
  const preview = previewSchedule(input.content, timezone, input.mapping);
  const row: ImportRow = {
    id: crypto.randomUUID(), teamId, seasonId, filename: input.filename, status: 'previewed', mapping: preview.mapping, rowCount: preview.rowCount,
    rows: preview.rows, errors: preview.errors, createdBy: actorUserId, createdAt: ctx.now().toISOString(),
  };
  ctx.db.insert(scheduleImports).values(row).run();
  return row;
}

export function getImport(ctx: AppContext, importId: string): ImportRow | undefined {
  return ctx.db.select().from(scheduleImports).where(eq(scheduleImports.id, importId)).get();
}

export function applyImport(ctx: AppContext, actorUserId: string, imp: ImportRow, input: ScheduleImportApplyRequest) {
  if (imp.status !== 'previewed') throw errors.conflict(`Import is already ${imp.status}`, { currentStatus: imp.status });
  if (imp.errors.length > 0 && !input.skipInvalidRows) {
    throw errors.conflict(`${imp.errors.length} row(s) have errors; fix the file or apply with skipInvalidRows`, { errorCount: imp.errors.length });
  }
  const createdGameIds: string[] = [];
  const createdOpponentIds: string[] = [];
  const skippedRows = Array.from(new Set(imp.errors.map((e) => e.row))).filter((r) => r > 0).sort((a, b) => a - b);
  ctx.db.transaction(() => {
    for (const r of imp.rows) {
      let opponentId: string | null = null;
      if (r.kind !== 'bye' && r.opponentName) {
        let opp = findOpponentByName(ctx, imp.teamId, r.opponentName);
        if (!opp) { opp = createOpponent(ctx, imp.teamId, { name: r.opponentName, notes: '' }); createdOpponentIds.push(opp.id); }
        opponentId = opp.id;
      }
      const game = createGame(ctx, imp.teamId, imp.seasonId, { week: r.week, kind: r.kind, opponentId, location: r.location, scheduledAt: r.scheduledAt, notes: r.notes });
      createdGameIds.push(game.id);
    }
    ctx.db.update(scheduleImports).set({ status: 'applied' }).where(eq(scheduleImports.id, imp.id)).run();
    writeAudit(ctx, {
      teamId: imp.teamId, actorUserId, action: 'schedule_import.applied', targetType: 'schedule_import', targetId: imp.id,
      details: { filename: imp.filename, games: createdGameIds.length, opponents: createdOpponentIds.length, skippedRows },
    });
  });
  return { import: { ...imp, status: 'applied' as const }, createdGameIds, createdOpponentIds, skippedRows };
}

export function discardImport(ctx: AppContext, imp: ImportRow): ImportRow {
  if (imp.status !== 'previewed') throw errors.conflict(`Import is already ${imp.status}`, { currentStatus: imp.status });
  ctx.db.update(scheduleImports).set({ status: 'discarded' }).where(eq(scheduleImports.id, imp.id)).run();
  return { ...imp, status: 'discarded' };
}
