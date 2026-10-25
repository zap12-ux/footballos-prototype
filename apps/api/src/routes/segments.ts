import { Hono } from 'hono';
import { z } from 'zod';
import { CreateSegmentRequestSchema, IdSchema, MergeSegmentsRequestSchema, PatchSegmentRequestSchema, SplitSegmentRequestSchema } from '@footballos/contracts';
import type { AppContext } from '../context.js';
import { errors } from '../errors.js';
import { zv } from '../http/validate.js';
import { assert, policy, requireAuth, requireMembership, type AppEnv } from '../http/guards.js';
import { requireAsset } from '../services/media.js';
import { createSegment, listLiveSegments, merge, patchSegment, requireSegment, serializeSegment, split } from '../services/segments.js';
import { teamIdsOf } from './media.js';

const assetParam = z.object({ assetId: IdSchema });
const segmentParam = z.object({ segmentId: IdSchema });

/** §14.4 segments. */
export function segmentRoutes(ctx: AppContext) {
  return new Hono<AppEnv>()
    .use('*', requireAuth(ctx))
    .get('/assets/:assetId/segments', zv('param', assetParam), (c) => {
      const { assetId } = c.req.valid('param');
      const a = requireAsset(ctx, assetId, teamIdsOf(c.var.auth));
      requireMembership(c.var.auth, a.teamId);
      return c.json({ items: listLiveSegments(ctx.db, a.id).map(serializeSegment) }, 200);
    })
    .post('/assets/:assetId/segments', zv('param', assetParam), zv('json', CreateSegmentRequestSchema), (c) => {
      const { assetId } = c.req.valid('param');
      const a = requireAsset(ctx, assetId, teamIdsOf(c.var.auth));
      const m = requireMembership(c.var.auth, a.teamId);
      assert(policy.canUploadOrCorrect(m), 'Viewers cannot edit segments');
      if (a.status === 'deleted' || a.status === 'rejected') throw errors.conflict(`Asset is ${a.status}`, { status: a.status });
      return c.json({ segment: serializeSegment(createSegment(ctx, a, c.req.valid('json'))) }, 201);
    })
    .post('/segments/merge', zv('json', MergeSegmentsRequestSchema), (c) => {
      const body = c.req.valid('json');
      const teamIds = teamIdsOf(c.var.auth);
      const first = requireSegment(ctx, body.segmentIds[0]!, teamIds);
      const m = requireMembership(c.var.auth, first.teamId);
      assert(policy.canUploadOrCorrect(m), 'Viewers cannot edit segments');
      const r = merge(ctx, teamIds, body);
      return c.json({ segment: serializeSegment(r.segment), superseded: r.superseded.map(serializeSegment) }, 200);
    })
    .post('/segments/:segmentId/split', zv('param', segmentParam), zv('json', SplitSegmentRequestSchema), (c) => {
      const { segmentId } = c.req.valid('param');
      const s = requireSegment(ctx, segmentId, teamIdsOf(c.var.auth));
      const m = requireMembership(c.var.auth, s.teamId);
      assert(policy.canUploadOrCorrect(m), 'Viewers cannot edit segments');
      const r = split(ctx, s, c.req.valid('json'));
      return c.json({ segments: r.segments.map(serializeSegment), superseded: serializeSegment(r.superseded) }, 200);
    })
    .patch('/segments/:segmentId', zv('param', segmentParam), zv('json', PatchSegmentRequestSchema), (c) => {
      const { segmentId } = c.req.valid('param');
      const s = requireSegment(ctx, segmentId, teamIdsOf(c.var.auth));
      const m = requireMembership(c.var.auth, s.teamId);
      assert(policy.canUploadOrCorrect(m), 'Viewers cannot edit segments');
      return c.json({ segment: serializeSegment(patchSegment(ctx, s, c.req.valid('json'))) }, 200);
    });
}
