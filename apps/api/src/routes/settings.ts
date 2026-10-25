import { Hono } from 'hono';
import { z } from 'zod';
import { IdSchema, PatchTeamSettingsRequestSchema } from '@footballos/contracts';
import type { AppContext } from '../context.js';
import { zv } from '../http/validate.js';
import { assert, policy, requireAuth, requireMembership, type AppEnv } from '../http/guards.js';
import { getSettings, patchSettings } from '../services/settings.js';

const teamParam = z.object({ teamId: IdSchema });

/** §14.7 team settings. */
export function settingsRoutes(ctx: AppContext) {
  return new Hono<AppEnv>()
    .use('*', requireAuth(ctx))
    .get('/teams/:teamId/settings', zv('param', teamParam), (c) => {
      const { teamId } = c.req.valid('param');
      requireMembership(c.var.auth, teamId);
      return c.json({ settings: getSettings(ctx, teamId) }, 200);
    })
    .patch('/teams/:teamId/settings', zv('param', teamParam), zv('json', PatchTeamSettingsRequestSchema), (c) => {
      const { teamId } = c.req.valid('param');
      const m = requireMembership(c.var.auth, teamId);
      assert(policy.canManageTeam(m), 'Only the head coach changes settings');
      return c.json({ settings: patchSettings(ctx, c.var.auth.user.id, teamId, c.req.valid('json')) }, 200);
    });
}
