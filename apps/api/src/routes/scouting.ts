import { Hono } from 'hono';
import { z } from 'zod';
import { CreateSnapshotRequestSchema, IdSchema, ScoutingQuerySchema, type ScoutingResponse } from '@footballos/contracts';
import type { AppContext } from '../context.js';
import { errors } from '../errors.js';
import { zv } from '../http/validate.js';
import { assert, policy, requireAuth, requireMembership, type AppEnv } from '../http/guards.js';
import { getOpponent } from '../services/schedule.js';
import { computeScouting, createSnapshot, listSnapshots, serializeSnapshot } from '../services/scouting.js';

const param = z.object({ teamId: IdSchema, opponentId: IdSchema });

/** §14.6 computed scouting and snapshots. */
export function scoutingRoutes(ctx: AppContext) {
  return new Hono<AppEnv>()
    .use('*', requireAuth(ctx))
    .get('/teams/:teamId/opponents/:opponentId/scouting', zv('param', param), zv('query', ScoutingQuerySchema), (c) => {
      const { teamId, opponentId } = c.req.valid('param');
      requireMembership(c.var.auth, teamId);
      if (!getOpponent(ctx, teamId, opponentId)) throw errors.notFound('Opponent');
      const r = computeScouting(ctx, teamId, opponentId, c.req.valid('query'));
      const body: ScoutingResponse & { teamId: string; opponentId: string; unit: string; reviewBasis: string; inputsHash: string } = {
        findings: r.findings, games: r.games, sampleSize: r.sampleSize, computedAt: r.computedAt, computeVersion: r.computeVersion,
        teamId: r.teamId, opponentId: r.opponentId, unit: r.unit, reviewBasis: r.reviewBasis, inputsHash: r.inputsHash,
      };
      return c.json(body, 200);
    })
    .get('/teams/:teamId/opponents/:opponentId/scouting/snapshots', zv('param', param), (c) => {
      const { teamId, opponentId } = c.req.valid('param');
      requireMembership(c.var.auth, teamId);
      if (!getOpponent(ctx, teamId, opponentId)) throw errors.notFound('Opponent');
      return c.json({ items: listSnapshots(ctx, teamId, opponentId).map(serializeSnapshot) }, 200);
    })
    .post('/teams/:teamId/opponents/:opponentId/scouting/snapshots', zv('param', param), zv('json', CreateSnapshotRequestSchema), (c) => {
      const { teamId, opponentId } = c.req.valid('param');
      const m = requireMembership(c.var.auth, teamId);
      assert(policy.canUploadOrCorrect(m), 'Viewers cannot save report snapshots');
      if (!getOpponent(ctx, teamId, opponentId)) throw errors.notFound('Opponent');
      return c.json({ snapshot: serializeSnapshot(createSnapshot(ctx, c.var.auth.user.id, teamId, opponentId, c.req.valid('json'))) }, 201);
    });
}
