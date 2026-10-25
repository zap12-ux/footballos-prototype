import { eq } from 'drizzle-orm';
import {
  ANALYSIS_VERSION, applyInference, createInferLabelsHandler, createVisionLabeler, isProviderUnavailable, LABEL_SEGMENT_PROMPT_VERSION,
  type InferLabelsJobInput, type InferLabelsResult,
} from '@footballos/ai';
import {
  asJobHandler, createMediaHandlers, extractFrames, NonRetryableError, type HandlerContext, type Job, type MediaHandler, type MediaJobInput,
  type ProxyJobResult, type RunnerEvent, type SegmentJobResult, type ThumbnailsJobResult, type UploadLimits, type ValidateJobResult,
} from '@footballos/media';
import type { AppContext } from '../context.js';
import type { Db } from '../db/db.js';
import { labels, mediaAssets, modelProvenance } from '../db/schema.js';
import { applyRetention, gcExpiredUploads, CHAIN_KINDS, type AssetRow } from '../services/media.js';
import { keyFor, tightenPermissions } from '../services/storage.js';
import { storeProposedSegments } from '../services/segments.js';
import { listLabelsForSegments, serializeLabel } from '../services/labels.js';
import { monthlyCostUsd } from '../services/usage.js';

/** `ProcessingJob.input` for the validate → proxy → thumbnails → segment chain (C's MediaJobInput plus identity). */
export type ChainJobInput = MediaJobInput & { teamId: string; gameId: string };

export const MAINTENANCE_INTERVAL_MS = 5 * 60_000;

export function uploadLimitsFor(ctx: AppContext): Partial<UploadLimits> {
  return {
    allowedContainers: ctx.config.limits.allowedVideoContainers.filter((c): c is UploadLimits['allowedContainers'][number] =>
      (['mp4', 'mov', 'mkv', 'webm', 'avi', 'mpegts', 'other'] as string[]).includes(c)),
    maxBytes: ctx.config.limits.maxUploadBytes,
  };
}

/** Config version of inference jobs: provider, model, analysis and prompt versions (idempotency + provenance). */
export function inferConfigVersion(ctx: AppContext): string {
  return `${ctx.config.modelProvider}:${ctx.config.ai.anthropicModel}:analysis-${ANALYSIS_VERSION}:prompt-${LABEL_SEGMENT_PROMPT_VERSION}`;
}


/**
 * Registers the §14.2 handlers on the context's JobRunner and installs the store hooks that persist
 * each result into media_assets / play_segments / labels / model_provenance inside the same SQLite
 * transaction that marks the job succeeded. Called once by `buildContext`.
 */
export function registerJobHandlers(ctx: AppContext): void {
  const media = createMediaHandlers({
    dataDir: ctx.config.dataDir,
    limits: uploadLimitsFor(ctx),
    proxy: { height: ctx.config.limits.proxyHeight },
    thumbnails: { everySec: ctx.config.limits.thumbnailEverySec },
  });
  const requireLiveAsset = (input: MediaJobInput) => {
    const a = ctx.db.select().from(mediaAssets).where(eq(mediaAssets.id, input.assetId)).get();
    if (!a || a.status === 'deleted') throw new NonRetryableError('asset_deleted', 'The asset no longer exists');
    if (a.status === 'rejected') throw new NonRetryableError('asset_rejected', a.rejectionReason ?? 'The file was rejected during validation');
    return a;
  };
  const guarded = <R>(handler: MediaHandler<R>): MediaHandler<R> => async (job, c) => { requireLiveAsset(job.input); return handler(job, c); };
  ctx.runner
    .register('validate', asJobHandler(guarded(media.validate)))
    .register('proxy', asJobHandler(guarded(media.proxy)))
    .register('thumbnails', asJobHandler(guarded(media.thumbnails)))
    .register('segment', asJobHandler(guarded(media.segment)))
    .register<InferLabelsJobInput, InferLabelsResult>('infer_labels', async (h: HandlerContext<InferLabelsJobInput>) => {
      // §14.5: no provider → fail immediately and truthfully; manual labeling stays available.
      if (ctx.config.modelProvider === 'none') throw new NonRetryableError('provider_unavailable', 'No model provider is configured');
      const cap = ctx.config.limits.monthlyCostCapUsd;
      const spent = monthlyCostUsd(ctx, h.job.teamId, ctx.now());
      if (spent >= cap) {
        throw new NonRetryableError('budget_exceeded', `Month-to-date model spend $${spent.toFixed(4)} has reached the monthly cap $${cap.toFixed(2)} (MONTHLY_COST_CAP_USD)`);
      }
      const labeler = createVisionLabeler(ctx.config.modelProvider, { config: ctx.config.ai });
      const handler = createInferLabelsHandler({ labeler, extractFrames, budgetUsd: ctx.config.ai.jobBudgetUsd, maxFramesPerSegment: ctx.config.ai.maxFramesPerSegment });
      try {
        return await handler({ id: h.job.id, input: h.input }, { signal: h.signal, progress: (done, total, message) => h.progress({ done, total, message }) });
      } catch (err) {
        // C's runner retries everything except NonRetryableError; D's adapter says whether a retry can help.
        if (isProviderUnavailable(err)) {
          if (!err.retryable) throw new NonRetryableError(err.reason === 'budget_exceeded' ? 'budget_exceeded' : 'provider_unavailable', err.message);
          throw Object.assign(new Error(err.message), { code: 'provider_unavailable' });
        }
        throw err;
      }
    });

  ctx.jobStore.hooks = {
    onSucceeded: (job, result, tx) => persistResult(ctx, tx, job, result),
    onFailed: (job, _error, tx) => {
      if (!(CHAIN_KINDS as readonly string[]).includes(job.kind) || !job.assetId) return;
      const a = tx.select().from(mediaAssets).where(eq(mediaAssets.id, job.assetId)).get();
      if (a && !['rejected', 'deleted'].includes(a.status)) tx.update(mediaAssets).set({ status: 'failed', updatedAt: ctx.now().toISOString() }).where(eq(mediaAssets.id, a.id)).run();
    },
  };

  ctx.runner.on('event', (e: RunnerEvent) => {
    if (e.type === 'progress') return;
    const job = 'job' in e ? e.job : null;
    ctx.logger.info(`job ${e.type}`, { jobId: job?.id, kind: job?.kind, status: job?.status, assetId: job?.assetId, error: job?.error ?? undefined, recovered: e.type === 'recovered' ? e.jobs.length : undefined });
  });
  ctx.runner.on('error', (err: unknown) => ctx.logger.error('worker loop error', { error: err }));
}

function persistResult(ctx: AppContext, tx: Db, job: Job, result: unknown): void {
  if (!job.assetId) return;
  const asset = tx.select().from(mediaAssets).where(eq(mediaAssets.id, job.assetId)).get();
  if (!asset || asset.status === 'deleted') return;
  const nowIso = ctx.now().toISOString();
  const input = job.input as ChainJobInput;
  switch (job.kind) {
    case 'validate': {
      const r = result as ValidateJobResult;
      tx.update(mediaAssets)
        .set({
          status: r.ok ? 'validated' : 'rejected',
          rejectionReason: r.ok ? null : r.reasons.join(' '),
          durationSec: r.probe?.durationSec ?? null, width: r.probe?.width ?? null, height: r.probe?.height ?? null, fps: r.probe?.fps ?? null, quality: r.quality,
          updatedAt: nowIso,
        })
        .where(eq(mediaAssets.id, asset.id))
        .run();
      // Dependents must not run on a rejected file.
      if (!r.ok) cascadeChain(ctx, tx, job.id, ctx.now());
      return;
    }
    case 'proxy': {
      const r = result as ProxyJobResult;
      tightenPermissions(input.outDir);
      tx.update(mediaAssets).set({ proxyStorageKey: keyFor(ctx.config, r.proxyPath), status: 'processing', updatedAt: nowIso }).where(eq(mediaAssets.id, asset.id)).run();
      return;
    }
    case 'thumbnails': {
      const r = result as ThumbnailsJobResult;
      tightenPermissions(input.outDir);
      tx.update(mediaAssets).set({ thumbnailSheetKey: keyFor(ctx.config, r.sheetPath), updatedAt: nowIso }).where(eq(mediaAssets.id, asset.id)).run();
      return;
    }
    case 'segment': {
      const r = result as SegmentJobResult;
      storeProposedSegments(tx, asset as AssetRow, r.segments, nowIso);
      tx.update(mediaAssets).set({ status: 'ready', updatedAt: nowIso }).where(eq(mediaAssets.id, asset.id)).run();
      return;
    }
    case 'infer_labels': {
      const r = result as InferLabelsResult;
      const existing = listLabelsForSegments(tx, r.perSegment.map((p) => p.segmentId)).map(serializeLabel);
      for (const p of r.perSegment) {
        const prov = p.provenance;
        tx.insert(modelProvenance).values({
          id: prov.id, teamId: job.teamId, assetId: asset.id, segmentId: p.segmentId, jobId: job.id, provider: prov.provider, model: prov.model,
          modelRevision: prov.modelRevision, promptId: prov.promptId, promptHash: prov.promptHash, preprocessing: prov.preprocessing, inspected: prov.inspected,
          analysisVersion: prov.analysisVersion, inputTokens: prov.inputTokens, outputTokens: prov.outputTokens, costUsd: prov.costUsd, latencyMs: prov.latencyMs,
          requestedAt: prov.requestedAt, completedAt: prov.completedAt,
        }).run();
        const { upserts } = applyInference(existing, p.segmentId, p.labels, prov.id, { teamId: job.teamId, now: () => new Date(nowIso) });
        for (const l of upserts) {
          tx.insert(labels)
            .values({ id: l.id, teamId: l.teamId, segmentId: l.segmentId, key: l.key, inferred: l.inferred, accepted: l.accepted, provenanceId: l.provenanceId, version: l.version, createdAt: l.createdAt, updatedAt: l.updatedAt })
            .onConflictDoUpdate({ target: [labels.segmentId, labels.key], set: { inferred: l.inferred, accepted: l.accepted, provenanceId: l.provenanceId, version: l.version, updatedAt: l.updatedAt } })
            .run();
        }
      }
      return;
    }
    default:
      return;
  }
}

/** Marks every queued dependent of `jobId` failed with `upstream_failed` (used when validate succeeds but rejects the file). */
function cascadeChain(ctx: AppContext, tx: Db, jobId: string, now: Date): void {
  ctx.jobStore.failDependents(tx, jobId, now);
}

/** Runs claimable jobs until none is left. For tests and `WORKER_INLINE` smoke runs. */
export async function runWorkerUntilIdle(ctx: AppContext, maxJobs = 100): Promise<Job[]> {
  const done: Job[] = [];
  for (let i = 0; i < maxJobs; i++) {
    const j = await ctx.runner.runOnce();
    if (!j) break;
    done.push(j);
  }
  return done;
}

/** Upload garbage collection and retention; the worker runs it at start and every MAINTENANCE_INTERVAL_MS. */
export function runMaintenance(ctx: AppContext): { expiredUploads: number; retentionDeleted: number } {
  const expiredUploads = gcExpiredUploads(ctx);
  const retentionDeleted = applyRetention(ctx);
  if (expiredUploads || retentionDeleted) ctx.logger.info('maintenance tick', { expiredUploads, retentionDeleted });
  return { expiredUploads, retentionDeleted };
}

/** Starts the runner loop (recovering expired leases first) plus the maintenance timer. Returns a stop function. */
export async function startWorker(ctx: AppContext): Promise<() => Promise<void>> {
  const recovered = await ctx.runner.recover();
  ctx.logger.info('worker starting', { workerId: ctx.runner.workerId, recoveredJobs: recovered.length, concurrency: ctx.config.limits.workerConcurrency });
  try { runMaintenance(ctx); } catch (err) { ctx.logger.error('maintenance failed', { error: err }); }
  const timer = setInterval(() => { try { runMaintenance(ctx); } catch (err) { ctx.logger.error('maintenance failed', { error: err }); } }, MAINTENANCE_INTERVAL_MS);
  timer.unref();
  if (ctx.config.limits.workerConcurrency > 0) ctx.runner.start();
  return async () => { clearInterval(timer); await ctx.runner.stop(); };
}
