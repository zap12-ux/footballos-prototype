import { idempotencyKeyFor, type Job } from '@footballos/media';
import type { AppContext } from '../context.js';

export type EnqueueInput = {
  teamId: string;
  assetId: string | null;
  kind: string;
  input: unknown;
  requestedBy: string;
  /** Inputs that identify the work; the key is sha256(kind + canonical inputs + configVersion). */
  keyInputs: unknown;
  configVersion: string;
  dependsOnJobId?: string | null;
  maxAttempts?: number;
};

/**
 * Inserts a job, or returns the existing job with the same idempotency key. Mirrors
 * `JobRunner.enqueue` but also records `dependsOnJobId` for chain ordering (SqliteJobStore).
 */
export async function enqueueJob(ctx: AppContext, req: EnqueueInput): Promise<{ job: Job; duplicate: boolean }> {
  const idempotencyKey = idempotencyKeyFor(req.kind, req.keyInputs, req.configVersion);
  const existing = await ctx.jobStore.findByIdempotencyKey(idempotencyKey);
  if (existing) return { job: existing, duplicate: true };
  const nowIso = ctx.now().toISOString();
  const job: Job & { dependsOnJobId: string | null } = {
    id: crypto.randomUUID(),
    teamId: req.teamId,
    assetId: req.assetId,
    kind: req.kind,
    status: 'queued',
    progress: { done: 0, total: null, message: 'queued' },
    attempt: 0,
    maxAttempts: req.maxAttempts ?? ctx.config.limits.jobMaxAttempts,
    leaseExpiresAt: null,
    workerId: null,
    idempotencyKey,
    configVersion: req.configVersion,
    error: null,
    requestedBy: req.requestedBy,
    createdAt: nowIso,
    startedAt: null,
    finishedAt: null,
    canceledAt: null,
    input: req.input,
    result: null,
    notBeforeAt: null,
    cancelRequestedAt: null,
    dependsOnJobId: req.dependsOnJobId ?? null,
  };
  try {
    await ctx.jobStore.insert(job);
    return { job, duplicate: false };
  } catch (err) {
    const again = await ctx.jobStore.findByIdempotencyKey(idempotencyKey);
    if (again) return { job: again, duplicate: true };
    throw err;
  }
}
