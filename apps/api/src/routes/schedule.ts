import { Hono } from 'hono';
import { z } from 'zod';
import {
  CreateGameRequestSchema, CreateOpponentRequestSchema, CreateSeasonRequestSchema, IdSchema, PatchGameRequestSchema,
  ScheduleImportApplyRequestSchema, ScheduleImportPreviewRequestSchema,
} from '@footballos/contracts';
import type { AppContext } from '../context.js';
import { errors } from '../errors.js';
import { zv } from '../http/validate.js';
import { assert, policy, requireAuth, requireMembership, type AppEnv } from '../http/guards.js';
import { serialize } from '../services/serialize.js';
import { getTeam } from '../services/teams.js';
import {
  applyImport, computeSeasonRecord, createGame, createImportPreview, createOpponent, createSeason, discardImport, getGame, getImport, getSeason,
  listGames, listOpponents, listSeasons, patchGame,
} from '../services/schedule.js';

const teamParam = z.object({ teamId: IdSchema });
const seasonParam = teamParam.extend({ seasonId: IdSchema });

export function scheduleRoutes(ctx: AppContext) {
  return new Hono<AppEnv>()
    .use('*', requireAuth(ctx))
    .get('/teams/:teamId/seasons', zv('param', teamParam), (c) => {
      const { teamId } = c.req.valid('param');
      requireMembership(c.var.auth, teamId);
      const items = listSeasons(ctx, teamId).map((s) => ({ ...serialize.season(s), record: computeSeasonRecord(listGames(ctx, teamId, s.id)) }));
      return c.json({ items, nextCursor: null }, 200);
    })
    .post('/teams/:teamId/seasons', zv('param', teamParam), zv('json', CreateSeasonRequestSchema), (c) => {
      const { teamId } = c.req.valid('param');
      const m = requireMembership(c.var.auth, teamId);
      assert(policy.canManageSchedule(m), 'Head coach or coordinator required');
      const season = createSeason(ctx, teamId, c.req.valid('json'));
      return c.json({ ...serialize.season(season), record: computeSeasonRecord([]) }, 201);
    })
    .get('/teams/:teamId/opponents', zv('param', teamParam), (c) => {
      const { teamId } = c.req.valid('param');
      requireMembership(c.var.auth, teamId);
      return c.json({ items: listOpponents(ctx, teamId).map(serialize.opponent), nextCursor: null }, 200);
    })
    .post('/teams/:teamId/opponents', zv('param', teamParam), zv('json', CreateOpponentRequestSchema), (c) => {
      const { teamId } = c.req.valid('param');
      const m = requireMembership(c.var.auth, teamId);
      assert(policy.canManageSchedule(m), 'Head coach or coordinator required');
      return c.json(serialize.opponent(createOpponent(ctx, teamId, c.req.valid('json'))), 201);
    })
    .get('/teams/:teamId/seasons/:seasonId/games', zv('param', seasonParam), (c) => {
      const { teamId, seasonId } = c.req.valid('param');
      requireMembership(c.var.auth, teamId);
      if (!getSeason(ctx, teamId, seasonId)) throw errors.notFound('Season');
      const games = listGames(ctx, teamId, seasonId);
      return c.json({ items: games.map(serialize.game), nextCursor: null, record: computeSeasonRecord(games) }, 200);
    })
    .post('/teams/:teamId/seasons/:seasonId/games', zv('param', seasonParam), zv('json', CreateGameRequestSchema), (c) => {
      const { teamId, seasonId } = c.req.valid('param');
      const m = requireMembership(c.var.auth, teamId);
      assert(policy.canManageSchedule(m), 'Head coach or coordinator required');
      if (!getSeason(ctx, teamId, seasonId)) throw errors.notFound('Season');
      return c.json(serialize.game(createGame(ctx, teamId, seasonId, c.req.valid('json'))), 201);
    })
    .get('/games/:gameId', zv('param', z.object({ gameId: IdSchema })), (c) => {
      const game = getGame(ctx, c.req.valid('param').gameId);
      if (!game) throw errors.notFound('Game');
      requireMembership(c.var.auth, game.teamId);
      return c.json(serialize.game(game), 200);
    })
    .patch('/games/:gameId', zv('param', z.object({ gameId: IdSchema })), zv('json', PatchGameRequestSchema), (c) => {
      const game = getGame(ctx, c.req.valid('param').gameId);
      if (!game) throw errors.notFound('Game');
      const m = requireMembership(c.var.auth, game.teamId);
      assert(policy.canManageSchedule(m), 'Head coach or coordinator required');
      return c.json(serialize.game(patchGame(ctx, game, c.req.valid('json'))), 200);
    })
    .post('/teams/:teamId/schedule-imports', zv('param', teamParam), zv('json', ScheduleImportPreviewRequestSchema), (c) => {
      const { teamId } = c.req.valid('param');
      const m = requireMembership(c.var.auth, teamId);
      assert(policy.canManageSchedule(m), 'Head coach or coordinator required');
      const body = c.req.valid('json');
      if (!getSeason(ctx, teamId, body.seasonId)) throw errors.notFound('Season');
      if (/\.xlsx?$/i.test(body.filename)) throw errors.validation('Excel files are not accepted yet; export the sheet as CSV', { accepted: ['csv'] });
      const team = getTeam(ctx, teamId);
      if (!team) throw errors.notFound('Team');
      const imp = createImportPreview(ctx, c.var.auth.user.id, teamId, body.seasonId, team.timezone, body);
      return c.json(serialize.scheduleImport(imp), 201);
    })
    .get('/schedule-imports/:id', zv('param', z.object({ id: IdSchema })), (c) => {
      const imp = getImport(ctx, c.req.valid('param').id);
      if (!imp) throw errors.notFound('Schedule import');
      requireMembership(c.var.auth, imp.teamId);
      return c.json(serialize.scheduleImport(imp), 200);
    })
    .post('/schedule-imports/:id/apply', zv('param', z.object({ id: IdSchema })), zv('json', ScheduleImportApplyRequestSchema), (c) => {
      const imp = getImport(ctx, c.req.valid('param').id);
      if (!imp) throw errors.notFound('Schedule import');
      const m = requireMembership(c.var.auth, imp.teamId);
      assert(policy.canManageSchedule(m), 'Head coach or coordinator required');
      const result = applyImport(ctx, c.var.auth.user.id, imp, c.req.valid('json'));
      return c.json({ ...result, import: serialize.scheduleImport(result.import) }, 200);
    })
    .post('/schedule-imports/:id/discard', zv('param', z.object({ id: IdSchema })), (c) => {
      const imp = getImport(ctx, c.req.valid('param').id);
      if (!imp) throw errors.notFound('Schedule import');
      const m = requireMembership(c.var.auth, imp.teamId);
      assert(policy.canManageSchedule(m), 'Head coach or coordinator required');
      return c.json(serialize.scheduleImport(discardImport(ctx, imp)), 200);
    });
}
