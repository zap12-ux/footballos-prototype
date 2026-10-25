import { Hono } from 'hono';
import { z } from 'zod';
import { BulkAcceptRequestSchema, IdSchema, InferRequestSchema, PatchLabelRequestSchema } from '@footballos/contracts';
import type { AppContext } from '../context.js';
import { errors } from '../errors.js';
import { zv } from '../http/validate.js';
import { assert, policy, requireAuth, requireMembership, type AppEnv } from '../http/guards.js';
import { requireAsset } from '../services/media.js';
import { requireSegment } from '../services/segments.js';
import { enqueueInference } from '../services/inference.js';
import { serializeJob } from '../services/jobs.js';
import {
  bulkAccept, correctLabel, getLabel, listLabelsForAsset, listLabelsForSegment, listProvenanceForAsset, listRevisions, serializeLabel, serializeProvenance, serializeRevision,
} from '../services/labels.js';
import { teamIdsOf } from './media.js';

const assetParam = z.object({ assetId: IdSchema });
const segmentParam = z.object({ segmentId: IdSchema });
const labelParam = z.object({ labelId: IdSchema });

/** §14.5 labels, corrections, inference. */
export function labelRoutes(ctx: AppContext) {
  return new Hono<AppEnv>()
    .use('*', requireAuth(ctx))
    .post('/assets/:assetId/infer', zv('param', assetParam), zv('json', InferRequestSchema.optional().default({})), async (c) => {
      const { assetId } = c.req.valid('param');
      const a = requireAsset(ctx, assetId, teamIdsOf(c.var.auth));
      const m = requireMembership(c.var.auth, a.teamId);
      assert(policy.canUploadOrCorrect(m), 'Viewers cannot start inference');
      const jobs = await enqueueInference(ctx, c.var.auth.user.id, a, c.req.valid('json'));
      return c.json({ jobs: jobs.map(serializeJob) }, 202);
    })
    .get('/segments/:segmentId/labels', zv('param', segmentParam), (c) => {
      const { segmentId } = c.req.valid('param');
      const s = requireSegment(ctx, segmentId, teamIdsOf(c.var.auth));
      requireMembership(c.var.auth, s.teamId);
      return c.json({ items: listLabelsForSegment(ctx, s.id).map(serializeLabel) }, 200);
    })
    .get('/assets/:assetId/labels', zv('param', assetParam), (c) => {
      const { assetId } = c.req.valid('param');
      const a = requireAsset(ctx, assetId, teamIdsOf(c.var.auth));
      requireMembership(c.var.auth, a.teamId);
      return c.json({ items: listLabelsForAsset(ctx, a.id).map(serializeLabel) }, 200);
    })
    .patch('/labels/:labelId', zv('param', labelParam), zv('json', PatchLabelRequestSchema), (c) => {
      const { labelId } = c.req.valid('param');
      const l = getLabel(ctx, labelId);
      if (!l || !teamIdsOf(c.var.auth).includes(l.teamId)) throw errors.notFound('Label');
      const m = requireMembership(c.var.auth, l.teamId);
      assert(policy.canUploadOrCorrect(m), 'Viewers cannot correct labels');
      return c.json({ label: serializeLabel(correctLabel(ctx, c.var.auth.user.id, l, c.req.valid('json'))) }, 200);
    })
    .get('/labels/:labelId/revisions', zv('param', labelParam), (c) => {
      const { labelId } = c.req.valid('param');
      const l = getLabel(ctx, labelId);
      if (!l || !teamIdsOf(c.var.auth).includes(l.teamId)) throw errors.notFound('Label');
      requireMembership(c.var.auth, l.teamId);
      return c.json({ items: listRevisions(ctx, l.id).map(serializeRevision) }, 200);
    })
    .post('/assets/:assetId/labels/bulk-accept', zv('param', assetParam), zv('json', BulkAcceptRequestSchema), (c) => {
      const { assetId } = c.req.valid('param');
      const a = requireAsset(ctx, assetId, teamIdsOf(c.var.auth));
      const m = requireMembership(c.var.auth, a.teamId);
      assert(policy.canUploadOrCorrect(m), 'Viewers cannot accept labels');
      return c.json(bulkAccept(ctx, c.var.auth.user.id, a, c.req.valid('json')), 200);
    })
    .get('/assets/:assetId/provenance', zv('param', assetParam), (c) => {
      const { assetId } = c.req.valid('param');
      const a = requireAsset(ctx, assetId, teamIdsOf(c.var.auth));
      requireMembership(c.var.auth, a.teamId);
      return c.json({ items: listProvenanceForAsset(ctx, a.id).map(serializeProvenance) }, 200);
    });
}
