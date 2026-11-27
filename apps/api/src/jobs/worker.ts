import { eq } from 'drizzle-orm';
import {
  ANALYSIS_VERSION, applyInference, createInferLabelsHandler, isProviderUnavailable, LABEL_SEGMENT_PROMPT_VERSION,
  type InferLabelsJobInput, type InferLabelsResult,
} from '@footballos/ai';
import {
  asJobHandler, createMediaHandlers, extractFrames, NonRetryableError, type HandlerContext, type Job, type MediaHandler, type MediaJobInput,
  type ProxyJobResult, type RunnerEvent, type SegmentJobResult, type ThumbnailsJobResult, type UploadLimits, type ValidateJobResult,
} from '@footballos/media';
import type { AppContext } from '../context.js';
import type { Db } from '../db/db.js';
import { labels, mediaAssets, modelProvenance } from '../db/schema.js';
import { applyRetention, gcExpiredUploads, CHAIN_KINDS, DOCUMENT_EXTRACT_KIND, type AssetRow, type DocumentJobInput } from '../services/media.js';
import { markExtractionFailed, persistExtraction, type ExtractionJobResult } from '../services/playbook.js';
import { checkOllama, createDocumentHandlers, createPageLabeler, createVisionLabeler, proposeFromPages, type OllamaStatus, type ProposalPage } from '../libs/index.js';
import { keyFor, tightenPermissions } from '../services/storage.js';
import { storeProposedSegments } from '../services/segments.js';
import { listLabelsForSegments, serializeLabel } from '../services/labels.js';

/** `ProcessingJob.input` for the validate → proxy → thumbnails → segment chain (C's MediaJobInput plus identity). */
export type ChainJobInput = MediaJobInput & { teamId: string; gameId: string };

/** Default maintenance cadence (seconds); `WORKER_MAINTENANCE_SEC` overrides it. */
export const DEFAULT_MAINTENANCE_INTERVAL_SEC = 60;

export function uploadLimitsFor(ctx: AppContext): Partial<UploadLimits> {
  return {
    allowedContainers: ctx.config.limits.allowedVideoContainers.filter((c): c is UploadLimits['allowedContainers'][number] =>
      (['mp4', 'mov', 'mkv', 'webm', 'avi', 'mpegts', 'other'] as string[]).includes(c)),
    maxBytes: ctx.config.limits.maxUploadBytes,
  };
}

/** Config version of inference jobs: provider, model, analysis and prompt versions (idempotency + provenance). */
export function inferConfigVersion(ctx: AppContext): string {
  return `ollama:${ctx.config.ai.model}:analysis-${ANALYSIS_VERSION}:prompt-${LABEL_SEGMENT_PROMPT_VERSION}`;
}

/** One sentence for a job error or a page note: the Ollama preflight's reason and message. */
function describeUnavailable(status: Extract<OllamaStatus, { ok: false }>): string {
  return `${status.reason}: ${status.message}`;
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
      // §14.5 / §14.10 (QA D-4): the Ollama preflight (server up, model pulled, model sees) runs
      // before any frame is extracted, so a failure here names the real cause and costs nothing.
      // Manual labeling stays available in all of these cases.
      const status = await checkOllama(ctx.config.ai);
      if (!status.ok) throw new NonRetryableError('provider_unavailable', `${describeUnavailable(status)}; manual labeling remains available`);
      const labeler = createVisionLabeler({ config: ctx.config.ai });
      const handler = createInferLabelsHandler({ labeler, extractFrames, maxFramesPerSegment: ctx.config.ai.maxFramesPerSegment });
      try {
        return await handler({ id: h.job.id, input: h.input }, { signal: h.signal, progress: (done, total, message) => h.progress({ done, total, message }) });
      } catch (err) {
        // C's runner retries everything except NonRetryableError; D's adapter says whether a retry can
        // help. The adapter's `reason` (unreachable, model_missing, truncated_output, ...) is kept in the message.
        if (isProviderUnavailable(err)) {
          const message = err.toJobError().message;
          if (!err.retryable) throw new NonRetryableError('provider_unavailable', message);
          throw Object.assign(new Error(message), { code: 'provider_unavailable' });
        }
        throw err;
      }
    });

  // §15.1 extract_document: C's extractor, then D's proposals over the extracted pages. A page
  // image goes to the model only when the Ollama preflight passes; otherwise pages without text
  // produce nothing and each page's note says why.
  const documents = createDocumentHandlers({ dataDir: ctx.config.dataDir, renderDpi: ctx.config.limits.documentRenderDpi, ocr: ctx.config.limits.documentOcr });
  ctx.runner.register<DocumentJobInput, ExtractionJobResult>(DOCUMENT_EXTRACT_KIND, async (h: HandlerContext<DocumentJobInput>) => {
    requireLiveAsset(h.input);
    const extraction = await documents.extract_document(
      { id: h.job.id, input: h.input, teamId: h.job.teamId },
      { signal: h.signal, progress: (done, total, message) => h.progress({ done, total, message }) },
    );
    const pages: ProposalPage[] = extraction.pages.map((p) => ({
      pageNumber: p.pageNumber, text: p.text, textSource: p.textSource, imagePath: p.imagePath, width: p.width, height: p.height, ocrConfidence: p.ocrConfidence,
    }));
    const status = await checkOllama(ctx.config.ai);
    if (!status.ok) ctx.logger.info('extract_document: model unavailable, text heuristics only', { jobId: h.job.id, reason: status.reason, message: status.message });
    await h.progress({ done: extraction.pageCount, total: extraction.pageCount, message: 'proposing concepts and terms' });
    const proposals = await proposeFromPages(pages, status.ok ? { labeler: createPageLabeler({ config: ctx.config.ai }) } : { modelUnavailable: describeUnavailable(status) });
    return { extraction, proposals };
  });

  ctx.jobStore.hooks = {
    onSucceeded: (job, result, tx) => persistResult(ctx, tx, job, result),
    onFailed: (job, error, tx) => {
      if (job.kind === DOCUMENT_EXTRACT_KIND) { markExtractionFailed(ctx, tx, job, `${error.code}: ${error.message}`); return; }
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
          // The probe's container (not the client's mimeType) decides the stream Content-Type (§14.10, QA D-1).
          container: r.probe?.container ?? null,
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
    case DOCUMENT_EXTRACT_KIND: {
      persistExtraction(ctx, tx, job, result as ExtractionJobResult);
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

export type MaintenanceResult = { recoveredLeases: number; expiredUploads: number; retentionDeleted: number };

/**
 * Maintenance tick (§14.10, QA D-2): expired job leases are recovered (an orphaned `running` job goes
 * back to `queued`, or ends `failed`/`canceled` when no attempts remain or a cancel was pending),
 * expired incomplete uploads are garbage-collected, and retention is applied. The worker runs it at
 * start and every `WORKER_MAINTENANCE_SEC` seconds (default 60), so a job orphaned by a crash is
 * picked up again without another restart.
 */
export async function runMaintenance(ctx: AppContext): Promise<MaintenanceResult> {
  const recoveredLeases = (await ctx.runner.recover()).length;
  const expiredUploads = gcExpiredUploads(ctx);
  const retentionDeleted = applyRetention(ctx);
  if (recoveredLeases || expiredUploads || retentionDeleted) ctx.logger.info('maintenance tick', { recoveredLeases, expiredUploads, retentionDeleted });
  return { recoveredLeases, expiredUploads, retentionDeleted };
}

/** Starts the runner loop (recovering expired leases first) plus the maintenance timer. Returns a stop function. */
export async function startWorker(ctx: AppContext): Promise<() => Promise<void>> {
  const recovered = await ctx.runner.recover();
  const intervalMs = ctx.config.limits.maintenanceIntervalSec * 1000;
  ctx.logger.info('worker starting', { workerId: ctx.runner.workerId, recoveredJobs: recovered.length, concurrency: ctx.config.limits.workerConcurrency, maintenanceIntervalSec: ctx.config.limits.maintenanceIntervalSec });
  const tick = async () => {
    try { await runMaintenance(ctx); } catch (err) { ctx.logger.error('maintenance failed', { error: err }); }
  };
  await tick();
  let ticking = false;
  const timer = setInterval(() => {
    if (ticking) return; // never overlap two ticks
    ticking = true;
    void tick().finally(() => { ticking = false; });
  }, intervalMs);
  timer.unref();
  if (ctx.config.limits.workerConcurrency > 0) ctx.runner.start();
  return async () => { clearInterval(timer); await ctx.runner.stop(); };
}
