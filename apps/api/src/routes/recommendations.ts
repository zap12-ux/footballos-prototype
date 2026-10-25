import { Hono } from 'hono';
import { z } from 'zod';
import {
  GenerateRecommendationsRequestSchema, IdSchema, RecommendationDecisionRequestSchema, RecommendationsQuerySchema, type GenerateRecommendationsResponse, type RecommendationDecisionResponse, type Unit,
} from '@footballos/contracts';
import type { AppContext } from '../context.js';
import { errors } from '../errors.js';
import { zv } from '../http/validate.js';
import { assert, policy, requireAuth, requireMembership, type AppEnv } from '../http/guards.js';
import { getGame } from '../services/schedule.js';
import { decide, generate, getRecommendation, listForGame, serializeMany } from '../services/recommendations.js';
import { teamIdsOf } from './media.js';

const gameParam = z.object({ gameId: IdSchema });
const idParam = z.object({ id: IdSchema });

/** §15.3 recommendations: computed, stored, never auto-approved. */
export function recommendationRoutes(ctx: AppContext) {
  const requireGame = (auth: AppEnv['Variables']['auth'], gameId: string) => {
    const game = getGame(ctx, gameId);
    if (!game || !teamIdsOf(auth).includes(game.teamId)) throw errors.notFound('Game');
    return { game, membership: requireMembership(auth, game.teamId) };
  };
  return new Hono<AppEnv>()
    .use('*', requireAuth(ctx))
    .post('/games/:gameId/recommendations/generate', zv('param', gameParam), zv('json', GenerateRecommendationsRequestSchema), (c) => {
      const { game, membership } = requireGame(c.var.auth, c.req.valid('param').gameId);
      const { unit } = c.req.valid('json');
      assert(policy.canDecideForUnit(membership, unit), 'Coordinator of the unit or head coach required');
      const r = generate(ctx, c.var.auth.user.id, game, unit);
      const body: GenerateRecommendationsResponse & { skipped: typeof r.skipped; packages: typeof r.packages } = {
        items: serializeMany(ctx, game, r.rows), blockedReasons: r.blockedReasons, inputsHash: r.inputsHash, supersededIds: r.supersededIds, skipped: r.skipped, packages: r.packages,
      };
      return c.json(body, 201);
    })
    .get('/games/:gameId/recommendations', zv('param', gameParam), zv('query', RecommendationsQuerySchema), (c) => {
      const { game } = requireGame(c.var.auth, c.req.valid('param').gameId);
      return c.json({ items: listForGame(ctx, game, c.req.valid('query').unit) }, 200);
    })
    .get('/recommendations/:id', zv('param', idParam), (c) => {
      const row = getRecommendation(ctx, c.req.valid('param').id);
      if (!row || !teamIdsOf(c.var.auth).includes(row.teamId)) throw errors.notFound('Recommendation');
      const { game } = requireGame(c.var.auth, row.gameId);
      return c.json({ recommendation: serializeMany(ctx, game, [row])[0] }, 200);
    })
    .post('/recommendations/:id/decide', zv('param', idParam), zv('json', RecommendationDecisionRequestSchema), (c) => {
      const row = getRecommendation(ctx, c.req.valid('param').id);
      if (!row || !teamIdsOf(c.var.auth).includes(row.teamId)) throw errors.notFound('Recommendation');
      const { game, membership } = requireGame(c.var.auth, row.gameId);
      assert(policy.canDecideForUnit(membership, row.unit as Unit), 'Coordinator of the unit or head coach required');
      const r = decide(ctx, c.var.auth.user.id, game, row, c.req.valid('json'));
      const body: RecommendationDecisionResponse = { recommendation: serializeMany(ctx, game, [r.row])[0]!, planVersionId: r.planVersionId, planItemId: r.planItemId };
      return c.json(body, 200);
    });
}
