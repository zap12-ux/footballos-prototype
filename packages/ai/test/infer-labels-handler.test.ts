import { describe, expect, it } from "vitest";
import {
  ANALYSIS_VERSION,
  ProviderUnavailableError,
  createInferLabelsHandler,
  isProviderUnavailable,
  type ExtractFrames,
  type InferLabelsJob,
  type InferredLabel,
  type LabelSegmentInput,
  type LabelSegmentOutput,
  type ModelProvenance,
  type VisionLabeler,
} from "../src/index.js";
import { DownLabeler } from "./helpers.js";

const ASSET = "0b6d1f2e-1111-4a0b-8c1d-000000000001";

function provenance(input: LabelSegmentInput, costUsd: number): ModelProvenance {
  const ts = input.frames.map((f) => f.atSec);
  return {
    id: crypto.randomUUID(),
    provider: "ollama",
    model: "fake-model",
    modelRevision: null,
    promptId: "label-segment.v1",
    promptHash: "deadbeef",
    preprocessing: { samplingFps: input.samplingFps ?? null, frameCount: ts.length, clipSec: input.segment.endSec - input.segment.startSec, resolution: input.resolution ?? "unknown" },
    inspected: { fromSec: ts[0]!, toSec: ts[ts.length - 1]!, frameTimestampsSec: ts },
    analysisVersion: ANALYSIS_VERSION,
    inputTokens: 1000,
    outputTokens: 100,
    costUsd,
    latencyMs: 5,
    requestedAt: "2026-10-25T00:00:00.000Z",
    completedAt: "2026-10-25T00:00:00.005Z",
  };
}

function fakeLabels(input: LabelSegmentInput): InferredLabel[] {
  return input.labelKeys.map((key) => ({
    key,
    inferred: {
      value: key === "play_type" ? "pass" : null,
      abstained: key !== "play_type",
      rationale: key === "play_type" ? "ball in the air" : "not visible",
      evidence: key === "play_type" ? [{ assetId: input.segment.assetId, atSec: input.frames[0]!.atSec, toSec: null, frameIndex: 0, note: null }] : [],
      uncertainty: key === "play_type" ? "low" : null,
    },
  }));
}

class FakeLabeler implements VisionLabeler {
  readonly provider = "ollama" as const;
  calls: LabelSegmentInput[] = [];
  constructor(
    private readonly respond: (input: LabelSegmentInput, n: number) => Promise<LabelSegmentOutput> | LabelSegmentOutput,
    private readonly available = true,
  ) {}
  isAvailable(): boolean {
    return this.available;
  }
  async labelSegment(input: LabelSegmentInput): Promise<LabelSegmentOutput> {
    this.calls.push(input);
    return this.respond(input, this.calls.length);
  }
}

const okLabeler = (costUsd = 0.05) => new FakeLabeler((input) => ({ labels: fakeLabels(input), provenance: provenance(input, costUsd) }));

function fakeExtractor(opts: { emptyFor?: string[]; throwFor?: string[] } = {}): ExtractFrames & { calls: { src: string; ts: number[]; height?: number }[] } {
  const calls: { src: string; ts: number[]; height?: number }[] = [];
  const fn: ExtractFrames = async (src, ts, o) => {
    calls.push({ src, ts, height: o.height });
    // The segment is identified by its first timestamp in these tests (segments start at 10 * n).
    const key = String(ts[0]);
    if (opts.throwFor?.includes(key)) throw new Error("ffmpeg exited with code 1");
    if (opts.emptyFor?.includes(key)) return [];
    return ts.map((atSec) => ({ atSec, jpeg: Buffer.from(`jpeg@${atSec}`), width: 1280, height: 720 }));
  };
  return Object.assign(fn, { calls });
}

function job(n: number, extra: Partial<InferLabelsJob["input"]> = {}): InferLabelsJob {
  return {
    id: "job_1",
    input: {
      assetId: ASSET,
      sourcePath: "/data/proxy.mp4",
      context: { analyzedTeam: "opponent", analyzedUnit: "offense", perspective: "endzone", teamCues: null },
      labelKeys: ["play_type", "formation_family"],
      segments: Array.from({ length: n }, (_, i) => ({ id: `seg_${i + 1}`, startSec: 10 * (i + 1), endSec: 10 * (i + 1) + 6, fps: 1 })),
      ...extra,
    },
  };
}

function ctx(signal: AbortSignal = new AbortController().signal) {
  const progress: [number, number, string][] = [];
  return { signal, progress: (done: number, total: number, message: string) => void progress.push([done, total, message]), log: progress };
}

describe("createInferLabelsHandler", () => {
  it("labels segments in input order with planned frames, sums cost and reports progress", async () => {
    const labeler = okLabeler(0.05);
    const extract = fakeExtractor();
    const handler = createInferLabelsHandler({ labeler, extractFrames: extract, maxFramesPerSegment: 4 });
    const c = ctx();
    const res = await handler(job(3), c);

    expect(res.perSegment.map((p) => p.segmentId)).toEqual(["seg_1", "seg_2", "seg_3"]);
    expect(res.skipped).toEqual([]);
    expect(res.costUsd).toBeCloseTo(0.15, 6);
    // Frames: 6 s at 1 fps capped to 4 → spread evenly; extractor asked with height 720.
    expect(extract.calls.map((x) => x.ts)).toEqual([[10, 11.5, 13, 14.5], [20, 21.5, 23, 24.5], [30, 31.5, 33, 34.5]]);
    expect(extract.calls[0]!.height).toBe(720);
    expect(extract.calls[0]!.src).toBe("/data/proxy.mp4");
    // Labeler input: ordered base64 frames, the requested keys, resolution.
    const first = labeler.calls[0]!;
    expect(first.frames.map((f) => f.atSec)).toEqual([10, 11.5, 13, 14.5]);
    expect(first.frames[0]!.jpegBase64).toBe(Buffer.from("jpeg@10").toString("base64"));
    expect(first.labelKeys).toEqual(["play_type", "formation_family"]);
    expect(first.resolution).toBe("1280x720");
    expect(first.samplingFps).toBeCloseTo(0.667, 3);
    expect(res.perSegment[0]!.labels.map((l) => l.key)).toEqual(["play_type", "formation_family"]);
    expect(res.perSegment[0]!.provenance.costUsd).toBe(0.05);
    expect(c.log[0]).toEqual([0, 3, "Labeling 3 segments"]);
    expect(c.log.at(-1)).toEqual([3, 3, "Segment 3 of 3"]);
  });

  it("uses the handler's default keys when the job has none, and rejects unknown keys", async () => {
    const labeler = okLabeler();
    const handler = createInferLabelsHandler({ labeler, extractFrames: fakeExtractor(), labelKeys: ["unit", "play_type"] });
    await handler(job(1, { labelKeys: null }), ctx());
    expect(labeler.calls[0]!.labelKeys).toEqual(["unit", "play_type"]);
    await expect(handler(job(1, { labelKeys: ["score" as never] }), ctx())).rejects.toThrow(/unknown label keys: score/);
  });

  it("stops between segments when ctx.signal aborts and lists the rest as canceled", async () => {
    const ac = new AbortController();
    const labeler = new FakeLabeler((input, n) => {
      if (n === 2) ac.abort();
      return { labels: fakeLabels(input), provenance: provenance(input, 0.01) };
    });
    const handler = createInferLabelsHandler({ labeler, extractFrames: fakeExtractor() });
    const res = await handler(job(4), ctx(ac.signal));
    expect(res.perSegment.map((p) => p.segmentId)).toEqual(["seg_1", "seg_2"]);
    expect(res.skipped).toEqual([
      { segmentId: "seg_3", reason: "canceled", detail: expect.any(String) },
      { segmentId: "seg_4", reason: "canceled", detail: expect.any(String) },
    ]);
    expect(labeler.calls).toHaveLength(2);
  });

  it("fails the job immediately with a non-retryable provider_unavailable when the labeler reports itself unavailable", async () => {
    const extract = fakeExtractor();
    const handler = createInferLabelsHandler({ labeler: new DownLabeler(false), extractFrames: extract });
    const err = await handler(job(2), ctx()).catch((e: unknown) => e);
    expect(isProviderUnavailable(err)).toBe(true);
    const e = err as ProviderUnavailableError;
    expect(e.retryable).toBe(false);
    expect(e.toJobError()).toEqual({ code: "provider_unavailable", message: "unreachable: The model server is not available" });
    expect(extract.calls).toHaveLength(0);
  });

  it("fails the job on the first segment when Ollama is unreachable (job-wide, non-retryable) and names the fix", async () => {
    const extract = fakeExtractor();
    const handler = createInferLabelsHandler({ labeler: new DownLabeler(), extractFrames: extract });
    const err = await handler(job(3), ctx()).catch((e: unknown) => e);
    expect(isProviderUnavailable(err)).toBe(true);
    const e = err as ProviderUnavailableError;
    expect(e.reason).toBe("unreachable");
    expect(e.retryable).toBe(false);
    expect(e.message).toContain("ollama serve");
    // Frames for the first segment were extracted (the server is only known to be down once asked); nothing further.
    expect(extract.calls).toHaveLength(1);
  });

  it("surfaces a retryable provider failure as the job error with retryable preserved", async () => {
    const labeler = new FakeLabeler((input, n) => {
      if (n === 2) throw new ProviderUnavailableError({ provider: "ollama", reason: "network", retryable: true, message: "Ollama did not answer within 300 s" });
      return { labels: fakeLabels(input), provenance: provenance(input, 0.02) };
    });
    const handler = createInferLabelsHandler({ labeler, extractFrames: fakeExtractor() });
    const err = await handler(job(3), ctx()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderUnavailableError);
    expect((err as ProviderUnavailableError).retryable).toBe(true);
    expect((err as ProviderUnavailableError).reason).toBe("network");
    expect((err as ProviderUnavailableError).status).toBeNull();
    expect(labeler.calls).toHaveLength(2);
  });

  it("fails the job on a job-wide non-retryable reason (model_missing) with retryable false", async () => {
    const labeler = new FakeLabeler(() => {
      throw new ProviderUnavailableError({ provider: "ollama", reason: "model_missing", retryable: false, message: "model qwen3-vl:4b is not installed", status: 404 });
    });
    const handler = createInferLabelsHandler({ labeler, extractFrames: fakeExtractor() });
    const err = await handler(job(2), ctx()).catch((e: unknown) => e);
    expect((err as ProviderUnavailableError).reason).toBe("model_missing");
    expect((err as ProviderUnavailableError).retryable).toBe(false);
    expect(labeler.calls).toHaveLength(1);
  });

  it("records segment-local non-retryable provider failures as skipped and continues", async () => {
    const labeler = new FakeLabeler((input, n) => {
      if (n === 1) throw new ProviderUnavailableError({ provider: "ollama", reason: "truncated_output", retryable: false, message: "response hit num_predict=4096" });
      return { labels: fakeLabels(input), provenance: provenance(input, 0.03) };
    });
    const handler = createInferLabelsHandler({ labeler, extractFrames: fakeExtractor() });
    const res = await handler(job(2), ctx());
    expect(res.skipped).toEqual([{ segmentId: "seg_1", reason: "provider_unavailable", detail: "truncated_output: response hit num_predict=4096" }]);
    expect(res.perSegment.map((p) => p.segmentId)).toEqual(["seg_2"]);
    expect(res.costUsd).toBe(0.03);
  });

  it("skips segments with no frames, failed extraction or an invalid record, without calling the model", async () => {
    const labeler = okLabeler();
    const extract = fakeExtractor({ emptyFor: ["10"], throwFor: ["20"] });
    const handler = createInferLabelsHandler({ labeler, extractFrames: extract });
    const j = job(3);
    j.input.segments.push({ id: "seg_bad", startSec: 50, endSec: 50, fps: 1 });
    const res = await handler(j, ctx());
    expect(res.skipped.map((s) => [s.segmentId, s.reason])).toEqual([
      ["seg_1", "no_frames"],
      ["seg_2", "frame_extraction_failed"],
      ["seg_bad", "invalid_segment"],
    ]);
    expect(res.skipped[1]!.detail).toBe("ffmpeg exited with code 1");
    expect(res.perSegment.map((p) => p.segmentId)).toEqual(["seg_3"]);
    expect(labeler.calls).toHaveLength(1);
    expect(extract.calls).toHaveLength(3);
  });

  it("orders and deduplicates frames the extractor returns out of order", async () => {
    const labeler = okLabeler();
    const extract: ExtractFrames = async (_src, ts) => [
      { atSec: ts[1]!, jpeg: Buffer.from("b"), width: 640, height: 360 },
      { atSec: ts[0]!, jpeg: Buffer.from("a"), width: 640, height: 360 },
      { atSec: ts[0]!, jpeg: Buffer.from("dup"), width: 640, height: 360 },
    ];
    const handler = createInferLabelsHandler({ labeler, extractFrames: extract, maxFramesPerSegment: 2 });
    await handler(job(1), ctx());
    expect(labeler.calls[0]!.frames.map((f) => f.atSec)).toEqual([10, 13]);
    expect(labeler.calls[0]!.resolution).toBe("640x360");
  });

  it("validates its options", () => {
    const labeler = okLabeler();
    expect(() => createInferLabelsHandler({ labeler, extractFrames: fakeExtractor(), maxFramesPerSegment: 0 })).toThrow(/maxFramesPerSegment/);
    expect(() => createInferLabelsHandler({ labeler, extractFrames: undefined as never })).toThrow(/extractFrames/);
  });
});
