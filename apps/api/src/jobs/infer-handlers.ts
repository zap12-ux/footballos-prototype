/**
 * LOCAL STAND-IN for `createInferLabelsHandler` / `applyInference` from `@footballos/ai`
 * (CONTRACTS §14.8, owned by D). Same signatures; swap the import in `src/jobs/worker.ts` for the
 * package export when D's branch lands and delete this file.
 */
import type { InferredLabel as InferredBody, Label, LabelKey, ModelProvenance, UploadContext } from '@footballos/contracts';
import { ANALYSIS_VERSION, JobBudget, ProviderUnavailableError, planFrameSampling, type InferredLabel as AiInferredLabel, type VisionLabeler } from '@footballos/ai';
import { NonRetryableError } from '@footballos/media';
import type { ExtractedFrame } from './media-handlers.js';

export type InferSegment = { id: string; startSec: number; endSec: number; fps: number | null };
export type InferJobInput = { assetId: string; sourcePath: string; context: UploadContext; labelKeys: LabelKey[]; segments: InferSegment[] };
export type InferPerSegment = { segmentId: string; labels: AiInferredLabel[]; provenance: ModelProvenance };
export type InferResult = { perSegment: InferPerSegment[]; skipped: { segmentId: string; reason: string }[]; costUsd: number };

export type InferHandlerOptions = {
  labeler: VisionLabeler;
  extractFrames: (src: string, timestampsSec: number[], opts: { height?: number; signal?: AbortSignal }) => Promise<ExtractedFrame[]>;
  budgetUsd: number;
  maxFramesPerSegment: number;
  /** Frames per second to sample before the cap; 1 by default. */
  sampleFps?: number;
};

export function createInferLabelsHandler(opts: InferHandlerOptions) {
  return async (
    job: { id: string; input: InferJobInput },
    ctx: { signal: AbortSignal; progress(done: number, total: number | null, message: string): Promise<void> | void },
  ): Promise<InferResult> => {
    if (!opts.labeler.isAvailable()) {
      throw new NonRetryableError('provider_unavailable', 'No model provider is configured');
    }
    const budget = new JobBudget(opts.budgetUsd);
    const perSegment: InferPerSegment[] = [];
    const skipped: InferResult['skipped'] = [];
    let costUsd = 0;
    const total = job.input.segments.length;
    for (let i = 0; i < total; i++) {
      const seg = job.input.segments[i]!;
      if (ctx.signal.aborted) break;
      await ctx.progress(i, total, `labeling segment ${i + 1} of ${total}`);
      const plan = planFrameSampling({ startSec: seg.startSec, endSec: seg.endSec, fps: opts.sampleFps ?? 1, maxFrames: opts.maxFramesPerSegment });
      try {
        const frames = await opts.extractFrames(job.input.sourcePath, plan.timestampsSec, { height: 720, signal: ctx.signal });
        const first = frames[0];
        const out = await opts.labeler.labelSegment({
          segment: { id: seg.id, assetId: job.input.assetId, gameId: '', startSec: seg.startSec, endSec: seg.endSec },
          frames: frames.map((f) => ({ atSec: f.atSec, jpegBase64: f.jpeg.toString('base64'), width: f.width, height: f.height })),
          context: job.input.context,
          labelKeys: job.input.labelKeys,
          samplingFps: plan.effectiveFps,
          resolution: first && first.width && first.height ? `${first.width}x${first.height}` : 'unknown',
        });
        costUsd += out.provenance.costUsd ?? 0;
        perSegment.push({ segmentId: seg.id, labels: out.labels, provenance: { ...out.provenance, costUsd: out.provenance.costUsd ?? 0 } });
      } catch (err) {
        if (err instanceof ProviderUnavailableError) {
          if (err.reason === 'budget_exceeded') throw new NonRetryableError('budget_exceeded', err.message);
          if (!err.retryable) throw new NonRetryableError('provider_unavailable', `${err.reason}: ${err.message}`);
          throw Object.assign(new Error(`${err.reason}: ${err.message}`), { code: 'provider_unavailable' });
        }
        throw err;
      }
    }
    void budget;
    await ctx.progress(total, total, 'done');
    return { perSegment, skipped, costUsd };
  };
}

/**
 * Merges a new inference into the segment's existing labels. A new `inferred` block and
 * `provenanceId` are always written; `accepted` is preserved when its status is `accepted` or
 * `corrected` (CONTRACTS §6), otherwise it mirrors the inference with status `inferred`.
 */
export function applyInference(existing: Label[], segmentId: string, inferred: AiInferredLabel[], provenanceId: string, nowIso: string, teamId: string): { upserts: Label[] } {
  const byKey = new Map(existing.filter((l) => l.segmentId === segmentId).map((l) => [l.key, l]));
  const upserts: Label[] = [];
  for (const item of inferred) {
    const body: InferredBody = item.inferred;
    const prev = byKey.get(item.key);
    const keepAccepted = prev !== undefined && (prev.accepted.status === 'accepted' || prev.accepted.status === 'corrected');
    const accepted = keepAccepted
      ? prev.accepted
      : { value: body.abstained ? null : body.value, status: 'inferred' as const, byUserId: null, at: null };
    upserts.push({
      id: prev?.id ?? crypto.randomUUID(),
      teamId,
      segmentId,
      key: item.key,
      inferred: body,
      accepted,
      provenanceId,
      version: prev ? prev.version + 1 : 1,
      createdAt: prev?.createdAt ?? nowIso,
      updatedAt: nowIso,
    });
  }
  return { upserts };
}

export { ANALYSIS_VERSION };
