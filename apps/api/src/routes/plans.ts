import { Hono } from 'hono';
import { z } from 'zod';
import {
  ApprovePlanVersionRequestSchema, CreatePlanCommentRequestSchema, CreateShareLinkRequestSchema, IdSchema, PatchPlanVersionRequestSchema, PlanTransitionRequestSchema, SHARE_LINK_MAX_HOURS, UnitSchema,
  type CreateShareLinkResponse, type GamePlanResponse, type PlanVersionResponse, type SharedPlanResponse, type Unit,
} from '@footballos/contracts';
import type { AppContext } from '../context.js';
import { errors } from '../errors.js';
import { zv } from '../http/validate.js';
import { assert, policy, requireAuth, requireMembership, type AppEnv } from '../http/guards.js';
import { resolveSession } from '../auth/session.js';
import { getGame, getOpponent, type GameRow } from '../services/schedule.js';
import { getTeam } from '../services/teams.js';
import { getUser } from '../services/users.js';
import { currentHashes, recommendationsForFlags } from '../services/recommendations.js';
import {
  approveVersion, createComment, createDraftFrom, currentVersion, ensurePlan, getComment, getPlanById, listComments, listVersions, patchVersion, reopenVersion, requireVersion,
  resolveComment, reviewFlagsFor, serializeComment, serializePlan, serializeVersion, serializeVersionSummary, submitVersion, type PlanVersionRow,
} from '../services/plans.js';
import { createShareLink, getShareLink, listShareLinks, listShareLinksForTarget, resolveShareToken, revokeShareLink, serializeShareLink } from '../services/share.js';
import { renderHtml, renderPdf, type ExportContext } from '../services/plan-export.js';
import { teamIdsOf } from './media.js';

const planParam = z.object({ gameId: IdSchema, unit: UnitSchema });
const idParam = z.object({ id: IdSchema });
const teamParam = z.object({ teamId: IdSchema });

/** §15.4 unit game plans, approval, comments, sharing (authenticated). */
export function planRoutes(ctx: AppContext) {
  const requireGame = (auth: AppEnv['Variables']['auth'], gameId: string) => {
    const game = getGame(ctx, gameId);
    if (!game || !teamIdsOf(auth).includes(game.teamId)) throw errors.notFound('Game');
    return { game, membership: requireMembership(auth, game.teamId) };
  };
  const planOf = (v: PlanVersionRow) => {
    const plan = getPlanById(ctx.db, v.planId);
    const game = plan ? getGame(ctx, plan.gameId) : undefined;
    if (!plan || !game) throw errors.notFound('Plan');
    return { plan, game, unit: plan.unit as Unit };
  };
  const bundle = (game: GameRow, unit: Unit, planId: string): GamePlanResponse => {
    const plan = getPlanById(ctx.db, planId)!;
    const versions = listVersions(ctx.db, planId);
    const current = currentVersion(versions)!;
    const hashes = currentHashes(ctx, game, unit);
    const recs = recommendationsForFlags(ctx, game, unit, hashes);
    const flagged = versions.filter((v) => v.status === 'approved' || v.status === 'draft' || v.status === 'in_review');
    return { plan: serializePlan(plan), versions: versions.map(serializeVersionSummary), current: serializeVersion(current), reviewFlags: flagged.flatMap((v) => reviewFlagsFor(v, recs, hashes)) };
  };
  return new Hono<AppEnv>()
    .use('*', requireAuth(ctx))
    .get('/games/:gameId/plans/:unit', zv('param', planParam), (c) => {
      const { gameId, unit } = c.req.valid('param');
      const { game } = requireGame(c.var.auth, gameId);
      const hashes = currentHashes(ctx, game, unit);
      const { plan } = ctx.db.transaction((tx) => ensurePlan(ctx, tx, game, unit, c.var.auth.user.id, hashes));
      return c.json(bundle(game, unit, plan.id), 200);
    })
    .get('/plan-versions/:id', zv('param', idParam), (c) => {
      const v = requireVersion(ctx, c.req.valid('param').id, teamIdsOf(c.var.auth));
      requireMembership(c.var.auth, v.teamId);
      const body: PlanVersionResponse = { version: serializeVersion(v) };
      return c.json(body, 200);
    })
    .patch('/plan-versions/:id', zv('param', idParam), zv('json', PatchPlanVersionRequestSchema), (c) => {
      const v = requireVersion(ctx, c.req.valid('param').id, teamIdsOf(c.var.auth));
      const m = requireMembership(c.var.auth, v.teamId);
      const { unit } = planOf(v);
      assert(policy.canEditUnitPlan(m, unit), 'Head coach or staff assigned to this unit required');
      const body: PlanVersionResponse = { version: serializeVersion(patchVersion(ctx, c.var.auth.user.id, v, c.req.valid('json'))) };
      return c.json(body, 200);
    })
    .post('/plan-versions/:id/draft', zv('param', idParam), (c) => {
      const v = requireVersion(ctx, c.req.valid('param').id, teamIdsOf(c.var.auth));
      const m = requireMembership(c.var.auth, v.teamId);
      const { game, unit } = planOf(v);
      assert(policy.canEditUnitPlan(m, unit), 'Head coach or staff assigned to this unit required');
      const draft = createDraftFrom(ctx, c.var.auth.user.id, v, currentHashes(ctx, game, unit));
      return c.json({ version: serializeVersion(draft) }, 201);
    })
    .post('/plan-versions/:id/submit', zv('param', idParam), zv('json', PlanTransitionRequestSchema.optional().default({})), (c) => {
      const v = requireVersion(ctx, c.req.valid('param').id, teamIdsOf(c.var.auth));
      const m = requireMembership(c.var.auth, v.teamId);
      const { unit } = planOf(v);
      assert(policy.canEditUnitPlan(m, unit), 'Head coach or staff assigned to this unit required');
      return c.json({ version: serializeVersion(submitVersion(ctx, c.var.auth.user.id, v, c.req.valid('json').note)) }, 200);
    })
    .post('/plan-versions/:id/approve', zv('param', idParam), zv('json', ApprovePlanVersionRequestSchema.optional().default({})), (c) => {
      const v = requireVersion(ctx, c.req.valid('param').id, teamIdsOf(c.var.auth));
      const m = requireMembership(c.var.auth, v.teamId);
      const { game, unit } = planOf(v);
      const perm = policy.canApproveUnitPlan(m, unit);
      assert(perm.allowed, 'Coordinator of the unit or head coach required');
      const approved = approveVersion(ctx, c.var.auth.user.id, v, perm.override, c.req.valid('json'), currentHashes(ctx, game, unit));
      return c.json({ version: serializeVersion(approved) }, 200);
    })
    .post('/plan-versions/:id/reopen', zv('param', idParam), zv('json', PlanTransitionRequestSchema.optional().default({})), (c) => {
      const v = requireVersion(ctx, c.req.valid('param').id, teamIdsOf(c.var.auth));
      const m = requireMembership(c.var.auth, v.teamId);
      const { unit } = planOf(v);
      assert(policy.canDecideForUnit(m, unit), 'Coordinator of the unit or head coach required');
      return c.json({ version: serializeVersion(reopenVersion(ctx, c.var.auth.user.id, v, c.req.valid('json').note)) }, 200);
    })
    // Comments -----------------------------------------------------------------------------------------
    .get('/plan-versions/:id/comments', zv('param', idParam), (c) => {
      const v = requireVersion(ctx, c.req.valid('param').id, teamIdsOf(c.var.auth));
      requireMembership(c.var.auth, v.teamId);
      return c.json({ items: listComments(ctx.db, v.id).map(serializeComment) }, 200);
    })
    .post('/plan-versions/:id/comments', zv('param', idParam), zv('json', CreatePlanCommentRequestSchema), (c) => {
      const v = requireVersion(ctx, c.req.valid('param').id, teamIdsOf(c.var.auth));
      requireMembership(c.var.auth, v.teamId);
      return c.json({ comment: serializeComment(createComment(ctx, c.var.auth.user.id, v, c.req.valid('json'))) }, 201);
    })
    .post('/plan-comments/:id/resolve', zv('param', idParam), (c) => {
      const comment = getComment(ctx.db, c.req.valid('param').id);
      if (!comment || !teamIdsOf(c.var.auth).includes(comment.teamId)) throw errors.notFound('Comment');
      requireMembership(c.var.auth, comment.teamId);
      return c.json({ comment: serializeComment(resolveComment(ctx, c.var.auth.user.id, comment)) }, 200);
    })
    // Sharing ------------------------------------------------------------------------------------------
    .post('/plan-versions/:id/share', zv('param', idParam), zv('json', CreateShareLinkRequestSchema.optional().default({ expiresInHours: SHARE_LINK_MAX_HOURS })), (c) => {
      const v = requireVersion(ctx, c.req.valid('param').id, teamIdsOf(c.var.auth));
      requireMembership(c.var.auth, v.teamId);
      const r = createShareLink(ctx, c.var.auth.user.id, v, c.req.valid('json').expiresInHours);
      const body: CreateShareLinkResponse = { link: serializeShareLink(r.link), url: r.url, token: r.token };
      return c.json(body, 201);
    })
    .get('/plan-versions/:id/share-links', zv('param', idParam), (c) => {
      const v = requireVersion(ctx, c.req.valid('param').id, teamIdsOf(c.var.auth));
      requireMembership(c.var.auth, v.teamId);
      return c.json({ items: listShareLinksForTarget(ctx, v.id).map(serializeShareLink) }, 200);
    })
    .delete('/share-links/:id', zv('param', idParam), (c) => {
      const link = getShareLink(ctx, c.req.valid('param').id);
      if (!link || !teamIdsOf(c.var.auth).includes(link.teamId)) throw errors.notFound('Share link');
      const m = requireMembership(c.var.auth, link.teamId);
      assert(link.createdBy === c.var.auth.user.id || policy.canManageTeam(m), 'Only the creator or the head coach revokes a share link');
      revokeShareLink(ctx, c.var.auth.user.id, link);
      return c.body(null, 204);
    })
    .get('/teams/:teamId/share-links', zv('param', teamParam), (c) => {
      const { teamId } = c.req.valid('param');
      const m = requireMembership(c.var.auth, teamId);
      assert(policy.canManageTeam(m), 'Head coach required');
      return c.json({ items: listShareLinks(ctx, teamId).map(serializeShareLink) }, 200);
    });
}

const tokenParam = z.object({ token: z.string().min(1).max(256) });
const tokenQuery = z.object({ token: z.string().min(1).max(256).optional() });

/** Builds what the shared view and the exports print. */
function exportContext(ctx: AppContext, v: PlanVersionRow): ExportContext & { game: GameRow } {
  const plan = getPlanById(ctx.db, v.planId);
  const game = plan ? getGame(ctx, plan.gameId) : undefined;
  const team = getTeam(ctx, v.teamId);
  if (!plan || !game || !team) throw errors.notFound('Plan');
  const opponent = game.opponentId ? getOpponent(ctx, game.teamId, game.opponentId) : undefined;
  const approver = v.approvedBy ? getUser(ctx, v.approvedBy) : undefined;
  return {
    version: serializeVersion(v), unit: plan.unit as Unit, team: { name: team.name, shortName: team.shortName, environmentKind: team.environmentKind }, opponentName: opponent?.name ?? null,
    week: game.week, scheduledAt: game.scheduledAt, approvedByName: approver?.displayName ?? null, generatedAt: ctx.now().toISOString(), game,
  };
}

/**
 * §15.4 routes that work without a session: the read-only shared plan (`GET /shared/:token`) and
 * the exports, which accept a session **or** a share token for that very version (approved only).
 */
export function sharedPlanRoutes(ctx: AppContext) {
  const authorizeExport = (c: { req: { header(name: string): string | undefined }; }, cookieCtx: Parameters<typeof resolveSession>[1], versionId: string, token: string | undefined): PlanVersionRow => {
    void c;
    if (token) {
      const link = resolveShareToken(ctx, token);
      if (link.targetType !== 'plan_version' || link.targetId !== versionId) throw errors.notFound('Plan version');
      const v = requireVersion(ctx, versionId, [link.teamId]);
      if (v.status !== 'approved') throw errors.notFound('Plan version');
      return v;
    }
    const auth = resolveSession(ctx, cookieCtx);
    if (!auth) throw errors.unauthorized();
    const v = requireVersion(ctx, versionId, teamIdsOf(auth));
    requireMembership(auth, v.teamId);
    return v;
  };
  const exportHeaders = (filename: string, contentType: string) => ({
    'Content-Type': contentType,
    'Content-Disposition': `inline; filename="${filename}"`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
    'Cache-Control': 'private, no-store',
  });
  return new Hono()
    .get('/shared/:token', zv('param', tokenParam), (c) => {
      const link = resolveShareToken(ctx, c.req.valid('param').token);
      const v = link.targetType === 'plan_version' ? requireVersion(ctx, link.targetId, [link.teamId]) : undefined;
      if (!v || v.status !== 'approved') throw errors.notFound('Shared plan');
      const x = exportContext(ctx, v);
      const body: SharedPlanResponse = {
        version: x.version, team: { name: x.team.name, shortName: x.team.shortName, environmentKind: x.team.environmentKind as SharedPlanResponse['team']['environmentKind'] },
        game: { id: x.game.id, week: x.game.week, scheduledAt: x.game.scheduledAt, opponentName: x.opponentName, location: x.game.location }, unit: x.unit, expiresAt: link.expiresAt,
      };
      return c.json(body, 200);
    })
    .get('/plan-versions/:id/export.html', zv('param', idParam), zv('query', tokenQuery), (c) => {
      const v = authorizeExport(c, c, c.req.valid('param').id, c.req.valid('query').token);
      const html = renderHtml(exportContext(ctx, v));
      return c.body(html, 200, exportHeaders(`plan-v${v.number}.html`, 'text/html; charset=utf-8'));
    })
    .get('/plan-versions/:id/export.pdf', zv('param', idParam), zv('query', tokenQuery), async (c) => {
      const v = authorizeExport(c, c, c.req.valid('param').id, c.req.valid('query').token);
      const pdf = await renderPdf(exportContext(ctx, v));
      return c.body(new Uint8Array(pdf), 200, { ...exportHeaders(`plan-v${v.number}.pdf`, 'application/pdf'), 'Content-Length': String(pdf.length) });
    });
}
