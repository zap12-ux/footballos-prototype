import { and, asc, eq, ne, sql } from 'drizzle-orm';
import type {
  CreatePackageRequest, CreatePlayerRequest, DepthChart, PatchPackageRequest, PatchPlayerRequest, PersonnelPackage, Player, PlayerStatus, PutDepthChartRequest,
  RosterImport, RosterImportApplyRequest, RosterImportField, Unit,
} from '@footballos/contracts';
import type { AppContext } from '../context.js';
import type { Db } from '../db/db.js';
import { depthCharts, personnelPackages, players, rosterImports, seasons } from '../db/schema.js';
import { errors } from '../errors.js';
import { writeAudit } from './audit.js';
import { previewRoster } from './roster-import.js';

export type PlayerRow = typeof players.$inferSelect;
export type DepthChartRow = typeof depthCharts.$inferSelect;
export type PackageRow = typeof personnelPackages.$inferSelect;
export type RosterImportRow = typeof rosterImports.$inferSelect;

export const serializePlayer = (p: PlayerRow): Player => ({
  id: p.id, teamId: p.teamId, seasonId: p.seasonId, jersey: p.jersey, firstName: p.firstName, lastName: p.lastName, positions: p.positions, classYear: p.classYear,
  status: p.status as PlayerStatus, strengths: p.strengths, developmentPriorities: p.developmentPriorities, notes: p.notes, availability: p.availability, version: p.version,
  createdAt: p.createdAt, updatedAt: p.updatedAt,
});

export const serializeDepthChart = (d: DepthChartRow): DepthChart => ({ id: d.id, teamId: d.teamId, seasonId: d.seasonId, unit: d.unit as Unit, slots: d.slots, version: d.version, updatedAt: d.updatedAt });

export const serializePackage = (p: PackageRow): PersonnelPackage => ({
  id: p.id, teamId: p.teamId, seasonId: p.seasonId, unit: p.unit as Unit, name: p.name, playerIds: p.playerIds, description: p.description, version: p.version, createdAt: p.createdAt, updatedAt: p.updatedAt,
});

export const serializeRosterImport = (i: RosterImportRow): RosterImport => ({
  id: i.id, teamId: i.teamId, seasonId: i.seasonId, filename: i.filename, status: i.status as RosterImport['status'], mapping: i.mapping, rowCount: i.rowCount, rows: i.rows, errors: i.errors, createdAt: i.createdAt,
});

function requireSeason(db: Db, teamId: string, seasonId: string): void {
  if (!db.select({ id: seasons.id }).from(seasons).where(and(eq(seasons.id, seasonId), eq(seasons.teamId, teamId))).get()) throw errors.notFound('Season');
}

// Players ----------------------------------------------------------------------------------------

export function listPlayers(db: Db, teamId: string, seasonId: string, status?: PlayerStatus | 'all'): PlayerRow[] {
  const conds = [eq(players.teamId, teamId), eq(players.seasonId, seasonId)];
  if (status && status !== 'all') conds.push(eq(players.status, status));
  else if (!status) conds.push(ne(players.status, 'inactive'));
  return db.select().from(players).where(and(...conds)).orderBy(sql`CAST(${players.jersey} AS INTEGER)`, asc(players.lastName), asc(players.firstName)).all();
}

export function getPlayer(ctx: AppContext, id: string): PlayerRow | undefined {
  return ctx.db.select().from(players).where(eq(players.id, id)).get();
}

export function requirePlayer(ctx: AppContext, id: string, teamIds: string[]): PlayerRow {
  const p = getPlayer(ctx, id);
  if (!p || !teamIds.includes(p.teamId)) throw errors.notFound('Player');
  return p;
}

function normalizeAvailability(list: Player['availability']): Player['availability'] {
  const byWeek = new Map<number, Player['availability'][number]>();
  for (const a of list) byWeek.set(a.week, a);
  return [...byWeek.values()].sort((a, b) => a.week - b.week);
}

export function createPlayer(ctx: AppContext, actorUserId: string, teamId: string, seasonId: string, input: CreatePlayerRequest): PlayerRow {
  requireSeason(ctx.db, teamId, seasonId);
  const nowIso = ctx.now().toISOString();
  const row: PlayerRow = {
    id: crypto.randomUUID(), teamId, seasonId, jersey: input.jersey, firstName: input.firstName, lastName: input.lastName, positions: input.positions, classYear: input.classYear,
    status: input.status, strengths: input.strengths, developmentPriorities: input.developmentPriorities, notes: input.notes, availability: normalizeAvailability(input.availability),
    version: 1, createdAt: nowIso, updatedAt: nowIso,
  };
  ctx.db.insert(players).values(row).run();
  writeAudit(ctx, { teamId, actorUserId, action: 'roster.edited', targetType: 'player', targetId: row.id, details: { change: 'created', jersey: row.jersey, lastName: row.lastName } });
  return row;
}

export function patchPlayer(ctx: AppContext, actorUserId: string, row: PlayerRow, patch: PatchPlayerRequest): PlayerRow {
  if (patch.expectedVersion !== row.version) throw errors.conflict(`Player version ${patch.expectedVersion} expected, current is ${row.version}`, { currentVersion: row.version });
  const nowIso = ctx.now().toISOString();
  const next: PlayerRow = {
    ...row,
    jersey: patch.jersey !== undefined ? patch.jersey : row.jersey, firstName: patch.firstName ?? row.firstName, lastName: patch.lastName ?? row.lastName,
    positions: patch.positions ?? row.positions, classYear: patch.classYear ?? row.classYear, status: patch.status ?? row.status, strengths: patch.strengths ?? row.strengths,
    developmentPriorities: patch.developmentPriorities ?? row.developmentPriorities, notes: patch.notes ?? row.notes,
    availability: patch.availability ? normalizeAvailability(patch.availability) : row.availability, version: row.version + 1, updatedAt: nowIso,
  };
  const res = ctx.db.update(players).set({ ...next }).where(and(eq(players.id, row.id), eq(players.version, row.version))).run();
  if (res.changes !== 1) throw errors.conflict('Player changed concurrently', { currentVersion: getPlayer(ctx, row.id)?.version ?? null });
  writeAudit(ctx, { teamId: row.teamId, actorUserId, action: 'roster.edited', targetType: 'player', targetId: row.id, details: { change: 'patched', fields: Object.keys(patch).filter((k) => k !== 'expectedVersion') } });
  return next;
}

/** Soft delete: the player becomes `inactive` and leaves lists by default; depth charts and packages keep their ids for audit. */
export function deletePlayer(ctx: AppContext, actorUserId: string, row: PlayerRow): PlayerRow {
  const nowIso = ctx.now().toISOString();
  const next: PlayerRow = { ...row, status: 'inactive', version: row.version + 1, updatedAt: nowIso };
  ctx.db.update(players).set({ status: 'inactive', version: next.version, updatedAt: nowIso }).where(eq(players.id, row.id)).run();
  writeAudit(ctx, { teamId: row.teamId, actorUserId, action: 'player.deleted', targetType: 'player', targetId: row.id, details: { jersey: row.jersey, lastName: row.lastName, previousStatus: row.status } });
  return next;
}

// Roster import ------------------------------------------------------------------------------------

export function createRosterPreview(ctx: AppContext, actorUserId: string, teamId: string, seasonId: string, input: { filename: string; content: string; mapping?: Record<string, RosterImportField> }): RosterImportRow {
  requireSeason(ctx.db, teamId, seasonId);
  const preview = previewRoster(input.content, input.mapping);
  const existing = listPlayers(ctx.db, teamId, seasonId, 'all');
  const rows = preview.rows.map((r) => {
    const match = existing.find((p) => p.jersey !== null && r.jersey !== null && p.jersey === r.jersey && p.lastName.toLowerCase() === r.lastName.toLowerCase());
    return { ...r, matchesPlayerId: match?.id ?? null };
  });
  const row: RosterImportRow = {
    id: crypto.randomUUID(), teamId, seasonId, filename: input.filename, status: 'previewed', mapping: preview.mapping, rowCount: preview.rowCount, rows, errors: preview.errors,
    createdBy: actorUserId, createdAt: ctx.now().toISOString(),
  };
  ctx.db.insert(rosterImports).values(row).run();
  return row;
}

export function getRosterImport(ctx: AppContext, id: string): RosterImportRow | undefined {
  return ctx.db.select().from(rosterImports).where(eq(rosterImports.id, id)).get();
}

export function applyRosterImport(ctx: AppContext, actorUserId: string, imp: RosterImportRow, input: RosterImportApplyRequest) {
  if (imp.status !== 'previewed') throw errors.conflict(`Import is already ${imp.status}`, { currentStatus: imp.status });
  if (imp.errors.length > 0 && !input.skipInvalidRows) {
    throw errors.conflict(`${imp.errors.length} row(s) have errors; fix the file or apply with skipInvalidRows`, { errorCount: imp.errors.length });
  }
  const createdPlayerIds: string[] = [];
  const updatedPlayerIds: string[] = [];
  const skippedRows = Array.from(new Set(imp.errors.map((e) => e.row))).filter((r) => r > 0).sort((a, b) => a - b);
  const nowIso = ctx.now().toISOString();
  ctx.db.transaction((tx) => {
    for (const r of imp.rows) {
      const match = r.matchesPlayerId ? tx.select().from(players).where(eq(players.id, r.matchesPlayerId)).get() : undefined;
      if (match) {
        tx.update(players)
          .set({ firstName: r.firstName, positions: r.positions.length ? r.positions : match.positions, classYear: r.classYear || match.classYear, status: r.status, notes: r.notes || match.notes, version: match.version + 1, updatedAt: nowIso })
          .where(eq(players.id, match.id)).run();
        updatedPlayerIds.push(match.id);
      } else {
        const row: PlayerRow = {
          id: crypto.randomUUID(), teamId: imp.teamId, seasonId: imp.seasonId, jersey: r.jersey, firstName: r.firstName, lastName: r.lastName, positions: r.positions, classYear: r.classYear,
          status: r.status, strengths: [], developmentPriorities: [], notes: r.notes, availability: [], version: 1, createdAt: nowIso, updatedAt: nowIso,
        };
        tx.insert(players).values(row).run();
        createdPlayerIds.push(row.id);
      }
    }
    tx.update(rosterImports).set({ status: 'applied' }).where(eq(rosterImports.id, imp.id)).run();
    writeAudit(ctx, {
      teamId: imp.teamId, actorUserId, action: 'roster_import.applied', targetType: 'roster_import', targetId: imp.id,
      details: { filename: imp.filename, created: createdPlayerIds.length, updated: updatedPlayerIds.length, skippedRows },
    });
  });
  return { import: { ...imp, status: 'applied' as const }, createdPlayerIds, updatedPlayerIds, skippedRows };
}

export function discardRosterImport(ctx: AppContext, imp: RosterImportRow): RosterImportRow {
  if (imp.status !== 'previewed') throw errors.conflict(`Import is already ${imp.status}`, { currentStatus: imp.status });
  ctx.db.update(rosterImports).set({ status: 'discarded' }).where(eq(rosterImports.id, imp.id)).run();
  return { ...imp, status: 'discarded' };
}

// Depth chart ---------------------------------------------------------------------------------------

export function getDepthChart(db: Db, teamId: string, seasonId: string, unit: Unit): DepthChartRow | undefined {
  return db.select().from(depthCharts).where(and(eq(depthCharts.teamId, teamId), eq(depthCharts.seasonId, seasonId), eq(depthCharts.unit, unit))).get();
}

function assertPlayersOnRoster(db: Db, teamId: string, seasonId: string, ids: string[]): void {
  const roster = new Set(listPlayers(db, teamId, seasonId, 'all').map((p) => p.id));
  const missing = ids.filter((id) => !roster.has(id));
  if (missing.length) throw errors.notFound(`Player ${missing[0]}`);
}

export function putDepthChart(ctx: AppContext, actorUserId: string, teamId: string, seasonId: string, unit: Unit, body: PutDepthChartRequest): DepthChartRow {
  requireSeason(ctx.db, teamId, seasonId);
  const seen = new Set<string>();
  for (const s of body.slots) {
    const key = `${s.position}:${s.order}`;
    if (seen.has(key)) throw errors.validation(`Duplicate slot ${s.position} #${s.order}`);
    seen.add(key);
  }
  assertPlayersOnRoster(ctx.db, teamId, seasonId, body.slots.map((s) => s.playerId));
  const nowIso = ctx.now().toISOString();
  const existing = getDepthChart(ctx.db, teamId, seasonId, unit);
  let row: DepthChartRow;
  if (!existing) {
    if (body.expectedVersion !== undefined) throw errors.conflict('No depth chart exists yet; omit expectedVersion on the first write', { currentVersion: null });
    row = { id: crypto.randomUUID(), teamId, seasonId, unit, slots: body.slots, version: 1, updatedBy: actorUserId, updatedAt: nowIso };
    ctx.db.insert(depthCharts).values(row).run();
  } else {
    if (body.expectedVersion === undefined || body.expectedVersion !== existing.version) {
      throw errors.conflict(`Depth chart version ${body.expectedVersion ?? 'missing'} expected, current is ${existing.version}`, { currentVersion: existing.version, current: serializeDepthChart(existing) });
    }
    row = { ...existing, slots: body.slots, version: existing.version + 1, updatedBy: actorUserId, updatedAt: nowIso };
    const res = ctx.db.update(depthCharts).set({ slots: row.slots, version: row.version, updatedBy: actorUserId, updatedAt: nowIso }).where(and(eq(depthCharts.id, existing.id), eq(depthCharts.version, existing.version))).run();
    if (res.changes !== 1) throw errors.conflict('Depth chart changed concurrently', { currentVersion: getDepthChart(ctx.db, teamId, seasonId, unit)?.version ?? null });
  }
  writeAudit(ctx, { teamId, actorUserId, action: 'depth_chart.updated', targetType: 'depth_chart', targetId: row.id, details: { unit, slots: row.slots.length, version: row.version } });
  return row;
}

// Packages -------------------------------------------------------------------------------------------

export function listPackages(db: Db, teamId: string, seasonId: string, unit?: Unit): PackageRow[] {
  const conds = [eq(personnelPackages.teamId, teamId), eq(personnelPackages.seasonId, seasonId)];
  if (unit) conds.push(eq(personnelPackages.unit, unit));
  return db.select().from(personnelPackages).where(and(...conds)).orderBy(asc(personnelPackages.unit), asc(personnelPackages.name)).all();
}

export function getPackage(ctx: AppContext, id: string): PackageRow | undefined {
  return ctx.db.select().from(personnelPackages).where(eq(personnelPackages.id, id)).get();
}

export function createPackage(ctx: AppContext, actorUserId: string, teamId: string, seasonId: string, input: CreatePackageRequest): PackageRow {
  requireSeason(ctx.db, teamId, seasonId);
  assertPlayersOnRoster(ctx.db, teamId, seasonId, input.playerIds);
  const nowIso = ctx.now().toISOString();
  const row: PackageRow = { id: crypto.randomUUID(), teamId, seasonId, unit: input.unit, name: input.name, playerIds: [...new Set(input.playerIds)], description: input.description, version: 1, createdAt: nowIso, updatedAt: nowIso };
  ctx.db.insert(personnelPackages).values(row).run();
  writeAudit(ctx, { teamId, actorUserId, action: 'package.changed', targetType: 'personnel_package', targetId: row.id, details: { change: 'created', unit: row.unit, name: row.name, players: row.playerIds.length } });
  return row;
}

export function patchPackage(ctx: AppContext, actorUserId: string, row: PackageRow, patch: PatchPackageRequest): PackageRow {
  if (patch.expectedVersion !== row.version) throw errors.conflict(`Package version ${patch.expectedVersion} expected, current is ${row.version}`, { currentVersion: row.version });
  if (patch.playerIds) assertPlayersOnRoster(ctx.db, row.teamId, row.seasonId, patch.playerIds);
  const nowIso = ctx.now().toISOString();
  const next: PackageRow = { ...row, name: patch.name ?? row.name, playerIds: patch.playerIds ? [...new Set(patch.playerIds)] : row.playerIds, description: patch.description ?? row.description, version: row.version + 1, updatedAt: nowIso };
  const res = ctx.db.update(personnelPackages).set({ ...next }).where(and(eq(personnelPackages.id, row.id), eq(personnelPackages.version, row.version))).run();
  if (res.changes !== 1) throw errors.conflict('Package changed concurrently', { currentVersion: getPackage(ctx, row.id)?.version ?? null });
  writeAudit(ctx, { teamId: row.teamId, actorUserId, action: 'package.changed', targetType: 'personnel_package', targetId: row.id, details: { change: 'patched', fields: Object.keys(patch).filter((k) => k !== 'expectedVersion') } });
  return next;
}

/** Package availability for a game week (§15.2): a package with a player `out` (or off the roster) is unavailable. */
export function packageAvailability(pkgs: PackageRow[], roster: PlayerRow[], week: number | null): { packageId: string; available: boolean; reason: string | null }[] {
  const byId = new Map(roster.map((p) => [p.id, p]));
  return pkgs.map((pkg) => {
    const reasons: string[] = [];
    for (const id of pkg.playerIds) {
      const p = byId.get(id);
      if (!p || p.status === 'inactive') { reasons.push(`${p ? `#${p.jersey ?? '?'} ${p.lastName}` : 'a player'} is no longer on the roster`); continue; }
      if (p.status === 'unavailable') { reasons.push(`#${p.jersey ?? '?'} ${p.lastName} is unavailable`); continue; }
      const a = week === null ? undefined : p.availability.find((x) => x.week === week);
      if (a?.status === 'out') reasons.push(`#${p.jersey ?? '?'} ${p.lastName} is out for week ${week}${a.note ? ` (${a.note})` : ''}`);
    }
    return { packageId: pkg.id, available: reasons.length === 0, reason: reasons.length ? reasons.join('; ') : null };
  });
}
