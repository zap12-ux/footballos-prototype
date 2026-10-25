import type { InferRequest, LabelKey } from '@footballos/contracts';
import { idempotencyKeyFor, type Job } from '@footballos/media';
import type { AppContext } from '../context.js';
import { errors } from '../errors.js';
import { enqueueJob } from '../jobs/enqueue.js';
import type { InferLabelsJobInput } from '@footballos/ai';
import { inferConfigVersion } from '../jobs/worker.js';
import { LABEL_KEYS } from './labels.js';
import type { AssetRow } from './media.js';
import { listLiveSegments } from './segments.js';
import { absolutePath } from './storage.js';

const TERMINAL = new Set(['succeeded', 'failed', 'canceled']);

/**
 * §14.5: one `infer_labels` job per batch of at most FOOTBALLOS_AI_MAX_SEGMENTS_PER_JOB segments.
 * A batch whose job is still pending is returned as that job; a finished batch gets a new job
 * (generation counter in the key) so a coach can re-run inference after corrections, which
 * `applyInference` preserves.
 */
export async function enqueueInference(ctx: AppContext, userId: string, asset: AssetRow, body: InferRequest): Promise<Job[]> {
  if (!['ready', 'processing', 'validated'].includes(asset.status)) {
    throw errors.conflict(`Asset is ${asset.status}; inference needs validated film`, { status: asset.status });
  }
  const live = listLiveSegments(ctx.db, asset.id).filter((s) => s.reviewStatus !== 'rejected');
  const wanted = body.segmentIds ? new Set(body.segmentIds) : null;
  const segments = live.filter((s) => wanted === null || wanted.has(s.id));
  if (segments.length === 0) throw errors.validation('No segments to label');
  const labelKeys: LabelKey[] = body.labelKeys ?? [...LABEL_KEYS];
  const sourcePath = absolutePath(ctx.config, asset.proxyStorageKey ?? asset.storageKey);
  const configVersion = inferConfigVersion(ctx);
  const batchSize = Math.max(1, Math.floor(ctx.config.ai.maxSegmentsPerJob));
  const jobs: Job[] = [];
  for (let i = 0; i < segments.length; i += batchSize) {
    const batch = segments.slice(i, i + batchSize);
    const input: InferLabelsJobInput = {
      assetId: asset.id, sourcePath, context: asset.context, labelKeys,
      segments: batch.map((s) => ({ id: s.id, startSec: s.startSec, endSec: s.endSec, fps: asset.fps })),
    };
    const base = { assetId: asset.id, segmentIds: batch.map((s) => s.id).sort(), labelKeys: [...labelKeys].sort() };
    let generation = 0;
    for (;;) {
      const existing = await ctx.jobStore.findByIdempotencyKey(idempotencyKeyFor('infer_labels', { ...base, generation }, configVersion));
      if (existing && TERMINAL.has(existing.status)) { generation += 1; continue; }
      const { job } = await enqueueJob(ctx, { teamId: asset.teamId, assetId: asset.id, kind: 'infer_labels', input, requestedBy: userId, keyInputs: { ...base, generation }, configVersion });
      jobs.push(job);
      break;
    }
  }
  return jobs;
}
