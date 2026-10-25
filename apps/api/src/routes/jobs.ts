import { Hono } from 'hono';
import { z } from 'zod';
import { IdSchema, JobsQuerySchema } from '@footballos/contracts';
import type { AppContext } from '../context.js';
import { errors } from '../errors.js';
import { zv } from '../http/validate.js';
import { assert, policy, requireAuth, requireMembership, type AppEnv } from '../http/guards.js';
import { requireJob, serializeJob } from '../services/jobs.js';
import { teamIdsOf } from './media.js';

const teamParam = z.object({ teamId: IdSchema });
const jobParam = z.object({ jobId: IdSchema });

/** §14.2 job routes. */
export function jobRoutes(ctx: AppContext) {
  return new Hono<AppEnv>()
    .use('*', requireAuth(ctx))
    .get('/teams/:teamId/jobs', zv('param', teamParam), zv('query', JobsQuerySchema), (c) => {
      const { teamId } = c.req.valid('param');
      requireMembership(c.var.auth, teamId);
      const q = c.req.valid('query');
      const page = ctx.jobStore.listPage({ teamId, assetId: q.assetId, status: q.status, limit: q.limit, cursor: q.cursor });
      return c.json({ items: page.items.map(serializeJob), nextCursor: page.nextCursor }, 200);
    })
    .get('/jobs/:jobId', zv('param', jobParam), async (c) => {
      const { jobId } = c.req.valid('param');
      const job = await requireJob(ctx, jobId, teamIdsOf(c.var.auth));
      requireMembership(c.var.auth, job.teamId);
      return c.json({ job: serializeJob(job) }, 200);
    })
    .post('/jobs/:jobId/cancel', zv('param', jobParam), async (c) => {
      const { jobId } = c.req.valid('param');
      const job = await requireJob(ctx, jobId, teamIdsOf(c.var.auth));
      const m = requireMembership(c.var.auth, job.teamId);
      assert(policy.canUploadOrCorrect(m), 'Viewers cannot manage processing jobs');
      if (['succeeded', 'failed', 'canceled'].includes(job.status)) throw errors.conflict(`Job is already ${job.status}`, { status: job.status });
      const updated = (await ctx.runner.requestCancel(jobId)) ?? job;
      return c.json({ job: serializeJob(updated) }, 200);
    })
    .post('/jobs/:jobId/retry', zv('param', jobParam), async (c) => {
      const { jobId } = c.req.valid('param');
      const job = await requireJob(ctx, jobId, teamIdsOf(c.var.auth));
      const m = requireMembership(c.var.auth, job.teamId);
      assert(policy.canUploadOrCorrect(m), 'Viewers cannot manage processing jobs');
      if (job.status !== 'failed' && job.status !== 'canceled') throw errors.conflict(`Only failed or canceled jobs can be retried; job is ${job.status}`, { status: job.status });
      const updated = ctx.jobStore.retry(jobId, ctx.now()) ?? job;
      return c.json({ job: serializeJob(updated) }, 200);
    });
}
