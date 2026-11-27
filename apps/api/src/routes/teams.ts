import { Hono } from 'hono';
import { z } from 'zod';
import { CreateInviteRequestSchema, IdSchema, PaginationQuerySchema, PatchStaffRequestSchema, type CreatedInvite, type Usage } from '@footballos/contracts';
import type { AppContext } from '../context.js';
import { zv } from '../http/validate.js';
import { policy, requireAuth, requireMembership, assert, type AppEnv } from '../http/guards.js';
import { serialize } from '../services/serialize.js';
import { createInvite, getTeam, listAudit, listOpenInvites, listStaff, listTeamsForUser, patchStaff, revokeInvite } from '../services/teams.js';
import { errors } from '../errors.js';
import { computeUsage } from '../services/usage.js';

const teamParam = z.object({ teamId: IdSchema });

export function teamRoutes(ctx: AppContext) {
  return new Hono<AppEnv>()
    .use('*', requireAuth(ctx))
    .get('/teams', (c) => {
      const items = listTeamsForUser(ctx, c.var.auth.user.id).map((t) => ({ ...serialize.team(t.team), membership: serialize.membership(t.membership) }));
      return c.json({ items, nextCursor: null }, 200);
    })
    .get('/teams/:teamId', zv('param', teamParam), (c) => {
      const { teamId } = c.req.valid('param');
      const membership = requireMembership(c.var.auth, teamId);
      const team = getTeam(ctx, teamId);
      if (!team) throw errors.notFound('Team');
      return c.json({ ...serialize.team(team), membership: serialize.membership(membership) }, 200);
    })
    .get('/teams/:teamId/staff', zv('param', teamParam), (c) => {
      const { teamId } = c.req.valid('param');
      requireMembership(c.var.auth, teamId);
      const items = listStaff(ctx, teamId).map((r) => serialize.staffMember(r.membership, r.user));
      return c.json({ items, nextCursor: null }, 200);
    })
    .patch('/teams/:teamId/staff/:membershipId', zv('param', teamParam.extend({ membershipId: IdSchema })), zv('json', PatchStaffRequestSchema), (c) => {
      const { teamId, membershipId } = c.req.valid('param');
      const m = requireMembership(c.var.auth, teamId);
      assert(policy.canManageTeam(m), 'Only the head coach manages staff');
      const updated = patchStaff(ctx, c.var.auth.user.id, teamId, membershipId, c.req.valid('json'));
      return c.json(serialize.membership(updated), 200);
    })
    .get('/teams/:teamId/invites', zv('param', teamParam), (c) => {
      const { teamId } = c.req.valid('param');
      const m = requireMembership(c.var.auth, teamId);
      assert(policy.canManageTeam(m), 'Only the head coach manages invites');
      return c.json({ items: listOpenInvites(ctx, teamId).map(serialize.invite), nextCursor: null }, 200);
    })
    .post('/teams/:teamId/invites', zv('param', teamParam), zv('json', CreateInviteRequestSchema), (c) => {
      const { teamId } = c.req.valid('param');
      const m = requireMembership(c.var.auth, teamId);
      assert(policy.canManageTeam(m), 'Only the head coach manages invites');
      const { invite, token } = createInvite(ctx, c.var.auth.user.id, teamId, c.req.valid('json'));
      const body: CreatedInvite = { ...serialize.invite(invite), token };
      return c.json(body, 201);
    })
    .delete('/teams/:teamId/invites/:inviteId', zv('param', teamParam.extend({ inviteId: IdSchema })), (c) => {
      const { teamId, inviteId } = c.req.valid('param');
      const m = requireMembership(c.var.auth, teamId);
      assert(policy.canManageTeam(m), 'Only the head coach manages invites');
      return c.json(serialize.invite(revokeInvite(ctx, c.var.auth.user.id, teamId, inviteId)), 200);
    })
    .get('/teams/:teamId/audit', zv('param', teamParam), zv('query', PaginationQuerySchema), (c) => {
      const { teamId } = c.req.valid('param');
      const m = requireMembership(c.var.auth, teamId);
      assert(policy.canManageTeam(m), 'Only the head coach reads the audit log');
      const { limit, cursor } = c.req.valid('query');
      const page = listAudit(ctx, teamId, limit, cursor);
      return c.json({ items: page.items.map(serialize.audit), nextCursor: page.nextCursor }, 200);
    })
    .get('/teams/:teamId/usage', zv('param', teamParam), (c) => {
      const { teamId } = c.req.valid('param');
      requireMembership(c.var.auth, teamId);
      // §14.2 cost accounting: sums model_provenance.costUsd and tokens for the current UTC month (0 USD with local Ollama inference; cap null).
      const usage: Usage = computeUsage(ctx, teamId);
      return c.json(usage, 200);
    });
}
