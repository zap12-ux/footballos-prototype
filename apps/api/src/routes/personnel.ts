import { Hono } from 'hono';
import { z } from 'zod';
import {
  CreatePackageRequestSchema, CreatePlayerRequestSchema, IdSchema, PatchPackageRequestSchema, PatchPlayerRequestSchema, PlayersQuerySchema,
  PutDepthChartRequestSchema, RosterImportApplyRequestSchema, RosterImportPreviewRequestSchema, UnitQuerySchema,
} from '@footballos/contracts';
import type { AppContext } from '../context.js';
import { errors } from '../errors.js';
import { zv } from '../http/validate.js';
import { assert, policy, requireAuth, requireMembership, type AppEnv } from '../http/guards.js';
import { getSeason } from '../services/schedule.js';
import { teamIdsOf } from './media.js';
import {
  applyRosterImport, createPackage, createPlayer, createRosterPreview, deletePlayer, discardRosterImport, getDepthChart, getPackage, getRosterImport, listPackages, listPlayers,
  packageAvailability, patchPackage, patchPlayer, putDepthChart, requirePlayer, serializeDepthChart, serializePackage, serializePlayer, serializeRosterImport,
} from '../services/personnel.js';

const seasonParam = z.object({ teamId: IdSchema, seasonId: IdSchema });
const idParam = z.object({ id: IdSchema });
const weekQuery = z.object({ unit: z.enum(['offense', 'defense', 'special_teams']).optional(), week: z.coerce.number().int().min(0).max(52).optional() });

/** §15.2 personnel: players, roster import, depth chart, packages, availability. */
export function personnelRoutes(ctx: AppContext) {
  const requireSeasonFor = (c: { var: AppEnv['Variables'] }, teamId: string, seasonId: string) => {
    const m = requireMembership(c.var.auth, teamId);
    if (!getSeason(ctx, teamId, seasonId)) throw errors.notFound('Season');
    return m;
  };
  return new Hono<AppEnv>()
    .use('*', requireAuth(ctx))
    .get('/teams/:teamId/seasons/:seasonId/players', zv('param', seasonParam), zv('query', PlayersQuerySchema), (c) => {
      const { teamId, seasonId } = c.req.valid('param');
      requireSeasonFor(c, teamId, seasonId);
      return c.json({ items: listPlayers(ctx.db, teamId, seasonId, c.req.valid('query').status).map(serializePlayer) }, 200);
    })
    .post('/teams/:teamId/seasons/:seasonId/players', zv('param', seasonParam), zv('json', CreatePlayerRequestSchema), (c) => {
      const { teamId, seasonId } = c.req.valid('param');
      const m = requireSeasonFor(c, teamId, seasonId);
      assert(policy.canEditPersonnel(m), 'Head coach or coordinator required');
      return c.json({ player: serializePlayer(createPlayer(ctx, c.var.auth.user.id, teamId, seasonId, c.req.valid('json'))) }, 201);
    })
    .get('/players/:id', zv('param', idParam), (c) => {
      const p = requirePlayer(ctx, c.req.valid('param').id, teamIdsOf(c.var.auth));
      requireMembership(c.var.auth, p.teamId);
      return c.json({ player: serializePlayer(p) }, 200);
    })
    .patch('/players/:id', zv('param', idParam), zv('json', PatchPlayerRequestSchema), (c) => {
      const p = requirePlayer(ctx, c.req.valid('param').id, teamIdsOf(c.var.auth));
      const m = requireMembership(c.var.auth, p.teamId);
      assert(policy.canEditPersonnel(m), 'Head coach or coordinator required');
      return c.json({ player: serializePlayer(patchPlayer(ctx, c.var.auth.user.id, p, c.req.valid('json'))) }, 200);
    })
    .delete('/players/:id', zv('param', idParam), (c) => {
      const p = requirePlayer(ctx, c.req.valid('param').id, teamIdsOf(c.var.auth));
      const m = requireMembership(c.var.auth, p.teamId);
      assert(policy.canManageTeam(m), 'Only the head coach removes players');
      return c.json({ player: serializePlayer(p.status === 'inactive' ? p : deletePlayer(ctx, c.var.auth.user.id, p)) }, 200);
    })
    // Roster import ----------------------------------------------------------------------------------
    .post('/teams/:teamId/seasons/:seasonId/roster-imports', zv('param', seasonParam), zv('json', RosterImportPreviewRequestSchema), (c) => {
      const { teamId, seasonId } = c.req.valid('param');
      const m = requireSeasonFor(c, teamId, seasonId);
      assert(policy.canEditPersonnel(m), 'Head coach or coordinator required');
      const body = c.req.valid('json');
      if (/\.xlsx?$/i.test(body.filename)) throw errors.validation('Excel files are not accepted yet; export the sheet as CSV', { accepted: ['csv'] });
      return c.json(serializeRosterImport(createRosterPreview(ctx, c.var.auth.user.id, teamId, seasonId, body)), 201);
    })
    .get('/roster-imports/:id', zv('param', idParam), (c) => {
      const imp = getRosterImport(ctx, c.req.valid('param').id);
      if (!imp || !teamIdsOf(c.var.auth).includes(imp.teamId)) throw errors.notFound('Roster import');
      requireMembership(c.var.auth, imp.teamId);
      return c.json(serializeRosterImport(imp), 200);
    })
    .post('/roster-imports/:id/apply', zv('param', idParam), zv('json', RosterImportApplyRequestSchema.optional().default({ skipInvalidRows: false })), (c) => {
      const imp = getRosterImport(ctx, c.req.valid('param').id);
      if (!imp || !teamIdsOf(c.var.auth).includes(imp.teamId)) throw errors.notFound('Roster import');
      const m = requireMembership(c.var.auth, imp.teamId);
      assert(policy.canEditPersonnel(m), 'Head coach or coordinator required');
      const r = applyRosterImport(ctx, c.var.auth.user.id, imp, c.req.valid('json'));
      return c.json({ ...r, import: serializeRosterImport(r.import) }, 200);
    })
    .post('/roster-imports/:id/discard', zv('param', idParam), (c) => {
      const imp = getRosterImport(ctx, c.req.valid('param').id);
      if (!imp || !teamIdsOf(c.var.auth).includes(imp.teamId)) throw errors.notFound('Roster import');
      const m = requireMembership(c.var.auth, imp.teamId);
      assert(policy.canEditPersonnel(m), 'Head coach or coordinator required');
      return c.json(serializeRosterImport(discardRosterImport(ctx, imp)), 200);
    })
    // Depth chart ------------------------------------------------------------------------------------
    .get('/teams/:teamId/seasons/:seasonId/depth-chart', zv('param', seasonParam), zv('query', UnitQuerySchema), (c) => {
      const { teamId, seasonId } = c.req.valid('param');
      requireSeasonFor(c, teamId, seasonId);
      const d = getDepthChart(ctx.db, teamId, seasonId, c.req.valid('query').unit);
      return c.json({ depthChart: d ? serializeDepthChart(d) : null }, 200);
    })
    .put('/teams/:teamId/seasons/:seasonId/depth-chart', zv('param', seasonParam), zv('query', UnitQuerySchema), zv('json', PutDepthChartRequestSchema), (c) => {
      const { teamId, seasonId } = c.req.valid('param');
      const m = requireSeasonFor(c, teamId, seasonId);
      assert(policy.canEditPersonnel(m), 'Head coach or coordinator required');
      return c.json({ depthChart: serializeDepthChart(putDepthChart(ctx, c.var.auth.user.id, teamId, seasonId, c.req.valid('query').unit, c.req.valid('json'))) }, 200);
    })
    // Packages ---------------------------------------------------------------------------------------
    .get('/teams/:teamId/seasons/:seasonId/packages', zv('param', seasonParam), zv('query', weekQuery), (c) => {
      const { teamId, seasonId } = c.req.valid('param');
      requireSeasonFor(c, teamId, seasonId);
      const q = c.req.valid('query');
      const pkgs = listPackages(ctx.db, teamId, seasonId, q.unit);
      const roster = listPlayers(ctx.db, teamId, seasonId, 'all');
      const availability = packageAvailability(pkgs, roster, q.week ?? null);
      return c.json({ items: pkgs.map(serializePackage), availability, week: q.week ?? null }, 200);
    })
    .post('/teams/:teamId/seasons/:seasonId/packages', zv('param', seasonParam), zv('json', CreatePackageRequestSchema), (c) => {
      const { teamId, seasonId } = c.req.valid('param');
      const m = requireSeasonFor(c, teamId, seasonId);
      assert(policy.canEditPersonnel(m), 'Head coach or coordinator required');
      return c.json({ package: serializePackage(createPackage(ctx, c.var.auth.user.id, teamId, seasonId, c.req.valid('json'))) }, 201);
    })
    .patch('/packages/:id', zv('param', idParam), zv('json', PatchPackageRequestSchema), (c) => {
      const pkg = getPackage(ctx, c.req.valid('param').id);
      if (!pkg || !teamIdsOf(c.var.auth).includes(pkg.teamId)) throw errors.notFound('Package');
      const m = requireMembership(c.var.auth, pkg.teamId);
      assert(policy.canEditPersonnel(m), 'Head coach or coordinator required');
      return c.json({ package: serializePackage(patchPackage(ctx, c.var.auth.user.id, pkg, c.req.valid('json'))) }, 200);
    });
}

