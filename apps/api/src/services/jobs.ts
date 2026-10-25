import type { ProcessingJob } from '@footballos/contracts';
import type { Job } from '@footballos/media';
import type { AppContext } from '../context.js';
import { errors } from '../errors.js';

export function serializeJob(j: Job): ProcessingJob {
  return {
    id: j.id, teamId: j.teamId, assetId: j.assetId, kind: j.kind as ProcessingJob['kind'], status: j.status, progress: j.progress, attempt: j.attempt,
    maxAttempts: j.maxAttempts, leaseExpiresAt: j.leaseExpiresAt, workerId: j.workerId, idempotencyKey: j.idempotencyKey, configVersion: j.configVersion,
    error: j.error, requestedBy: j.requestedBy || null, createdAt: j.createdAt, startedAt: j.startedAt, finishedAt: j.finishedAt, canceledAt: j.canceledAt,
    notBeforeAt: j.notBeforeAt, cancelRequestedAt: j.cancelRequestedAt,
  };
}

export async function requireJob(ctx: AppContext, jobId: string, teamIds: string[]): Promise<Job> {
  const job = await ctx.jobStore.get(jobId);
  if (!job || !teamIds.includes(job.teamId)) throw errors.notFound('Job');
  return job;
}
